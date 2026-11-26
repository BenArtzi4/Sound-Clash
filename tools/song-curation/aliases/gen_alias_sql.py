"""Checked alias pairs -> the maintainer's review page, then the upload, verify and undo SQL.

Steps 5 and 6 of the alias run, and the ``--check`` of step 8 (README.md in
this folder). Reads ``<batch>/checked.json`` (rows with ``artist_key``,
``alias``, ``source_url``, ``verdict`` = confirmed | wrong | unsure,
``evidence``), the pairs that steps 2 and 3 proposed
(``<batch>/candidates.json``, and ``<batch>/research.json`` when there was a
research step) and the catalog snapshot ``<batch>/_dumps/catalog_raw.json``.
Never connects to a database.

Every alias is cleaned as ``artist_aliases`` stores it (``common.clean_alias``)
and a pair that appears twice is one pair (with the less sure verdict when
the two rows disagree). The rules then drop a pair, mechanically; a dropped
pair is never uploaded and gets no box on the review page:

- (a) its ``artist_key`` is not a value of the snapshot's ``artist_keys``;
- (b) the alias norms to its own artist key;
- (c) the alias norms to a catalog artist key: the matcher's rule 2 reads
  the alias table for every artist named on a line, catalog artists
  included, so the row would let a line naming that catalog artist match a
  song of the same title by the alias's artist (a cross-artist match);
- (d) the same alias (norm form) gives two or more artist keys among the
  pairs that can be uploaded (confirmed, and ticked in the default run): all
  of those pairs go (the matcher would keep the first, the database the
  last). An unsure or wrong pair that is not ticked never counts here, so it
  never drops a confirmed pair; it is dropped itself when its alias already
  gives another key;
- (e) the pair (after the same cleaning) is in neither candidates.json nor
  research.json: the checking step changed or added it.

``--review`` writes ``<batch>/review.md``: the unsure and wrong pairs with a
box each, the dropped pairs, and the number of confirmed pairs. It refuses
to overwrite a review.md with a ticked box unless ``--force`` (which loses
the ticks).

The default run needs ``<batch>/_dumps/aliases_raw.json`` (the step 1 dump of
``select alias, artist_key from artist_aliases order by alias``; an empty
table gives ``"rows": []``). It keeps the confirmed pairs and the pairs
ticked in review.md (read from the ticked line's text), minus every dropped
pair, refuses to write when two of them norm alike with different keys, and
writes ``upload_aliases.sql`` (one INSERT ... ON CONFLICT (alias) DO UPDATE),
``aliases_final.json`` (this upload's rows), ``verify_aliases.sql`` (one
read-only SELECT), ``undo_aliases.sql`` (one statement that puts the table
back as the dump has it) and ``aliases_after_upload.json`` (the whole table
as it will be after the upload, which the pilot replay of step 7 reads).

``--check DUMP`` reads the CLI's JSON output of ``verify_aliases.sql`` and
prints PASS or FAIL; exit code 0 or 1. With ``--undone`` it checks instead
that the table is back to the dump after ``undo_aliases.sql``.

stdout gets counts only; every file this writes holds real names, so the
batch is a git-ignored folder. How to run, from the repository root::

    PYTHONUTF8=1 <backend venv python> tools/song-curation/aliases/gen_alias_sql.py [--batch DIR] [--review [--force] | --check DUMP [--undone]]
"""

from __future__ import annotations

import argparse
import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence, Set
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
    "c": "the alias norms to a catalog artist key: a line naming that artist could match"
    " this pair's artist's songs",
    "d": "the same alias (norm form) gives two or more artist keys",
    "e": "the pair is in neither candidates.json nor research.json",
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
    rule: str = ""  # a-e when a rule drops it

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


