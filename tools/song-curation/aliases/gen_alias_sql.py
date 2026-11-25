"""Checked alias pairs -> the maintainer's review page, then the upload and verify SQL.

Steps 4 and 5 of the alias run (README.md in this folder). Reads
``<batch>/checked.json`` (rows with ``artist_key``, ``alias``, ``source_url``,
``verdict`` = confirmed | wrong | unsure, ``evidence``) and the catalog
snapshot ``<batch>/_dumps/catalog_raw.json``. Never connects to a database.

Every alias is cleaned as ``artist_aliases`` stores it (``common.clean_alias``)
and a pair that appears twice is one pair (with the less sure verdict when
the two rows disagree). The rules then drop a pair, mechanically; a dropped
pair is never uploaded and gets no box on the review page:

- (a) its ``artist_key`` is not a value of the snapshot's ``artist_keys``;
- (b) the alias norms to its own artist key;
- (c) the alias norms to a catalog artist key (the matcher tries a key
  before an alias, so the alias would never be read);
- (d) the same alias (norm form) points at two or more artist keys: all of
  those pairs go (the matcher would keep the first, the database the last).

``--review`` writes ``<batch>/review.md``: the unsure and wrong pairs with a
box each, the dropped pairs, and the number of confirmed pairs. It refuses
to overwrite a review.md with a ticked box unless ``--force``.

The default run keeps the confirmed pairs and the pairs ticked in
review.md (read from the ticked line's text), minus every dropped pair, and
writes ``upload_aliases.sql`` (one INSERT ... ON CONFLICT (alias) DO UPDATE),
``aliases_final.json`` (the replay's ``--aliases`` input) and
``verify_aliases.sql`` (one read-only SELECT).

``--check DUMP`` reads the CLI's JSON output of ``verify_aliases.sql`` and
prints PASS or FAIL; exit code 0 or 1.

stdout gets counts only; every file this writes holds real names, so the
batch is a git-ignored folder. How to run, from the repository root::

    PYTHONUTF8=1 <backend venv python> tools/song-curation/aliases/gen_alias_sql.py [--batch DIR] [--review [--force] | --check DUMP]
"""

from __future__ import annotations

import argparse
import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import common  # puts the backend first on sys.path, so it stays above the app imports

# isort: split
from app.services.setlist_text import norm

HERE = Path(__file__).resolve().parent
DEFAULT_BATCH = HERE.parent / "batches" / "2026-11-25-aliases"

VERDICTS = ("confirmed", "unsure", "wrong")
SURENESS = {"wrong": 0, "unsure": 1, "confirmed": 2}  # of two rows of one pair, the lower wins
RULES = {
    "a": "the artist key is not a value of the snapshot's songs.artist_keys",
    "b": "the alias norms to its own artist key",
    "c": "the alias norms to a catalog artist key, which the matcher tries first",
    "d": "the same alias (norm form) points at two or more artist keys",
}
EVIDENCE_CHARS = 200
ARROW = "\N{RIGHTWARDS ARROW}"
DOT = "\N{MIDDLE DOT}"
# A ticked review line: "- [x] <alias> → <artist_key> · <evidence> · <source_url>".
TICKED = re.compile(
    r"^\s*[-*] \[[xX]\] (?P<alias>.+?) \N{RIGHTWARDS ARROW} (?P<key>.+?) \N{MIDDLE DOT} "
)
ANY_TICK = re.compile(r"^\s*[-*] \[[xX]\]", re.MULTILINE)


@dataclass
class Pair:
    alias: str
    artist_key: str
    source_url: str
    verdict: str
    evidence: str
    rule: str = ""  # a-d when a rule drops it

    @property
    def ident(self) -> tuple[str, str]:
        return self.alias, self.artist_key


# ----- reading -------------------------------------------------------------------------------


def text(row: Mapping[str, Any], field: str, where: str, required: bool = True) -> str:
    value = row.get(field)
    if value is None and not required:
        return ""
    if not isinstance(value, str) or (required and not value.strip()):
        raise SystemExit(f"{where}: {field!r} is missing or not text")
    return value


