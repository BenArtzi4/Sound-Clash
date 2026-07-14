#!/usr/bin/env python3
"""Release-year backfill helper: partition the catalog for the agent waves, and
reconcile their answers into idempotent UPDATE SQL.

The actual year lookup is NOT done here. Because we have no LLM API key, the
extraction is run by parallel Claude Code subagents that use the WebSearch /
WebFetch tools (the agents *are* the LLM). This script only does the two
deterministic, stdlib-friendly ends of the pipeline:

  partition  catalog.csv  -> batches/<date>/year_in/batch_NN.csv   (agent inputs)
  build      year_out/*   -> db/backfill/release_years.sql + flagged.csv

See ``year-backfill.md`` for the full runbook, the EN/HE prompt templates, and
the two-wave (extractor + independent judge) confidence model. ``release_year``
is the ORIGINAL release year of the song; for a cover that is the first
artist's year, not the cover's (see data-sources.md).

stdlib only — no new dependency. ``partition`` needs no network; the agent
waves do (run those with the sandbox disabled). ``build`` is pure file I/O.

Usage:
    # 1. split a dumped catalog into ~30-song batches for the agents
    python year_backfill.py partition batches/2026-06-18/songs_catalog.csv \
        --size 30 --out-dir batches/2026-06-18/year_in

    # 2. (agents run, writing extract_*.csv and judge_*.csv into year_out/)

    # 3. reconcile the two waves into committable UPDATE SQL + a review list
    python year_backfill.py build \
        --extract-dir batches/2026-06-18/year_out \
        --judge-dir   batches/2026-06-18/year_out \
        --out ../../db/backfill/release_years.sql \
        --flagged batches/2026-06-18/flagged.csv
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from pathlib import Path

MIN_YEAR = 1900
MAX_YEAR = 2100
# Auto-accept only when the extractor and the judge agree on the year AND both
# are at least this confident; everything else goes to flagged.csv for a human.
DEFAULT_THRESHOLD = 0.7

HEBREW = range(0x0590, 0x0600)


def _has_hebrew(text: str) -> bool:
    return any(ord(ch) in HEBREW for ch in text)


def _read_year(value: str | None) -> int | None:
    """Parse an in-range release year, or None if blank/invalid/out-of-range."""
    stripped = (value or "").strip()
    if not stripped:
        return None
    try:
        year = int(stripped)
    except ValueError:
        return None
    return year if MIN_YEAR <= year <= MAX_YEAR else None


def _read_conf(value: str | None) -> float:
    try:
        return float((value or "").strip())
    except ValueError:
        return 0.0


def _read_rows(path: Path) -> list[dict[str, str]]:
    text = path.read_text(encoding="utf-8-sig")
    return list(csv.DictReader(text.splitlines()))


def _gather(directory: Path, prefix: str) -> dict[str, dict[str, str]]:
    """Concatenate every ``<prefix>*.csv`` in a dir, keyed by youtube_id."""
    out: dict[str, dict[str, str]] = {}
    for path in sorted(directory.glob(f"{prefix}*.csv")):
        for row in _read_rows(path):
            vid = (row.get("youtube_id") or "").strip()
            if vid:
                out[vid] = row
    return out


# ---------------------------------------------------------------------------
# partition
# ---------------------------------------------------------------------------


def cmd_partition(args: argparse.Namespace) -> int:
    catalog = Path(args.catalog)
    rows = _read_rows(catalog)
    songs = [
        {
            "youtube_id": (r.get("youtube_id") or "").strip(),
            "title": (r.get("title") or "").strip(),
            "artist": (r.get("artist") or "").strip(),
        }
        for r in rows
        if (r.get("youtube_id") or "").strip()
    ]
    if not songs:
        print(f"No songs with a youtube_id found in {catalog}", file=sys.stderr)
        return 1

    for s in songs:
        s["lang"] = "he" if _has_hebrew(s["title"] + s["artist"]) else "en"

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    size = max(1, args.size)
    batches = [songs[i : i + size] for i in range(0, len(songs), size)]
    width = len(str(len(batches)))
    for n, batch in enumerate(batches, start=1):
        path = out_dir / f"batch_{str(n).zfill(width)}.csv"
        with path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=["youtube_id", "title", "artist", "lang"])
            writer.writeheader()
            writer.writerows(batch)

    he = sum(1 for s in songs if s["lang"] == "he")
    print(
        f"Wrote {len(batches)} batches ({len(songs)} songs: {he} he / {len(songs) - he} en) "
        f"-> {out_dir}",
        file=sys.stderr,
    )
    return 0


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------


def _classify(
    extract: dict[str, str],
    judge: dict[str, str] | None,
    threshold: float,
    decade_tolerance: bool = False,
) -> tuple[int | None, str]:
    """Return (accepted_year, reason). accepted_year is None when flagged.

    With ``decade_tolerance``, the extractor and judge are treated as agreeing
    when their years fall in the same decade (e.g. 2004 vs 2005) and the
    extractor's year is kept. This suits the decade-filter use case, where the
    exact year inside a decade is irrelevant; only cross-decade disagreements
    (and missing/low-confidence years) still flag for review.
    """
    ext_year = _read_year(extract.get("year"))
    if ext_year is None:
        return None, "no-year"
    if judge is None:
        return None, "no-judge"
    judge_year = _read_year(judge.get("year"))
    if judge_year is None:
        return None, "no-judge"
    agree = (ext_year // 10 == judge_year // 10) if decade_tolerance else (ext_year == judge_year)
    if not agree:
        return None, "disagree"
    if min(_read_conf(extract.get("confidence")), _read_conf(judge.get("confidence"))) < threshold:
        return None, "low-confidence"
    return ext_year, "accepted"


def _write_sql(path: Path, accepted: list[tuple[str, int]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "-- release_years.sql — generated by tools/song-curation/year_backfill.py build",
        "-- Backfills songs.release_year (the ORIGINAL release year of the song; for a",
        "-- cover, the first artist's year — see tools/song-curation/data-sources.md).",
        "--",
        "-- Idempotent: keyed on youtube_id, re-running sets identical values and",
        "-- touches no other column. A maintainer applies this to the live catalog;",
        "-- for local testing, apply it to your own throwaway database.",
        "",
        "UPDATE songs AS s SET release_year = v.release_year",
        "FROM (VALUES",
    ]
    value_rows = [
        f"  ('{vid}', {year})" + ("," if i < len(accepted) - 1 else "")
        for i, (vid, year) in enumerate(accepted)
    ]
    lines.extend(value_rows)
    lines.append(") AS v(youtube_id, release_year)")
    lines.append("WHERE s.youtube_id = v.youtube_id;")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_flagged(path: Path, flagged: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "youtube_id",
        "title",
        "artist",
        "reason",
        "year_extractor",
        "year_judge",
        "is_cover",
        "original_artist",
        "conf_extractor",
        "conf_judge",
        "source",
        "youtube_url",
    ]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(flagged)


def _write_accepted(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["youtube_id", "title", "artist", "year", "is_cover", "lang"]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def cmd_build(args: argparse.Namespace) -> int:
    extract = _gather(Path(args.extract_dir), args.extract_prefix)
    judge = _gather(Path(args.judge_dir), args.judge_prefix)
    if not extract:
        print(f"No extractor rows found in {args.extract_dir}", file=sys.stderr)
        return 1

    accepted: list[tuple[str, int]] = []
    accepted_rows: list[dict[str, str]] = []
    flagged: list[dict[str, str]] = []
    for vid, ext in extract.items():
        j = judge.get(vid)
        year, reason = _classify(ext, j, args.threshold, args.decade_tolerance)
        if year is not None:
            accepted.append((vid, year))
            ext_lang = "he" if _has_hebrew(ext.get("title", "") + ext.get("artist", "")) else "en"
            accepted_rows.append(
                {
                    "youtube_id": vid,
                    "title": ext.get("title", ""),
                    "artist": ext.get("artist", ""),
                    "year": str(year),
                    "is_cover": ext.get("is_cover", ""),
                    "lang": ext_lang,
                }
            )
        else:
            flagged.append(
                {
                    "youtube_id": vid,
                    "title": ext.get("title", ""),
                    "artist": ext.get("artist", ""),
                    "reason": reason,
                    "year_extractor": (ext.get("year") or "").strip(),
                    "year_judge": ((j or {}).get("year") or "").strip(),
                    "is_cover": ext.get("is_cover", ""),
                    "original_artist": ext.get("original_artist", ""),
                    "conf_extractor": (ext.get("confidence") or "").strip(),
                    "conf_judge": ((j or {}).get("confidence") or "").strip(),
                    "source": ext.get("source", ""),
                    "youtube_url": f"https://www.youtube.com/watch?v={vid}",
                }
            )

    # worst-first: lowest combined confidence at the top of the review list.
    def _flag_key(row: dict[str, str]) -> float:
        return _read_conf(row["conf_extractor"]) + _read_conf(row["conf_judge"])

    flagged.sort(key=_flag_key)
    accepted.sort(key=lambda pair: pair[0])
    accepted_rows.sort(key=lambda r: r["youtube_id"])

    _write_sql(Path(args.out), accepted)
    _write_flagged(Path(args.flagged), flagged)
    accepted_path = (
        Path(args.accepted) if args.accepted else Path(args.flagged).with_name("accepted.csv")
    )
    _write_accepted(accepted_path, accepted_rows)

    total = len(extract)
    pct = (100 * len(accepted) // total) if total else 0
    print(
        f"reconciled {total} | accepted {len(accepted)} ({pct}%) "
        f"| flagged {len(flagged)} -> {args.flagged}",
        file=sys.stderr,
    )
    print(f"wrote {len(accepted)} UPDATEs -> {args.out}", file=sys.stderr)
    print(f"wrote {len(accepted_rows)} accepted rows -> {accepted_path}", file=sys.stderr)
    return 0


# ---------------------------------------------------------------------------
# sample / sample-report: the third validation (real-Google spot-check)
# ---------------------------------------------------------------------------


def cmd_sample(args: argparse.Namespace) -> int:
    """Pick a random non-cover slice of the auto-accepted songs for a manual,
    real-Google spot-check (covers are excluded -- the literal Google query
    returns the cover's year, not the original; covers are reviewed via
    flagged.csv instead)."""
    rows = [
        r
        for r in _read_rows(Path(args.accepted))
        if (r.get("is_cover") or "").strip().lower() != "yes"
    ]
    rng = random.Random(args.seed)
    if args.size:
        # Flat random across all non-cover accepted songs (honours "N random").
        picked = rng.sample(rows, min(args.size, len(rows)))
    else:
        # Language-weighted: Hebrew is where errors hide, English is the easy case.
        he = [r for r in rows if (r.get("lang") or "").strip() == "he"]
        en = [r for r in rows if (r.get("lang") or "").strip() != "he"]
        picked = rng.sample(he, min(args.he, len(he))) + rng.sample(en, min(args.en, len(en)))
    rng.shuffle(picked)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=["youtube_id", "title", "artist", "lang"])
        writer.writeheader()
        for r in picked:
            writer.writerow({k: r.get(k, "") for k in ("youtube_id", "title", "artist", "lang")})

    n_he = sum(1 for r in picked if (r.get("lang") or "").strip() == "he")
    print(
        f"sampled {len(picked)} accepted non-cover songs ({n_he} he / {len(picked) - n_he} en) "
        f"-> {out}",
        file=sys.stderr,
    )
    return 0


def cmd_sample_report(args: argparse.Namespace) -> int:
    """Compare the Google spot-check answers to the pipeline's accepted years."""
    accepted = {r["youtube_id"]: r for r in _read_rows(Path(args.accepted))}
    answers = {r["youtube_id"]: r for r in _read_rows(Path(args.answers))}
    sample = _read_rows(Path(args.sample))

    out_rows: list[dict[str, str]] = []
    match = miss = 0
    for r in sample:
        vid = (r.get("youtube_id") or "").strip()
        pipeline_year = _read_year((accepted.get(vid) or {}).get("year"))
        google_year = _read_year((answers.get(vid) or {}).get("google_year"))
        if google_year is None:
            verdict = "no-answer"
        elif pipeline_year == google_year:
            verdict = "match"
            match += 1
        else:
            verdict = "MISMATCH"
            miss += 1
        out_rows.append(
            {
                "youtube_id": vid,
                "title": r.get("title", ""),
                "artist": r.get("artist", ""),
                "lang": r.get("lang", ""),
                "pipeline_year": str(pipeline_year) if pipeline_year is not None else "",
                "google_year": str(google_year) if google_year is not None else "",
                "verdict": verdict,
                "youtube_url": f"https://www.youtube.com/watch?v={vid}",
            }
        )

    order = {"MISMATCH": 0, "no-answer": 1, "match": 2}
    out_rows.sort(key=lambda r: order.get(r["verdict"], 3))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "youtube_id",
        "title",
        "artist",
        "lang",
        "pipeline_year",
        "google_year",
        "verdict",
        "youtube_url",
    ]
    with out.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(out_rows)

    checked = match + miss
    rate = (100 * match // checked) if checked else 0
    print(
        f"spot-check: {match}/{checked} match ({rate}%), {miss} mismatch, "
        f"{len(out_rows) - checked} no-answer -> {out}",
        file=sys.stderr,
    )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="command", required=True)

    p_part = sub.add_parser("partition", help="split a catalog CSV into agent-input batches")
    p_part.add_argument("catalog", help="CSV with youtube_id,title,artist (e.g. a prod dump)")
    p_part.add_argument("--size", type=int, default=30, help="songs per batch (default 30)")
    p_part.add_argument("--out-dir", required=True, help="directory to write batch_NN.csv into")
    p_part.set_defaults(func=cmd_partition)

    p_build = sub.add_parser("build", help="reconcile extractor+judge CSVs into UPDATE SQL")
    p_build.add_argument("--extract-dir", required=True, help="dir of extractor output CSVs")
    p_build.add_argument("--judge-dir", required=True, help="dir of judge output CSVs")
    p_build.add_argument("--extract-prefix", default="extract_", help="extractor filename prefix")
    p_build.add_argument("--judge-prefix", default="judge_", help="judge filename prefix")
    p_build.add_argument("--out", required=True, help="release_years.sql output path")
    p_build.add_argument("--flagged", required=True, help="flagged.csv (review list) output path")
    p_build.add_argument(
        "--accepted", default=None, help="accepted.csv path (default: alongside --flagged)"
    )
    p_build.add_argument(
        "--threshold", type=float, default=DEFAULT_THRESHOLD, help="min agreeing confidence"
    )
    p_build.add_argument(
        "--decade-tolerance",
        action="store_true",
        help="accept when extractor and judge land in the same decade (keep extractor's year)",
    )
    p_build.set_defaults(func=cmd_build)

    p_sample = sub.add_parser(
        "sample", help="pick a random non-cover slice of accepted.csv for the Google spot-check"
    )
    p_sample.add_argument("--accepted", required=True, help="accepted.csv from build")
    p_sample.add_argument(
        "--size", type=int, default=None, help="flat random N (overrides --he/--en)"
    )
    p_sample.add_argument("--he", type=int, default=30, help="Hebrew songs to sample (default 30)")
    p_sample.add_argument("--en", type=int, default=20, help="English songs to sample (default 20)")
    p_sample.add_argument("--seed", type=int, default=18, help="RNG seed (reproducible sample)")
    p_sample.add_argument("--out", required=True, help="sample_in.csv output path")
    p_sample.set_defaults(func=cmd_sample)

    p_report = sub.add_parser(
        "sample-report", help="compare Google spot-check answers to the pipeline years"
    )
    p_report.add_argument("--sample", required=True, help="sample_in.csv from sample")
    p_report.add_argument("--answers", required=True, help="CSV: youtube_id,google_year")
    p_report.add_argument("--accepted", required=True, help="accepted.csv from build")
    p_report.add_argument("--out", required=True, help="sample_report.csv output path")
    p_report.set_defaults(func=cmd_sample_report)

    args = ap.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