def read_proposed(batch: Path) -> set[tuple[str, str]]:
    """The (alias, artist_key) pairs steps 2 and 3 proposed, cleaned as checked.json's are.

    ``candidates.json`` is required (step 2 always writes it, an empty list
    too); ``research.json`` counts when it exists (no research step, no file).
    """
    proposed: set[tuple[str, str]] = set()
    for name, required in (("candidates.json", True), ("research.json", False)):
        path = batch / name
        if not path.is_file():
            if required:
                raise SystemExit(f"{path} is missing (README.md, step 2 writes it)")
            continue
        rows = common.read_json(path)
        if not isinstance(rows, list):
            raise SystemExit(f"{path}: not a JSON list")
        for no, row in enumerate(rows, 1):
            where = f"{name} row {no}"
            if not isinstance(row, Mapping):
                raise SystemExit(f"{where}: not a JSON object")
            alias = common.clean_alias(text(row, "alias", where))
            proposed.add((alias, text(row, "artist_key", where).strip()))
    return proposed


def apply_rules(
    pairs: Sequence[Pair],
    rows: Sequence[Mapping[str, Any]],
    proposed: Set[tuple[str, str]],
    ticked: Set[tuple[str, str]] = frozenset(),
) -> None:
    """Set ``rule`` on every pair a rule drops: the first of (a), (b), (c), (e), then (d).

    Rule (d) looks only at the keys that the pairs which can be uploaded give
    an alias: the confirmed pairs and the ``ticked`` ones. A pair of those is
    dropped when its alias gives two or more keys; any other pair (unsure or
    wrong, not ticked) is dropped when its alias gives a key other than its
    own, so it is never offered for a tick that would drop a confirmed pair.
    """
    db_keys = {key for row in rows for key in row.get("artist_keys") or []}
    direct = {norm(k) for song in common.catalog_songs(rows) for k in song.artist_keys} - {""}
    for p in pairs:
        if p.artist_key not in db_keys:
            p.rule = "a"
        elif norm(p.alias) == norm(p.artist_key):
            p.rule = "b"
        elif norm(p.alias) in direct:
            p.rule = "c"
        elif p.ident not in proposed:
            p.rule = "e"
    targets: dict[str, set[str]] = {}
    for p in pairs:
        if not p.rule and (p.verdict == "confirmed" or p.ident in ticked):
            targets.setdefault(norm(p.alias), set()).add(p.artist_key)
    for p in pairs:
        if not p.rule and len(targets.get(norm(p.alias), set()) | {p.artist_key}) > 1:
            p.rule = "d"


def load(batch: Path, with_ticks: bool) -> tuple[list[Pair], int, set[tuple[str, str]]]:
    """The pairs with their rules, how many had two verdicts, and the ticked pairs.

    ``with_ticks`` reads the ticks of review.md (the default run); the review
    page itself is made with none.
    """
    pairs, twice = read_checked(batch / "checked.json")
    ticked: set[tuple[str, str]] = set()
    if with_ticks:
        review = batch / "review.md"
        if review.is_file():
            ticked = ticked_pairs(review, {p.ident for p in pairs})
        else:
            print("no review.md: only the confirmed pairs are used")
    rows = common.supabase_rows(batch / "_dumps" / "catalog_raw.json")
    apply_rules(pairs, rows, read_proposed(batch), ticked)
    return sorted(pairs, key=lambda p: (p.artist_key, p.alias)), twice, ticked


def rule_counts(pairs: Iterable[Pair]) -> str:
    counts = Counter(p.rule for p in pairs if p.rule)
    return ", ".join(f"({rule}) {counts[rule]}" for rule in RULES)


def verdict_counts(pairs: Iterable[Pair]) -> str:
    counts = Counter(p.verdict for p in pairs)
    return ", ".join(f"{verdict} {counts[verdict]}" for verdict in VERDICTS)


# ----- step 5: the review page -------------------------------------------------------------------


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
        "Two ticked pairs whose alias is the same (in norm form) with different artist keys are"
        " both dropped (rule d): tick one of them.",
        "To keep a pair the rules dropped, fix checked.json and run `gen_alias_sql.py --review`"
        " again (with `--force` once a box is ticked: it clears the ticks, so copy the ticked"
        " lines first and tick them again).",
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
    pairs, twice, _ = load(batch, with_ticks=False)
    path = batch / "review.md"
    if path.is_file() and ANY_TICK.search(path.read_text(encoding="utf-8")) and not force:
        print(
            f"{path} has a ticked box: not overwritten (--force replaces it and clears the"
            " ticks: copy the ticked lines first)"
        )
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