def read_checked(path: Path) -> tuple[list[Pair], int]:
    """The pairs of checked.json, cleaned and deduplicated; and how many pairs had two verdicts."""
    rows = common.read_json(path)
    if not isinstance(rows, list):
        raise SystemExit(f"{path}: not a JSON list")
    pairs: dict[tuple[str, str], Pair] = {}
    verdicts: dict[tuple[str, str], set[str]] = {}
    for no, row in enumerate(rows, 1):
        where = f"{path.name} row {no}"
        if not isinstance(row, Mapping):
            raise SystemExit(f"{where}: not a JSON object")
        verdict = text(row, "verdict", where).strip().lower()
        if verdict not in VERDICTS:
            raise SystemExit(f"{where}: verdict {verdict!r} is not one of {', '.join(VERDICTS)}")
        pair = Pair(
            alias=common.clean_alias(text(row, "alias", where)),
            artist_key=text(row, "artist_key", where).strip(),
            source_url=text(row, "source_url", where, required=False).strip(),
            verdict=verdict,
            evidence=" ".join(text(row, "evidence", where, required=False).split()),
        )
        if not norm(pair.alias):
            raise SystemExit(f"{where}: the alias has no letter or digit")
        verdicts.setdefault(pair.ident, set()).add(verdict)
        seen = pairs.setdefault(pair.ident, pair)
        if SURENESS[verdict] < SURENESS[seen.verdict]:
            pairs[pair.ident] = pair
    return list(pairs.values()), sum(len(v) > 1 for v in verdicts.values())


def apply_rules(pairs: Sequence[Pair], rows: Sequence[Mapping[str, Any]]) -> None:
    """Set ``rule`` on every pair a rule drops: the first of (a), (b), (c), then (d)."""
    db_keys = {key for row in rows for key in row.get("artist_keys") or []}
    direct = {norm(k) for song in common.catalog_songs(rows) for k in song.artist_keys} - {""}
    for p in pairs:
        if p.artist_key not in db_keys:
            p.rule = "a"
        elif norm(p.alias) == norm(p.artist_key):
            p.rule = "b"
        elif norm(p.alias) in direct:
            p.rule = "c"
    targets: dict[str, set[str]] = {}
    for p in pairs:
        if not p.rule:
            targets.setdefault(norm(p.alias), set()).add(p.artist_key)
    for p in pairs:
        if not p.rule and len(targets[norm(p.alias)]) > 1:
            p.rule = "d"


def load(batch: Path) -> tuple[list[Pair], int]:
    pairs, twice = read_checked(batch / "checked.json")
    apply_rules(pairs, common.supabase_rows(batch / "_dumps" / "catalog_raw.json"))
    return sorted(pairs, key=lambda p: (p.artist_key, p.alias)), twice


def rule_counts(pairs: Iterable[Pair]) -> str:
    counts = Counter(p.rule for p in pairs if p.rule)
    return ", ".join(f"({rule}) {counts[rule]}" for rule in RULES)


def verdict_counts(pairs: Iterable[Pair]) -> str:
    counts = Counter(p.verdict for p in pairs)
    return ", ".join(f"{verdict} {counts[verdict]}" for verdict in VERDICTS)


# ----- step 4: the review page -------------------------------------------------------------------


def evidence_cut(evidence: str) -> str:
    if not evidence:
        return "(no evidence)"
    return evidence if len(evidence) <= EVIDENCE_CHARS else evidence[: EVIDENCE_CHARS - 1] + "…"


def review_text(pairs: Sequence[Pair], twice: int) -> str:
    dropped = [p for p in pairs if p.rule]
    kept = [p for p in pairs if not p.rule]
    confirmed = sum(p.verdict == "confirmed" for p in kept)
    out = [
        "# Artist alias review",
        "",
        f"Made {date.today().isoformat()} by `gen_alias_sql.py --review` from checked.json.",
        "",
        f"- Pairs: {len(pairs)} ({verdict_counts(pairs)}).",
        f"- Dropped by the rules: {len(dropped)} ({rule_counts(pairs)}); listed at the end,"
        " never uploaded.",
    ]
    if twice:
        out.append(f"- Checked twice with two verdicts: {twice} (the less sure verdict is shown).")
    out += [
        "",
        "**How to answer:** tick `[x]` to keep a pair; confirmed pairs are kept without a tick;"
        " then tell Claude you are done.",
        "To keep a pair the rules dropped, fix checked.json and run `gen_alias_sql.py --review`"
        " again (with `--force` once a box is ticked).",
    ]
    for verdict, title in (("unsure", "Unsure"), ("wrong", "Wrong")):
        section = [p for p in kept if p.verdict == verdict]
        out += ["", f"## {title} ({len(section)})", ""]
        out += [
            f"- [ ] {p.alias} {ARROW} {p.artist_key} {DOT} {evidence_cut(p.evidence)}"
            f" {DOT} {p.source_url or '(no link)'}"
            for p in section
        ] or ["(none)"]
    out += ["", f"## Dropped by the rules ({len(dropped)})", ""]
    out += [
        f"- {p.alias} {ARROW} {p.artist_key} {DOT} ({p.rule}) {RULES[p.rule]}" for p in dropped
    ] or ["(none)"]
    out += ["", f"Confirmed: {confirmed} pairs (kept; listed in checked.json)", ""]
    return "\n".join(out)


