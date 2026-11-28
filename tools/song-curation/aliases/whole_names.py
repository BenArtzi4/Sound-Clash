"""The artist credits the splitter cuts -> the whole-name upload, undo and verify SQL.

The Pick artists list counts a song for each value of its ``songs.artist_keys``
(``song_artist_keys``, migration 049), so the credit ``A & B`` counts for ``a``
and for ``b``. That is right for a duet. A few credits are ONE act whose name
holds ``&`` or a comma, or a Hebrew word that starts with the letter vav (the
splitter reads it as "and"), or a film whose title holds a comma (made-up
examples: ``Salt & Pepper Co``, ``The Lamp, the Owl and the Kettle``). A row of
the private table ``artist_whole_names`` (``name`` = the credit in lower case,
trimmed) makes the list count every song of that credit for the one name.
README.md in this folder, "Whole names", gives the whole run.

``candidates DUMP OUT`` reads a catalog dump (``supabase db query --linked``
JSON with the columns of the README's step 1) and writes a TSV with one row per
credit group ``lower(btrim(artist))`` of the playable songs (``unavailable_at``
null) whose ``artist_keys``, as the dump has them (the database's truth), hold
two or more values. Columns: ``credit`` (the group's most common
``btrim(artist)``; a tie goes to the smallest in byte order), ``name``
(``lower(btrim(artist))``), ``pieces`` (the credit cut as
``song_artist_keys`` cuts it, trimmed, joined with `` | ``), ``songs``, ``kind``
(``film`` when every song has a soundtrack genre, else ``he`` when the name
holds a Hebrew letter, else ``en``) and ``solo`` (per piece: ``yes`` when a
playable song's ``artist_keys`` hold the piece's key but not all of this
credit's keys, so the piece has songs of its own; a longer credit by the same
act does not count). Most songs first, then the credit in byte order. The
credits where the Python split and the dump's keys disagree also go to
``<out stem>.mismatch.tsv``.

``sql REVIEWED OUT`` reads that TSV with four more columns (``research`` and
``check``: ``one`` or ``several``; ``source`` and ``check_note``: short notes)
and uploads the rows marked ``one`` in both. It writes, in the folder of OUT:
OUT (ONE ``INSERT ... ON CONFLICT DO NOTHING``), ``undo_<OUT name>`` (ONE
``DELETE`` of exactly those names), ``verify_<OUT name>`` (ONE read-only
``SELECT``), ``review.txt`` (for the maintainer) and ``contained.txt`` (the
credits that are not uploaded but hold an uploaded name as a part: they stay
cut, the table matches whole credits only). With no row to upload it writes no
SQL file, says so and exits 1.

Never connects to a database or the network. stdout gets counts only; the
files hold real names, so they live in a git-ignored batch folder. A value
that cannot be written or uploaded safely stops the run with a one-line
message (exit 1) before any file is written. How to run, from the repository
root::

    PYTHONUTF8=1 <backend venv python> tools/song-curation/aliases/whole_names.py candidates DUMP OUT.tsv
    PYTHONUTF8=1 <backend venv python> tools/song-curation/aliases/whole_names.py sql REVIEWED.tsv OUT.sql
"""

from __future__ import annotations

import argparse
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import common  # puts the backend first on sys.path, so it stays above the app imports

# isort: split
from app.services.setlist_catalog import SOUNDTRACK_GENRE_SLUGS

# The splitter itself: setlist_text's regex is song_artist_keys()'s, held in step with the
# database by tests/db/test_artist_keys_parity.py. Only it gives the pieces as written.
from app.services.setlist_text import _ARTIST_SPLIT, is_hebrew

CANDIDATE_COLUMNS = ("credit", "name", "pieces", "songs", "kind", "solo")
MISMATCH_COLUMNS = ("credit", "name", "pieces", "artist_keys", "listed")
REVIEW_COLUMNS = ("research", "source", "check", "check_note")
REVIEWED_COLUMNS = CANDIDATE_COLUMNS + REVIEW_COLUMNS
MARKS = ("one", "several")
JOIN = " | "
DASH = "\N{EM DASH}"


# ----- the split -------------------------------------------------------------------------------


def pieces_of(credit: str) -> list[str]:
    """The artists of a credit as written, in credit order.

    Cut as ``song_artist_keys()`` cuts, each piece trimmed of spaces (``btrim``);
    an empty piece, and a piece whose lower case an earlier piece already has,
    are dropped. In lower case they are ``artist_keys(credit)``.
    """
    pieces: dict[str, str] = {}
    for piece in _ARTIST_SPLIT.split(credit):
        trimmed = piece.strip(" ")
        if trimmed:
            pieces.setdefault(trimmed.lower(), trimmed)
    return list(pieces.values())