# ----- step 6: the SQL -----------------------------------------------------------------------------


def ticked_pairs(path: Path, known: Set[tuple[str, str]]) -> set[tuple[str, str]]:
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
            "-- upload_aliases.sql are present, no row of the table points at an artist key",
            "-- that no song has, and no row's alias is itself a song's artist key (a row the",
            "-- matcher would read for that artist's lines too: it re-checks older rows after",
            "-- later catalog additions). Save the CLI's output and run gen_alias_sql.py --check.",
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
            "),",
            "key_alias AS (",
            "  SELECT a.alias",
            "  FROM artist_aliases a",
            "  WHERE EXISTS (SELECT 1 FROM songs s WHERE a.alias = ANY (s.artist_keys))",
            ")",
            "SELECT",
            f"  {n} AS expected,",
            "  p.n AS present,",
            "  (SELECT count(*) FROM artist_aliases) AS total_rows,",
            "  (SELECT count(*) FROM missing) AS missing_keys,",
            "  (SELECT string_agg(m.alias, ', ' ORDER BY m.alias)",
            "     FROM (SELECT alias FROM missing ORDER BY alias LIMIT 20) m) AS missing_list,",
            "  (SELECT count(*) FROM key_alias) AS alias_is_key,",
            f"  (p.n = {n} AND NOT EXISTS (SELECT 1 FROM missing)"  # noqa: S608 (n is an int; text goes through q())
            " AND NOT EXISTS (SELECT 1 FROM key_alias)) AS ok",
            "FROM present p;",
            "",
        ]
    )


@dataclass(frozen=True)
class Upload:
    """What the upload does to the table the dump shows."""

    table: list[dict[str, str]]  # the table after the upload, sorted by alias
    added: list[Pair]  # final rows whose alias the dump does not have
    # Final rows whose alias the dump has with another key: (row, the dump's key).
    moved: list[tuple[Pair, str]]
    dump_rows: int


def read_dump(path: Path) -> dict[str, str]:
    """``alias -> artist_key`` of the step 1 dump of ``artist_aliases``."""
    table: dict[str, str] = {}
    for no, row in enumerate(common.supabase_rows(path), 1):
        where = f"{path.name} row {no}"
        if not isinstance(row, Mapping):
            raise SystemExit(f"{where}: not a JSON object (a dump of another query?)")
        table[text(row, "alias", where)] = text(row, "artist_key", where)
    return table


def after_upload(dump: Mapping[str, str], final: Sequence[Pair]) -> Upload:
    """The table as it will be after the upload, and the rows the upload adds and moves.

    A final row replaces the dump's row of the same alias, as ``ON CONFLICT
    (alias) DO UPDATE`` does; every other row stays.
    """
    added = [p for p in final if p.alias not in dump]
    moved = [(p, dump[p.alias]) for p in final if p.alias in dump and dump[p.alias] != p.artist_key]
    rows = dict(dump)
    rows.update((p.alias, p.artist_key) for p in final)
    table = [{"alias": a, "artist_key": k} for a, k in sorted(rows.items())]
    return Upload(table, added, moved, len(dump))