def write_review(batch: Path, force: bool) -> int:
    pairs, twice = load(batch)
    path = batch / "review.md"
    if path.is_file() and ANY_TICK.search(path.read_text(encoding="utf-8")) and not force:
        print(f"{path} has a ticked box: not overwritten (pass --force to replace it)")
        return 1
    path.write_text(review_text(pairs, twice), encoding="utf-8", newline="\n")
    kept = [p for p in pairs if not p.rule]
    print(f"pairs: {len(pairs)} ({verdict_counts(pairs)})")
    print(f"dropped by the rules: {sum(bool(p.rule) for p in pairs)} ({rule_counts(pairs)})")
    print(
        f"to review: {sum(p.verdict == 'unsure' for p in kept)} unsure,"
        f" {sum(p.verdict == 'wrong' for p in kept)} wrong;"
        f" confirmed kept: {sum(p.verdict == 'confirmed' for p in kept)}"
    )
    if twice:
        print(f"checked twice with two verdicts: {twice}")
    print(f"wrote {path}")
    return 0


# ----- step 5: the SQL -----------------------------------------------------------------------------


def ticked_pairs(path: Path, known: Mapping[tuple[str, str], Pair]) -> set[tuple[str, str]]:
    """The (alias, artist_key) of every ticked line of review.md."""
    ticked: set[tuple[str, str]] = set()
    for no, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not ANY_TICK.match(line):
            continue
        m = TICKED.match(line)
        if m is None:
            raise SystemExit(f"{path.name} line {no}: a ticked line that is not a pair line")
        ident = (common.clean_alias(m["alias"]), m["key"].strip())
        if ident not in known:
            raise SystemExit(
                f"{path.name} line {no}: the ticked pair is not in checked.json"
                " (run --review again?)"
            )
        ticked.add(ident)
    return ticked


def q(s: str) -> str:
    """A SQL string literal."""
    return "'" + s.replace("'", "''") + "'"


def values_list(rows: Sequence[Pair]) -> str:
    return ",\n".join(f"  ({q(p.alias)}, {q(p.artist_key)})" for p in rows)


def upload_sql(rows: Sequence[Pair], confirmed: int, ticked: int, dropped: str) -> str:
    return "\n".join(
        [
            f"-- artist_aliases upload: {len(rows)} rows ({confirmed} confirmed, {ticked} ticked in"
            " review.md), made by gen_alias_sql.py on " + date.today().isoformat() + ".",
            f"-- Dropped by the rules before this file: {dropped}.",
            "-- Idempotent: a rerun rewrites the same rows. An alias already in the table is",
            "-- moved to the artist key below. Apply only when the maintainer names this write.",
            "INSERT INTO artist_aliases (alias, artist_key) VALUES",
            values_list(rows),
            "ON CONFLICT (alias) DO UPDATE SET artist_key = EXCLUDED.artist_key;",
            "",
        ]
    )


def verify_sql(rows: Sequence[Pair]) -> str:
    n = len(rows)
    return "\n".join(
        [
            f"-- artist_aliases verify (read-only): one row; ok when all {n} pairs of",
            "-- upload_aliases.sql are present and no row of the table points at an artist key",
            "-- that no song has. Save the CLI's output and run gen_alias_sql.py --check on it.",
            "WITH expected (alias, artist_key) AS (",
            "  VALUES",
            values_list(rows),
            "),",
            "present AS (",
            "  SELECT count(*) AS n",
            "  FROM expected e",
            "  JOIN artist_aliases a ON a.alias = e.alias AND a.artist_key = e.artist_key",
            "),",
            "missing AS (",
            "  SELECT a.alias",
            "  FROM artist_aliases a",
            "  WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE a.artist_key = ANY (s.artist_keys))",
            ")",
            "SELECT",
            f"  {n} AS expected,",
            "  p.n AS present,",
            "  (SELECT count(*) FROM artist_aliases) AS total_rows,",
            "  (SELECT count(*) FROM missing) AS missing_keys,",
            "  (SELECT string_agg(m.alias, ', ' ORDER BY m.alias)",
            "     FROM (SELECT alias FROM missing ORDER BY alias LIMIT 20) m) AS missing_list,",
            f"  (p.n = {n} AND NOT EXISTS (SELECT 1 FROM missing)) AS ok",  # noqa: S608 (n is an int; text goes through q())
            "FROM present p;",
            "",
        ]
    )


