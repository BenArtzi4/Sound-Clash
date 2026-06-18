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
    extract: dict[str, str], judge: dict[str, str] | None, threshold: float
) -> tuple[int | None, str]:
    """Return (accepted_year, reason). accepted_year is None when flagged."""
    ext_year = _read_year(extract.get("year"))
    if ext_year is None:
        return None, "no-year"
    if judge is None:
        return None, "no-judge"
    judge_year = _read_year(judge.get("year"))
    if judge_year is None:
        return None, "no-judge"
    if ext_year != judge_year:
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
        "-- touches no other column. Apply with:",
        "--   supabase db query --linked -f db/backfill/release_years.sql",
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


def cmd_build(args: argparse.Namespace) -> int:
    extract = _gather(Path(args.extract_dir), args.extract_prefix)
    judge = _gather(Path(args.judge_dir), args.judge_prefix)
    if not extract:
        print(f"No extractor rows found in {args.extract_dir}", file=sys.stderr)
        return 1

    accepted: list[tuple[str, int]] = []
    flagged: list[dict[str, str]] = []
    for vid, ext in extract.items():
        j = judge.get(vid)
        year, reason = _classify(ext, j, args.threshold)
        if year is not None:
            accepted.append((vid, year))
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

    _write_sql(Path(args.out), accepted)
    _write_flagged(Path(args.flagged), flagged)

    total = len(extract)
    pct = (100 * len(accepted) // total) if total else 0
    print(
        f"reconciled {total} | accepted {len(accepted)} ({pct}%) "
        f"| flagged {len(flagged)} -> {args.flagged}",
        file=sys.stderr,
    )
    print(f"wrote {len(accepted)} UPDATEs -> {args.out}", file=sys.stderr)
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
        "--threshold", type=float, default=DEFAULT_THRESHOLD, help="min agreeing confidence"
    )
    p_build.set_defaults(func=cmd_build)

    args = ap.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