def undo_sql(upload: Upload) -> str:
    """ONE statement that puts the table back as the dump has it, with its counts.

    It deletes the rows the upload added and gives the rows it moved their
    old key back, each only while the row still holds what the upload wrote,
    so a second run, or a run before the upload, changes nothing.
    """
    n_added, n_moved = len(upload.added), len(upload.moved)
    ctes = []
    if upload.added:
        ctes += [
            "added (added_alias, added_key) AS (",
            "  VALUES",
            ",\n".join(f"  ({q(p.alias)}, {q(p.artist_key)})" for p in upload.added),
            "),",
        ]
    if upload.moved:
        ctes += [
            "moved (moved_alias, old_key, new_key) AS (",
            "  VALUES",
            ",\n".join(f"  ({q(p.alias)}, {q(old)}, {q(p.artist_key)})" for p, old in upload.moved),
            "),",
        ]
    if upload.added:
        ctes += [
            "d AS (",
            "  DELETE FROM artist_aliases",
            "  WHERE (alias, artist_key) IN (SELECT added_alias, added_key FROM added)",
            "  RETURNING alias",
            "),",
        ]
    if upload.moved:
        ctes += [
            "u AS (",
            "  UPDATE artist_aliases SET artist_key = m.old_key",
            "  FROM moved m",
            "  WHERE alias = m.moved_alias AND artist_key = m.new_key",
            "  RETURNING alias",
            "),",
        ]
    if ctes:
        ctes[0] = "WITH " + ctes[0]
        ctes[-1] = ")"
    deleted = "(SELECT count(*) FROM d)" if upload.added else "0"
    restored = "(SELECT count(*) FROM u)" if upload.moved else "0"
    return "\n".join(
        [
            f"-- artist_aliases undo, made by gen_alias_sql.py on {date.today().isoformat()}."
            " ONE statement: it deletes",
            f"-- the {n_added} rows upload_aliases.sql adds and gives the {n_moved} rows it moves"
            " their old artist key",
            "-- back, each only while the row still holds what the upload wrote, so the table is"
            " again",
            f"-- as _dumps/aliases_raw.json shows it ({upload.dump_rows} rows). deleted must equal"
            " expected_deleted",
            "-- and restored expected_restored. Apply only when the maintainer names this"
            " production write;",
            "-- then run verify_aliases.sql again and gen_alias_sql.py --check DUMP --undone.",
            *ctes,
            "SELECT",
            f"  {n_added} AS expected_deleted,",
            f"  {deleted} AS deleted,",
            f"  {n_moved} AS expected_restored,",
            f"  {restored} AS restored;",
            "",
        ]
    )


def final_clashes(final: Sequence[Pair]) -> list[list[Pair]]:
    """Groups of final rows whose aliases norm alike while their artist keys differ."""
    groups: dict[str, list[Pair]] = {}
    for p in final:
        groups.setdefault(norm(p.alias), []).append(p)
    return [g for g in groups.values() if len({p.artist_key for p in g}) > 1]


def write_sql(batch: Path) -> int:
    dump_path = batch / "_dumps" / "aliases_raw.json"
    if not dump_path.is_file():
        raise SystemExit(
            f"{dump_path} is missing: take the artist_aliases dump of README.md step 1 (an empty"
            ' table gives "rows": []), then run this again'
        )
    dump = read_dump(dump_path)
    pairs, twice, ticked = load(batch, with_ticks=True)
    chosen = [p for p in pairs if p.verdict == "confirmed" or p.ident in ticked]
    final = sorted((p for p in chosen if not p.rule), key=lambda p: (p.alias, p.artist_key))
    clashes = final_clashes(final)
    if clashes:  # rule (d) should make this impossible; never upload it
        named = "; ".join(
            " / ".join(f"{p.alias!r} -> {p.artist_key!r}" for p in g) for g in clashes
        )
        raise SystemExit(
            f"refusing to write: final rows norm alike with different artist keys: {named}"
        )
    if not final:
        print("no pair to upload: nothing written")
        return 1
    confirmed = sum(p.verdict == "confirmed" for p in final)
    from_ticks = len(final) - confirmed
    dropped = rule_counts(chosen)
    upload = after_upload(dump, final)
    for name, body in (
        ("upload_aliases.sql", upload_sql(final, confirmed, from_ticks, dropped)),
        ("verify_aliases.sql", verify_sql(final)),
        ("undo_aliases.sql", undo_sql(upload)),
    ):
        (batch / name).write_text(body, encoding="utf-8", newline="\n")
    common.write_json(
        batch / "aliases_final.json",
        [{"alias": p.alias, "artist_key": p.artist_key} for p in final],
    )
    common.write_json(batch / "aliases_after_upload.json", upload.table)
    print(f"pairs in checked.json: {len(pairs)} ({verdict_counts(pairs)})")
    print(f"ticked in review.md: {len(ticked)}")
    print(f"kept before the rules: {len(chosen)}; dropped by the rules: {dropped}")
    print(f"final rows: {len(final)} ({confirmed} confirmed, {from_ticks} ticked)")
    if twice:
        print(f"checked twice with two verdicts: {twice}")
    print(
        f"table now (_dumps/aliases_raw.json): {upload.dump_rows} rows; after the upload:"
        f" {len(upload.table)} rows (aliases_after_upload.json); the upload adds"
        f" {len(upload.added)} rows and moves {len(upload.moved)} of the dump's rows to another"
        " artist key"
    )
    print(
        "wrote upload_aliases.sql, verify_aliases.sql, undo_aliases.sql, aliases_final.json,"
        f" aliases_after_upload.json in {batch}"
    )
    return 0