# The splitter's separators (one regex alternation); holds() puts it on each side of a name.
_SEP = _ARTIST_SPLIT.pattern


def holds(name: str, whole: str) -> bool:
    """True when ``name`` holds ``whole`` as a part: a separator (or an end) on each side."""
    if name == whole:
        return False
    part = re.compile(rf"(?:\A|{_SEP})(?:{re.escape(whole)})(?:{_SEP}|\Z)", _ARTIST_SPLIT.flags)
    return part.search(name) is not None


# ----- candidates ------------------------------------------------------------------------------


@dataclass
class Group:
    """The playable songs whose ``lower(btrim(artist))`` is ``name``."""

    name: str
    song_id: str  # one song of the group, for messages
    spellings: Counter[str] = field(default_factory=Counter)  # btrim(artist) -> songs
    db_keys: set[str] = field(default_factory=set)  # the dump's artist_keys, all songs
    song_keys: list[frozenset[str]] = field(default_factory=list)  # each song's artist_keys
    songs: int = 0
    all_soundtrack: bool = True

    @property
    def credit(self) -> str:
        """The most common spelling; a tie goes to the smallest in byte order.

        Python orders text by code point, which is the order of its UTF-8 bytes.
        """
        return min(self.spellings, key=lambda s: (-self.spellings[s], s))


def song_id(row: Mapping[str, Any]) -> str:
    return str(row.get("id") or row["youtube_id"])


def playable_groups(rows: Iterable[Mapping[str, Any]]) -> dict[str, Group]:
    """The credit groups of the playable songs, one song per id (as ``common.catalog_songs``)."""
    groups: dict[str, Group] = {}
    seen: set[str] = set()
    for row in sorted(rows, key=song_id):
        sid = song_id(row)
        if row.get("unavailable_at") is not None or sid in seen:
            continue
        seen.add(sid)
        artist, keys = row.get("artist"), row.get("artist_keys") or []
        if not isinstance(artist, str):
            raise SystemExit(f"song {sid}: artist is missing or not text")
        if not isinstance(keys, list) or not all(isinstance(k, str) for k in keys):
            raise SystemExit(f"song {sid}: artist_keys is not a JSON list of text")
        credit = artist.strip(" ")
        group = groups.setdefault(credit.lower(), Group(credit.lower(), sid))
        group.spellings[credit] += 1
        group.db_keys.update(keys)
        group.song_keys.append(frozenset(keys))
        group.songs += 1
        if not any(slug in SOUNDTRACK_GENRE_SLUGS for slug in common._genre_slugs(row)):
            group.all_soundtrack = False
    return groups


def kind(group: Group) -> str:
    if group.all_soundtrack:
        return "film"
    return "he" if is_hebrew(group.name) else "en"


def solo_mark(songs_with_piece: Iterable[frozenset[str]], credit_keys: set[str]) -> str:
    """``yes`` when a song holds the piece's key but not all of the credit's keys.

    ``songs_with_piece`` are the key sets of the playable songs that hold the
    piece's key. A song that holds every key of the credit (the credit itself, or
    a longer credit by the same act) does not show that the piece has songs of
    its own.
    """
    return "no" if all(credit_keys <= keys for keys in songs_with_piece) else "yes"


def tsv_line(cells: Sequence[str], where: str) -> str:
    """One TSV line; a tab or a line break inside a value would break the file."""
    for value in cells:
        if "\t" in value or "".join(value.splitlines()) != value:
            raise SystemExit(f"{where}: a value holds a tab or a line break")
    return "\t".join(cells)


def write_lines(path: Path, lines: Sequence[str]) -> None:
    path.write_text("".join(line + "\n" for line in lines), encoding="utf-8", newline="\n")