def write_sql(batch: Path) -> int:
    pairs, twice = load(batch)
    known = {p.ident: p for p in pairs}
    review = batch / "review.md"
    if review.is_file():
        ticked = ticked_pairs(review, known)
    else:
        ticked = set()
        print("no review.md: only the confirmed pairs are used")
    chosen = [p for p in pairs if p.verdict == "confirmed" or p.ident in ticked]
    final = sorted((p for p in chosen if not p.rule), key=lambda p: (p.alias, p.artist_key))
    if len({p.alias for p in final}) != len(final):  # rule (d) makes this impossible
        raise SystemExit("two final rows share an alias: refusing to write")
    if not final:
        print("no pair to upload: nothing written")
        return 1
    confirmed = sum(p.verdict == "confirmed" for p in final)
    from_ticks = len(final) - confirmed
    dropped = rule_counts(chosen)
    for name, body in (
        ("upload_aliases.sql", upload_sql(final, confirmed, from_ticks, dropped)),
        ("verify_aliases.sql", verify_sql(final)),
    ):
        (batch / name).write_text(body, encoding="utf-8", newline="\n")
    common.write_json(
        batch / "aliases_final.json",
        [{"alias": p.alias, "artist_key": p.artist_key} for p in final],
    )
    print(f"pairs in checked.json: {len(pairs)} ({verdict_counts(pairs)})")
    print(f"ticked in review.md: {len(ticked)}")
    print(f"kept before the rules: {len(chosen)}; dropped by the rules: {dropped}")
    print(f"final rows: {len(final)} ({confirmed} confirmed, {from_ticks} ticked)")
    if twice:
        print(f"checked twice with two verdicts: {twice}")
    print(f"wrote upload_aliases.sql, verify_aliases.sql, aliases_final.json in {batch}")
    return 0


# ----- after the upload ------------------------------------------------------------------------------


def number(value: Any) -> int:
    return int(str(value)) if value is not None else 0


def check(batch: Path, dump: Path) -> int:
    rows = common.supabase_rows(dump)
    if len(rows) != 1:
        print(f"FAIL: the dump has {len(rows)} rows, not 1")
        return 1
    row = rows[0]
    expected, present = number(row.get("expected")), number(row.get("present"))
    total, missing = number(row.get("total_rows")), number(row.get("missing_keys"))
    ok = row.get("ok") in (True, "t", "true")
    print(
        f"expected {expected} | present {present} | table rows {total}"
        f" | rows whose artist key no song has {missing} | ok {ok}"
    )
    problems = []
    final = batch / "aliases_final.json"
    if final.is_file() and len(common.read_json(final)) != expected:
        problems.append(
            f"{final.name} has {len(common.read_json(final))} rows: another verify file?"
        )
    if present != expected:
        problems.append(f"{expected - present} uploaded pairs are not in the table")
    if missing:
        problems.append(f"{missing} rows point at no song's artist key (missing_list in the dump)")
    if not ok:
        problems.append("the query's ok is false")
    print("PASS" if not problems else "FAIL: " + "; ".join(problems))
    return 1 if problems else 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument("--batch", type=Path, default=DEFAULT_BATCH, help="the batch folder")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--review", action="store_true", help="write review.md (step 4)")
    mode.add_argument("--check", type=Path, metavar="DUMP", help="check a verify_aliases.sql dump")
    parser.add_argument("--force", action="store_true", help="overwrite a ticked review.md")
    args = parser.parse_args(argv)
    if args.force and not args.review:
        parser.error("--force goes with --review")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.check:
        return check(args.batch, args.check)
    if args.review:
        return write_review(args.batch, args.force)
    return write_sql(args.batch)


if __name__ == "__main__":
    raise SystemExit(main())