# ----- step 8: after the upload ------------------------------------------------------------------------


def number(value: Any) -> int:
    return int(str(value)) if value is not None else 0


def check(batch: Path, dump: Path, undone: bool) -> int:
    """PASS or FAIL on the CLI's output of verify_aliases.sql.

    After the upload: every uploaded pair is in the table, no row points at
    an artist key no song has, and no row's alias is a song's artist key.
    With ``undone`` (after undo_aliases.sql): the table is back to the step 1
    dump, so it has the dump's row count and holds only the uploaded pairs
    the dump already had.
    """
    rows = common.supabase_rows(dump)
    if len(rows) != 1:
        print(f"FAIL: the dump has {len(rows)} rows, not 1")
        return 1
    row = rows[0]
    expected, present = number(row.get("expected")), number(row.get("present"))
    total, missing = number(row.get("total_rows")), number(row.get("missing_keys"))
    key_alias = number(row.get("alias_is_key"))
    ok = row.get("ok") in (True, "t", "true")
    print(
        f"expected {expected} | present {present} | table rows {total}"
        f" | rows whose artist key no song has {missing}"
        f" | rows whose alias is a song's artist key {key_alias} | ok {ok}"
    )
    problems = []
    final_path = batch / "aliases_final.json"
    final = common.read_json(final_path) if final_path.is_file() else None
    if final is not None and len(final) != expected:
        problems.append(f"{final_path.name} has {len(final)} rows: another verify file?")
    if "alias_is_key" not in row:
        problems.append(
            "the dump has no alias_is_key: an older verify_aliases.sql? run step 6 again"
        )
    if undone:
        if final is None:
            raise SystemExit(f"{final_path} is missing: --undone needs this batch's step 6 files")
        before = read_dump(batch / "_dumps" / "aliases_raw.json")
        had = sum(before.get(r["alias"]) == r["artist_key"] for r in final)
        print(
            f"before the upload (_dumps/aliases_raw.json): {len(before)} rows, {had} of the pairs"
        )
        if total != len(before):
            problems.append(f"the table has {total} rows, the dump before the upload {len(before)}")
        if present != had:
            problems.append(f"{present} of the pairs are in the table, {had} before the upload")
        print(
            "PASS: the table is back to the dump"
            if not problems
            else "FAIL: " + "; ".join(problems)
        )
        return 1 if problems else 0
    if present != expected:
        problems.append(f"{expected - present} uploaded pairs are not in the table")
    if missing:
        problems.append(f"{missing} rows point at no song's artist key (missing_list in the dump)")
    if key_alias:
        problems.append(f"{key_alias} rows have an alias that is a song's artist key (rule c)")
    if not ok:
        problems.append("the query's ok is false")
    print("PASS" if not problems else "FAIL: " + "; ".join(problems))
    return 1 if problems else 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument("--batch", type=Path, default=DEFAULT_BATCH, help="the batch folder")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--review", action="store_true", help="write review.md (step 5)")
    mode.add_argument(
        "--check", type=Path, metavar="DUMP", help="check a verify_aliases.sql dump (step 8)"
    )
    parser.add_argument(
        "--force", action="store_true", help="overwrite a ticked review.md (clears the ticks)"
    )
    parser.add_argument(
        "--undone",
        action="store_true",
        help="with --check: expect the table as it was before the upload (after undo_aliases.sql)",
    )
    args = parser.parse_args(argv)
    if args.force and not args.review:
        parser.error("--force goes with --review")
    if args.undone and not args.check:
        parser.error("--undone goes with --check")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.check:
        return check(args.batch, args.check, args.undone)
    if args.review:
        return write_review(args.batch, args.force)
    return write_sql(args.batch)


if __name__ == "__main__":
    raise SystemExit(main())