def write_candidates(dump: Path, out: Path) -> int:
    groups = playable_groups(common.supabase_rows(dump))
    songs_of_key: dict[str, list[frozenset[str]]] = {}  # key -> the playable songs' key sets
    for group in groups.values():
        for keys in group.song_keys:
            for key in keys:
                songs_of_key.setdefault(key, []).append(keys)

    listed = sorted(
        (g for g in groups.values() if len(g.db_keys) >= 2), key=lambda g: (-g.songs, g.credit)
    )
    lines = [tsv_line(CANDIDATE_COLUMNS, "header")]
    for group in listed:
        pieces = pieces_of(group.credit)
        solo = [solo_mark(songs_of_key.get(p.lower(), []), group.db_keys) for p in pieces]
        cells = [group.credit, group.name, JOIN.join(pieces), str(group.songs), kind(group)]
        lines.append(tsv_line([*cells, JOIN.join(solo)], f"the credit of song {group.song_id}"))

    mismatched = sorted(
        (g for g in groups.values() if set(common.artist_keys(g.credit)) != g.db_keys),
        key=lambda g: g.credit,
    )
    mismatch_lines = [tsv_line(MISMATCH_COLUMNS, "header")]
    for group in mismatched:
        cells = [group.credit, group.name, JOIN.join(pieces_of(group.credit))]
        cells += [JOIN.join(sorted(group.db_keys)), "yes" if len(group.db_keys) >= 2 else "no"]
        mismatch_lines.append(tsv_line(cells, f"the credit of song {group.song_id}"))

    mismatch = out.with_suffix(".mismatch.tsv")
    out.parent.mkdir(parents=True, exist_ok=True)
    write_lines(out, lines)
    write_lines(mismatch, mismatch_lines)
    print(f"playable songs: {sum(g.songs for g in groups.values())}, in {len(groups)} credits")
    print(f"listed: {len(listed)} credits that the database cuts into two or more keys")
    print(
        f"the Python split and the database disagree on {len(mismatched)} credits"
        f" (listed in {mismatch.name}; the database's keys decided)"
    )
    print(f"wrote {out} and {mismatch}")
    return 0


# ----- sql ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Reviewed:
    line: int
    credit: str
    name: str
    songs: int
    research: str
    source: str
    check: str
    check_note: str


def read_reviewed(path: Path) -> list[Reviewed]:
    """The rows of a reviewed TSV; a bad header, mark, song count or repeated name stops the run."""
    numbered = [
        (no, line)
        for no, line in enumerate(path.read_text(encoding="utf-8-sig").split("\n"), 1)
        if line.strip()
    ]
    if not numbered or tuple(numbered[0][1].split("\t")) != REVIEWED_COLUMNS:
        raise SystemExit(
            f"{path.name}: the first line must be the header {' '.join(REVIEWED_COLUMNS)}"
            " (tab-separated)"
        )
    rows: list[Reviewed] = []
    first_line: dict[str, int] = {}
    for no, line in numbered[1:]:
        where = f"{path.name} line {no}"
        cells = line.split("\t")
        if len(cells) > len(REVIEWED_COLUMNS):
            raise SystemExit(f"{where}: more cells than the {len(REVIEWED_COLUMNS)} columns")
        cells += [""] * (len(REVIEWED_COLUMNS) - len(cells))  # empty notes at the end may be cut
        row = dict(zip(REVIEWED_COLUMNS, cells, strict=True))
        research, check = row["research"].strip(), row["check"].strip()
        for column, mark in (("research", research), ("check", check)):
            if mark not in MARKS:
                raise SystemExit(f"{where}: {column} is not {' or '.join(MARKS)}")
        try:
            songs = int(row["songs"])
        except ValueError:
            raise SystemExit(f"{where}: songs is not a number") from None
        if row["name"] in first_line:
            raise SystemExit(f"{where}: the same name as line {first_line[row['name']]}")
        first_line[row["name"]] = no
        rows.append(
            Reviewed(
                line=no,
                credit=row["credit"],
                name=row["name"],
                songs=songs,
                research=research,
                source=row["source"],
                check=check,
                check_note=row["check_note"],
            )
        )
    return rows


def name_literal(name: str, where: str) -> str:
    """The SQL literal of a name to upload; refused unless ``artist_whole_names`` takes it as it is."""
    if not name:
        raise SystemExit(f"{where}: the name is empty")
    if any(unicodedata.category(ch) == "Cc" for ch in name):
        raise SystemExit(f"{where}: the name holds a control character")
    if name != name.strip(" ").lower():
        raise SystemExit(f"{where}: the name is not trimmed and in lower case")
    return "'" + name.replace("'", "''") + "'"


def note(text: str) -> str:
    return " ".join(text.split())


def review_text(upload: Sequence[Reviewed], disagree: Sequence[Reviewed]) -> list[str]:
    out = [f"One artist (will be uploaded): {len(upload)}"]
    out += [
        f"{r.credit} instead of {JOIN.join(pieces_of(r.credit))} {DASH}"
        f" {note(r.source) or '(no source)'}"
        for r in upload
    ]
    out += ["", f"The agents did not agree (not uploaded): {len(disagree)}"]
    out += [
        f"{r.credit} {DASH} first: {r.research}, second: {r.check} {DASH}"
        f" {note(r.check_note) or note(r.source) or '(no note)'}"
        for r in disagree
    ]
    return out


def upload_sql(values: Sequence[str], verify: str) -> str:
    return "\n".join(
        [
            f"-- artist_whole_names upload: {len(values)} names (both agents marked them one), made"
            f" by whole_names.py on {date.today().isoformat()}.",
            "-- ONE statement. A second run adds nothing (ON CONFLICT DO NOTHING). Apply only when",
            f"-- the maintainer names this production write; then run {verify}.",
            "INSERT INTO artist_whole_names (name) VALUES",
            ",\n".join(f"  ({v})" for v in values),
            "ON CONFLICT DO NOTHING;",
            "",
        ]
    )


def undo_sql(values: Sequence[str], upload: str, verify: str) -> str:
    return "\n".join(
        [
            f"-- artist_whole_names undo, made by whole_names.py on {date.today().isoformat()}.",
            f"-- ONE statement that deletes exactly the {len(values)} names of {upload}.",
            "-- A name the table held before the upload is deleted too: compare the counts taken",
            "-- before the upload. Apply only when the maintainer names this production write;",
            f"-- then run {verify} again (present is false on every row).",
            "DELETE FROM artist_whole_names WHERE name IN (",
            ",\n".join(f"  {v}" for v in values),
            ");",
            "",
        ]
    )


def verify_sql(values: Sequence[str], upload: str) -> str:
    return "\n".join(
        [
            f"-- artist_whole_names verify (read-only): one row per name of {upload}; present is",
            "-- true on every row after the upload and false on every row after the undo.",
            "WITH expected (name) AS (",
            "  VALUES",
            ",\n".join(f"  ({v})" for v in values),
            ")",
            "SELECT e.name, w.name IS NOT NULL AS present",
            "FROM expected e",
            "LEFT JOIN artist_whole_names w ON w.name = e.name",
            "ORDER BY e.name;",
            "",
        ]
    )


def write_sql(reviewed: Path, out: Path) -> int:
    rows = sorted(read_reviewed(reviewed), key=lambda r: (-r.songs, r.credit))
    upload = [r for r in rows if r.research == r.check == "one"]
    disagree = [r for r in rows if r.research != r.check]
    for r in upload:
        where = f"{reviewed.name} line {r.line}"
        name_literal(r.name, where)
        if r.name != r.credit.strip(" ").lower():
            raise SystemExit(f"{where}: the name is not the credit in lower case")
    names = sorted(r.name for r in upload)
    contained = [(r, [n for n in names if holds(r.name, n)]) for r in rows if r.name not in names]
    contained = [(r, held) for r, held in contained if held]

    folder = out.parent
    folder.mkdir(parents=True, exist_ok=True)
    write_lines(folder / "review.txt", review_text(upload, disagree))
    write_lines(
        folder / "contained.txt",
        [f"Credits that hold a whole name inside (they stay cut): {len(contained)}"]
        + [f"{r.credit} {DASH} holds {', '.join(held)}" for r, held in contained],
    )
    print(
        f"rows in {reviewed.name}: {len(rows)} (both one: {len(upload)}, both several:"
        f" {sum(r.research == r.check == 'several' for r in rows)}, the agents did not agree:"
        f" {len(disagree)})"
    )
    print(f"credits that hold an uploaded name inside (they stay cut): {len(contained)}")
    if not upload:
        print(f"no row to upload: no SQL file written; wrote review.txt, contained.txt in {folder}")
        return 1
    values = [name_literal(n, "upload") for n in names]
    verify, undo = f"verify_{out.name}", f"undo_{out.name}"
    out.write_text(upload_sql(values, verify), encoding="utf-8", newline="\n")
    (folder / undo).write_text(undo_sql(values, out.name, verify), encoding="utf-8", newline="\n")
    (folder / verify).write_text(verify_sql(values, out.name), encoding="utf-8", newline="\n")
    print(f"names uploaded: {len(names)}")
    print(f"wrote {out.name}, {undo}, {verify}, review.txt, contained.txt in {folder}")
    return 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    commands = parser.add_subparsers(dest="command", required=True)
    candidates = commands.add_parser(
        "candidates", help="list the credits the database cuts into two or more keys (a TSV)"
    )
    candidates.add_argument("dump", type=Path, help="a catalog dump (README.md, step 1)")
    candidates.add_argument("out", type=Path, help="the TSV to write")
    sql = commands.add_parser(
        "sql", help="the upload, undo and verify SQL, review.txt and contained.txt"
    )
    sql.add_argument("reviewed", type=Path, help="the candidates TSV with the four review columns")
    sql.add_argument("out", type=Path, help="the upload SQL to write; the other files go beside it")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "candidates":
        return write_candidates(args.dump, args.out)
    return write_sql(args.reviewed, args.out)


if __name__ == "__main__":
    raise SystemExit(main())
