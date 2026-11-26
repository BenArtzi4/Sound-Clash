"""Replay the setlist pilot's 14 playlists through the product's setlist matcher.

Step 7 of the alias run, and the API replay of step 8 (README.md in this
folder, which also lists the files the pilot folder must hold).

The 2026-11-24 pilot matched 14 real playlists against the catalog offline,
with a script of its own. This tool reads the same lists with the product's
code (``setlist_text.parse_setlist_text``, ``setlist_matcher.match_setlist``)
and an optional alias file, so an alias table is proven before it is
uploaded. It reads the backend read-only and writes only its report file.

PASS needs both:

- Every list's pass count reaches its required count. The pass count is the
  distinct tier-1 songs of the lines matched by any rule except
  ``artist_or_film``: a line that names a whole artist is not a song the
  pilot counted. The required count (Ruling X2) is the pilot's count
  (``PILOT_COUNTS``) minus the file's entries in
  ``_dumps/by_design_losses.txt`` that the product does not match: pilot
  matches that a settled rule refuses by design. An absent file means no
  exceptions (stdout says so); an entry for an unknown file or a line the
  file does not have, or a second entry for the same song line of a file,
  stops the run (exit code 2), so a stale list cannot lower a gate.
- No refused trap (``_dumps/refused_traps.txt``: a title-only line whose
  catalog song is by another performer) matches anything.

A missing required file of the pilot folder (the 14 playlists and
``_dumps/refused_traps.txt``; offline also ``_dumps/should_match.txt`` and
``results/NN-*.detail.txt``) stops the run before anything is matched or
sent, with one line naming the files (exit code 2).

stdout gets one table (file names and numbers only), the trap totals, the
lost / gained / other-song totals against the pilot (offline) and the
verdict. The report file holds real names, so it lives in the git-ignored
batch folder. It has the extra lines a list reads, the lines lost and gained
against the pilot, the feat. notes on lines with no separator that matched by
title alone, and the "&"/comma credits that the same-artist fill cuts into
pieces.

``--api BASE_URL`` posts the same lists to ``POST /setlists/check`` instead,
read-only, after the alias upload. The answer does not name the rule, so
there the pass count is the whole tier 1 (``list_songs``).

How to run, from the worktree root::

    PYTHONUTF8=1 C:/Users/yulin/GBA/Sound-Clash/backend/.venv/Scripts/python.exe tools/song-curation/aliases/replay_pilot.py [--aliases FILE]

That venv belongs to the main tree; this imports the worktree's
``backend/app`` because common.py puts the worktree's backend first on
``sys.path``. Exit code 0 on PASS, 1 on FAIL, 2 on a bad by-design list or a
missing pilot file.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import common  # puts the backend first on sys.path, so it stays above the app imports

# isort: split
from app.db.errors import SetlistError
from app.services.setlist_matcher import (
    CatalogIndex,
    CatalogSong,
    LineResult,
    SetlistMatch,
    _fill_keys,
    _match,
    match_line,
    match_setlist,
)
from app.services.setlist_text import ListLine, artist_keys, clean_title, norm, parse_setlist_text

HERE = Path(__file__).resolve().parent
BATCHES = HERE.parent / "batches"
DEFAULT_PILOT = BATCHES / "2026-11-24-setlist-pilot"
DEFAULT_CATALOG = BATCHES / "2026-11-25-aliases" / "_dumps" / "catalog_raw.json"
REPORT_NAME = "replay_report.txt"
BY_DESIGN_NAME = "by_design_losses.txt"  # in <pilot>/_dumps/ (Ruling X2)

# Per playlist, in file order (01 to 14): the songs the pilot found (its
# in_game count), and its unique song lines (design doc section 2).
PILOT_COUNTS = (27, 17, 4, 20, 11, 6, 15, 28, 5, 7, 13, 4, 26, 23)
PILOT_SONGS = (85, 50, 30, 50, 38, 36, 60, 85, 44, 63, 100, 57, 62, 89)
# The pilot's verdicts that count as found (pilot_match.py).
PILOT_FOUND = frozenset(
    {"strict", "cleaned", "fuzzy", "alias", "translit", "soundtrack", "no_artist"}
)

API_PAUSE_SECONDS = 7  # POST /setlists/check allows 10 requests a minute
API_RETRY_SECONDS = 60
API_TIMEOUT_SECONDS = 120  # a cold Render start takes up to about 30 s
USER_AGENT = "alias-replay/1.0"
ERROR_CHARS = 200  # of an error answer's body, on stdout

# A feat. note: "feat", "ft" or "featuring" as a whole word, in brackets or not.
FEAT_NOTE = re.compile(r"(?<![^\W\d_])(?:feat|ft|featuring)(?![^\W\d_])", re.IGNORECASE)

Key = tuple[str, tuple[str, ...]]


# ----- reading the pilot's files ----------------------------------------------------


@dataclass(frozen=True)
class PilotLine:
    """One line of a pilot results or trap file: ``<verdict> | <artist> - <title>[   ==>   <song>]``."""

    verdict: str
    text: str  # "<artist> - <title>" as the pilot wrote it; " - <title>" when it had no artist
    artist: str
    title: str
    catalog: str  # "<catalog artist> - <catalog title>", or "" when the pilot found nothing

    @property
    def found(self) -> bool:
        return self.verdict in PILOT_FOUND

    @property
    def list_text(self) -> str:
        """The text a host would paste: the line, or the bare title when it had no artist."""
        return self.title if not self.artist else self.text.strip()


def read_pilot_lines(path: Path) -> list[PilotLine]:
    lines = []
    for row in path.read_text(encoding="utf-8").splitlines():
        if not row.strip() or row.startswith("#"):
            continue
        verdict, _, rest = row.partition(" | ")
        text, _, catalog = rest.partition("   ==>   ")
        artist, _, title = text.partition(" - ")
        lines.append(
            PilotLine(verdict.strip(), text, artist.strip(), title.strip(), catalog.strip())
        )
    return lines


def unique_by_text(lines: Sequence[PilotLine]) -> list[PilotLine]:
    """The lines once each by the text a host would paste, first one first."""
    seen: dict[str, PilotLine] = {}
    for p in lines:
        seen.setdefault(p.list_text, p)
    return list(seen.values())


# ----- the product's results ------------------------------------------------------------


def sides(line: ListLine) -> tuple[str, str]:
    """(artist, title) read the pilot's way: the left side is the artist."""
    return ("", line.left) if line.right is None else (line.left, line.right)


def dedupe_key(artist: str, title: str) -> Key:
    """The pilot's dedupe key, built with the product's text functions."""
    return norm(clean_title(title)), artist_keys(artist)


def counted(result: LineResult) -> bool:
    """True when a line counts toward the pass count (any rule except artist_or_film)."""
    return bool(result.songs) and result.rule != "artist_or_film"


def song_text(song: CatalogSong) -> str:
    return f"{song.artist} - {song.title}"


def outcome(result: LineResult) -> str:
    if not result.songs:
        return f"not found ({result.reason})"
    more = f" (+{len(result.songs) - 1} more)" if len(result.songs) > 1 else ""
    return f"{result.rule} ==> {song_text(result.songs[0])}{more}"


@dataclass(frozen=True)
class ByDesign:
    """A pilot match that a settled rule refuses by design (Ruling X2)."""

    file: str  # the playlist's file name
    reason: str  # e.g. one_word_soundtrack_title
    line: str  # the song line as written in that playlist (ListLine.raw)


class ByDesignError(ValueError):
    """The by-design list names a file or a song line that the playlists do not have."""


def read_by_design(path: Path, lines: Mapping[str, Sequence[ListLine]]) -> list[ByDesign] | None:
    """The by-design list, checked against the playlists' song lines; None when absent.

    After ``#`` comment lines, one entry per line:
    ``<file> | <reason> | <song line>``. An entry for a file that is not one
    of the playlists, or a song line that file does not have (compared with
    ``ListLine.raw``), or a second entry for the same song line of a file
    (whatever its reason) raises ``ByDesignError``, so a stale list cannot
    lower a gate and one loss is never excused twice.
    """
    if not path.exists():
        return None
    entries: list[ByDesign] = []
    seen: set[tuple[str, str]] = set()  # (file, song line)
    for no, row in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not row.strip() or row.lstrip().startswith("#"):
            continue
        where = f"{path}, line {no}"
        parts = [part.strip() for part in row.split(" | ", 2)]
        if len(parts) != 3 or not all(parts):
            raise ByDesignError(f"{where}: expected '<file> | <reason> | <song line>'")
        entry = ByDesign(*parts)
        if entry.file not in lines:
            raise ByDesignError(f"{where}: {entry.file!r} is not one of the playlist files")
        if entry.line not in {line.raw for line in lines[entry.file]}:
            raise ByDesignError(f"{where}: its song line is not a song line of {entry.file}")
        if (entry.file, entry.line) in seen:
            raise ByDesignError(f"{where}: a second entry for the same song line of {entry.file}")
        seen.add((entry.file, entry.line))
        entries.append(entry)
    return entries


def file_entries(entries: Sequence[ByDesign] | None, path: Path) -> list[ByDesign]:
    return [entry for entry in entries or () if entry.file == path.name]


@dataclass(frozen=True)
class FileRun:
    path: Path
    pilot_songs: int
    pilot_count: int
    lines: tuple[ListLine, ...] = ()
    match: SetlistMatch | None = None
    error: str | None = None
    # This file's by-design entries, each with the product's result for its line.
    by_design: tuple[tuple[ByDesign, LineResult], ...] = ()

    @property
    def results(self) -> tuple[LineResult, ...]:
        return self.match.results if self.match else ()

    @property
    def pass_count(self) -> int:
        return len({song.id for r in self.results if counted(r) for song in r.songs})

    @property
    def tier1(self) -> int:
        return len(self.match.list_song_ids) if self.match else 0

    @property
    def tier2(self) -> int:
        return len(self.match.fill_song_ids) if self.match else 0

    @property
    def excused(self) -> int:
        """By-design entries the product does not match (any rule); a matched one already counts."""
        return sum(1 for _, result in self.by_design if not result.songs)

    @property
    def required(self) -> int:
        return self.pilot_count - self.excused

    @property
    def passed(self) -> bool:
        return self.pass_count >= self.required


def read_lines(path: Path) -> tuple[tuple[ListLine, ...], str | None]:
    """A playlist's song lines as the product reads them, or its SetlistError."""
    try:
        return tuple(parse_setlist_text(path.read_text(encoding="utf-8"))), None
    except SetlistError as err:
        return (), f"{err.code}: {err.message}"


def run_file(index: CatalogIndex, path: Path, pilot_songs: int, pilot_count: int) -> FileRun:
    lines, error = read_lines(path)
    if error:
        return FileRun(path, pilot_songs, pilot_count, error=error)
    return FileRun(path, pilot_songs, pilot_count, lines, match_setlist(index, lines))


def with_by_design(run: FileRun, entries: Sequence[ByDesign] | None) -> FileRun:
    result_of = {line.raw: result for line, result in zip(run.lines, run.results, strict=True)}
    found = tuple((entry, result_of[entry.line]) for entry in file_entries(entries, run.path))
    return replace(run, by_design=found)


@dataclass(frozen=True)
class Trap:
    pilot: PilotLine
    lines: tuple[ListLine, ...]
    results: tuple[LineResult, ...]
    error: str | None = None

    @property
    def matched(self) -> bool:
        return any(r.songs for r in self.results)


def run_trap(index: CatalogIndex, pilot: PilotLine) -> Trap:
    try:
        lines = parse_setlist_text(pilot.list_text)
    except SetlistError as err:
        return Trap(pilot, (), (), f"{err.code}: {err.message}")
    error = None if len(lines) == 1 else f"read as {len(lines)} lines"
    return Trap(pilot, tuple(lines), tuple(match_line(index, line) for line in lines), error)


# ----- output -----------------------------------------------------------------------------

COLUMNS = (
    "file",
    "lines read",
    "pilot songs",
    "pass count",
    "pilot count",
    "by design",
    "required",
    "tier 1",
    "tier 2",
    "pool",
    "result",
)


def table(rows: Sequence[Sequence[object]]) -> list[str]:
    cells = [[str(c) for c in row] for row in [COLUMNS, *rows]]
    widths = [max(len(row[i]) for row in cells) for i in range(len(COLUMNS))]

    def fmt(row: list[str]) -> str:
        first = row[0].ljust(widths[0])
        rest = (cell.rjust(width) for cell, width in zip(row[1:], widths[1:], strict=True))
        return "  ".join([first, *rest])

    return [fmt(cells[0]), "  ".join("-" * w for w in widths), *(fmt(row) for row in cells[1:])]


def run_row(run: FileRun) -> tuple[object, ...]:
    return (
        run.path.name,
        len(run.lines),
        run.pilot_songs,
        run.pass_count,
        run.pilot_count,
        run.excused,
        run.required,
        run.tier1,
        run.tier2,
        run.tier1 + run.tier2,
        "PASS" if run.passed else "FAIL",
    )


def total_row(rows: Sequence[Sequence[object]]) -> tuple[object, ...]:
    sums = [sum(int(str(row[i])) for row in rows) for i in range(1, len(COLUMNS) - 1)]
    return ("total", *sums, "")


def verdict_lines(failed_files: Sequence[str], trap_failure: str | None) -> list[str]:
    reasons = []
    if failed_files:
        reasons.append("below the required count: " + ", ".join(failed_files))
    if trap_failure:
        reasons.append(trap_failure)
    return ["verdict: FAIL", *(f"  {r}" for r in reasons)] if reasons else ["verdict: PASS"]


# ----- report sections ----------------------------------------------------------------------


@dataclass(frozen=True)
class Pair:
    """Which pilot line a song line is."""

    pilot: int | None  # index in the pilot's lines; None when no pilot line fits
    how: str  # "text" or "key"
    first: int | None  # the earlier song line that took the same pilot line, if any


def pair_lines(run: FileRun, pilot_lines: Sequence[PilotLine]) -> list[Pair]:
    """Pair each song line with the pilot's line, first by text, then by the dedupe key.

    By text: norm() of the product's raw line equals norm() of the pilot's
    "artist - title" text, so case, spacing, punctuation and the kind of dash
    do not matter. Failing that, by the pilot's dedupe key (built with the
    product's text functions). A line that pairs with a pilot line an earlier
    line took is a repeat the pilot skipped.
    """
    by_text: dict[str, int] = {}
    by_key: dict[Key, int] = {}
    for i, p in enumerate(pilot_lines):
        by_text.setdefault(norm(p.text), i)
        by_key.setdefault(dedupe_key(p.artist, p.title), i)
    taken: dict[int, int] = {}
    pairs = []
    for no, line in enumerate(run.lines, 1):
        i, how = by_text.get(norm(line.raw)), "text"
        if i is None:
            i, how = by_key.get(dedupe_key(*sides(line))), "key"
        first = None if i is None else taken.setdefault(i, no)
        pairs.append(Pair(i, how, None if first == no else first))
    return pairs


def extra_lines(
    run: FileRun, pilot_lines: Sequence[PilotLine], pairs: Sequence[Pair], out: list[str]
) -> None:
    """Why a list reads more (or fewer) song lines than the pilot's unique songs."""
    gap = len(run.lines) - run.pilot_songs
    out.append(
        f"[1] Extra lines: {len(run.lines)} read, {run.pilot_songs} pilot songs (gap {gap:+d})"
    )
    causes: Counter[str] = Counter()
    for no, (line, pair) in enumerate(zip(run.lines, pairs, strict=True), 1):
        if pair.pilot is None:
            causes["unpaired"] += 1
            out.append(f"    unpaired  song line {no} fits no pilot line: {line.raw}")
        elif pair.first is not None:
            first = run.lines[pair.first - 1]
            cause = "repeat" if line.raw == first.raw else "variant"
            causes[cause] += 1
            out.append(f"    {cause:<9} song line {no} = song line {pair.first}: {line.raw}")
    used = {pair.pilot for pair in pairs}
    for i, p in enumerate(pilot_lines):
        if i not in used:
            causes["unread"] += 1
            out.append(f"    unread    a pilot line no song line is: {p.text}")
    if len(pilot_lines) != run.pilot_songs:
        out.append(
            f"    the pilot's results file has {len(pilot_lines)} lines, not {run.pilot_songs}"
        )
    explained = causes["repeat"] + causes["variant"] + causes["unpaired"] - causes["unread"]
    out.append(
        f"    {causes['repeat']} repeat + {causes['variant']} variant (same pilot line, other text)"
        f" + {causes['unpaired']} unpaired - {causes['unread']} unread = {explained:+d}"
        f" (gap {gap:+d})"
    )
    # Not part of the gap: lines the product's text functions make one song
    # while the pilot kept them apart (PR 2 knows more recording-note words).
    first_key: dict[Key, int] = {}
    for no, (line, pair) in enumerate(zip(run.lines, pairs, strict=True), 1):
        earlier = first_key.setdefault(dedupe_key(*sides(line)), no)
        if earlier != no and pair.first is None and pair.pilot is not None:
            out.append(
                f"    merged    song line {no} is song line {earlier} under the product's key;"
                f" the pilot kept both (not in the gap): {line.raw}"
            )


@dataclass
class PilotDiff:
    lost: Counter[str]  # by the product's outcome
    lost_pilot: Counter[str]  # by the pilot's verdict
    gained: Counter[str]  # by the product's rule
    gained_pilot: Counter[str]  # by the pilot's verdict
    other_song: int = 0  # both found, not the same catalog song
    unpaired: int = 0  # product song lines with no pilot line
    never_paired: int = 0  # pilot lines no product line paired with

    @classmethod
    def empty(cls) -> PilotDiff:
        return cls(Counter(), Counter(), Counter(), Counter())

    def add(self, other: PilotDiff) -> None:
        self.lost.update(other.lost)
        self.lost_pilot.update(other.lost_pilot)
        self.gained.update(other.gained)
        self.gained_pilot.update(other.gained_pilot)
        self.other_song += other.other_song
        self.unpaired += other.unpaired
        self.never_paired += other.never_paired


def against_pilot(
    run: FileRun, pilot_lines: Sequence[PilotLine], pairs: Sequence[Pair], out: list[str]
) -> PilotDiff:
    """Lost, gained and changed lines against the pilot; repeats are left out."""
    via: Counter[str] = Counter()
    repeats = 0
    lost: list[list[str]] = []
    gained: list[list[str]] = []
    other: list[list[str]] = []
    unpaired: list[list[str]] = []
    diff = PilotDiff.empty()
    for no, (line, result, pair) in enumerate(zip(run.lines, run.results, pairs, strict=True), 1):
        if pair.pilot is None:
            unpaired.append([f"      song line {no}: {line.raw}   [{outcome(result)}]"])
            continue
        if pair.first is not None:
            repeats += 1
            continue
        via[pair.how] += 1
        p = pilot_lines[pair.pilot]
        entry = [
            f"      song line {no}: {line.raw}",
            f"        pilot    {p.verdict:<10} {'==> ' + p.catalog if p.catalog else ''}".rstrip(),
            f"        product  {outcome(result)}",
        ]
        if p.found and not counted(result):
            lost.append(entry)
            diff.lost["artist_or_film" if result.songs else str(result.reason)] += 1
            diff.lost_pilot[p.verdict] += 1
        elif counted(result) and not p.found:
            gained.append(entry)
            diff.gained[str(result.rule)] += 1
            diff.gained_pilot[p.verdict] += 1
        elif p.found and norm(p.catalog) not in {norm(song_text(s)) for s in result.songs}:
            other.append(entry)
    used = {pair.pilot for pair in pairs}
    never = [
        [f"      {p.verdict:<10} | {p.text}"] for i, p in enumerate(pilot_lines) if i not in used
    ]
    diff.other_song, diff.unpaired, diff.never_paired = len(other), len(unpaired), len(never)

    out.append(
        f"[2] Against the pilot ({len(pilot_lines)} pilot lines): paired {via['text']} by text and"
        f" {via['key']} by the dedupe key, {repeats} repeats skipped; {len(unpaired)} song lines"
        f" unpaired, {len(never)} pilot lines never paired"
    )
    for label, entries in (
        ("lost (the pilot found it, the product does not)", lost),
        ("gained (the product finds it, the pilot did not)", gained),
        ("other song (both found, not the same catalog song)", other),
        ("song lines with no pilot line", unpaired),
        ("pilot lines no song line paired with", never),
    ):
        out.append(f"    {label}: {len(entries)}")
        out.extend(text for entry in entries for text in entry)
    return diff


def feat_notes(runs: Sequence[FileRun], traps: Sequence[tuple[str, Trap]], out: list[str]) -> int:
    """Lines with no separator, a feat. note and the rule title_alone (ledger T4-m9)."""
    out.append("== [3] A feat. note on a line with no separator, matched by title alone ==")
    hits = 0
    others: list[str] = []

    def check(where: str, line: ListLine, result: LineResult) -> bool:
        nonlocal hits
        if line.right is not None or not FEAT_NOTE.search(line.left):
            return False
        if result.rule != "title_alone":
            others.append(f"      {where}: {line.raw}   [{outcome(result)}]")
            return False
        hits += 1
        out.append(f"    {where}: {line.raw}   [{outcome(result)}]")
        return True

    for run in runs:
        for no, (line, result) in enumerate(zip(run.lines, run.results, strict=True), 1):
            check(f"{run.path.name} song line {no}", line, result)
    hand_checked = 0
    for source, trap in traps:
        for line, result in zip(trap.lines, trap.results, strict=True):
            hand_checked += check(f"{source} trap line", line, result)
    out.append(
        f"    {hits} lines; {hand_checked} of them hand-checked (refused + should-match);"
        f" {len(others)} more no-separator feat. lines had another outcome:"
    )
    out.extend(others)
    return hits


def cut_credits(index: CatalogIndex, runs: Sequence[FileRun], out: list[str]) -> tuple[int, int]:
    """Fill keys whose songs carry two or more credits, one of them holding "&" or ","."""
    credits: dict[str, Counter[str]] = {}
    for song in index.songs:
        for key in {norm(k) for k in song.artist_keys} - {""}:
            credits.setdefault(key, Counter())[song.artist] += 1

    def candidate(key: str) -> bool:
        found = credits.get(key, Counter())
        return len(found) >= 2 and any("&" in c or "," in c for c in found)

    out.append('== [4] Fill keys cut from an "&" or comma credit (candidates, not judged) ==')
    lines_hit = 0
    keys_hit: Counter[str] = Counter()
    for run in runs:
        for no, line in enumerate(run.lines, 1):
            keys = [
                k for k in dict.fromkeys(_fill_keys(index, _match(index, line))) if candidate(k)
            ]
            if not keys:
                continue
            lines_hit += 1
            out.append(f"    {run.path.name} song line {no}: {line.raw}")
            for key in keys:
                keys_hit[key] += 1
                pulled = " | ".join(f"{c} ({n})" for c, n in credits[key].most_common())
                out.append(f"      key {key!r} pulls in: {pulled}")
    out.append(f"    {lines_hit} lines, {len(keys_hit)} distinct keys:")
    for key, n in keys_hit.most_common():
        pulled = " | ".join(f"{c} ({k})" for c, k in credits[key].most_common())
        out.append(f"      {key!r} ({n} lines): {pulled}")
    return lines_hit, len(keys_hit)


def trap_report(label: str, traps: Sequence[Trap], out: list[str]) -> None:
    matched = sum(t.matched for t in traps)
    out.append(f"== Traps: {label}: {len(traps)} unique lines, {matched} matched ==")
    for trap in traps:
        state = "MATCHED" if trap.matched else "not matched"
        out.append(f"    {state:<11} | {trap.pilot.list_text}   (pilot: {trap.pilot.catalog})")
        if trap.error:
            out.append(f"      {trap.error}")
        out.extend(f"      {outcome(r)}" for r in trap.results)


def by_design_summary(path: Path, entries: Sequence[ByDesign] | None, excused: int) -> str:
    if entries is None:
        return f"by design (Ruling X2): {path.name} is absent, so no exceptions"
    return (
        f"by design (Ruling X2): {len(entries)} entries in {path.name},"
        f" {excused} not matched by the product (excused)"
    )


def by_design_section(items: Sequence[tuple[ByDesign, str, bool]], out: list[str]) -> None:
    """A file's by-design entries: (entry, the product's result, excused)."""
    excused = sum(1 for *_, is_excused in items if is_excused)
    out.append(f"[0] By design (Ruling X2): {len(items)} entries, {excused} excused")
    for entry, result, is_excused in items:
        state = "excused" if is_excused else "matched (lowers nothing)"
        out.append(f"    {state:<24} | {entry.reason} | {entry.line}   [{result}]")


def lines_by_rule(run: FileRun) -> str:
    rules = Counter(str(r.rule) for r in run.results if r.songs)
    reasons = Counter(str(r.reason) for r in run.results if not r.songs)
    found = ", ".join(f"{k} {n}" for k, n in rules.most_common()) or "none"
    missed = ", ".join(f"{k} {n}" for k, n in reasons.most_common()) or "none"
    return f"lines per rule: {found}; not found: {missed}"


# ----- the two modes ---------------------------------------------------------------------------


def run_offline(args: argparse.Namespace, files: Sequence[Path], out: list[str]) -> int:
    aliases = common.load_aliases(args.aliases) if args.aliases else {}
    index = common.catalog_index(common.supabase_rows(args.catalog), aliases)
    runs = [
        run_file(index, path, songs, count)
        for path, songs, count in zip(files, PILOT_SONGS, PILOT_COUNTS, strict=True)
    ]
    dumps = args.pilot / "_dumps"
    by_design_path = dumps / BY_DESIGN_NAME
    entries = read_by_design(by_design_path, {run.path.name: run.lines for run in runs})
    runs = [with_by_design(run, entries) for run in runs]
    refused_lines = read_pilot_lines(dumps / "refused_traps.txt")
    should_lines = read_pilot_lines(dumps / "should_match.txt")
    refused = [run_trap(index, p) for p in unique_by_text(refused_lines)]
    should = [run_trap(index, p) for p in unique_by_text(should_lines)]

    # The per-file sections first: their totals go to stdout too.
    details: list[str] = []
    totals = PilotDiff.empty()
    for run in runs:
        details.append(f"=== {run.path.name} ===")
        if run.error:
            details.append(f"    refused: {run.error}")
        details.append(f"    {lines_by_rule(run)}")
        by_design_section([(e, outcome(r), not r.songs) for e, r in run.by_design], details)
        pilot_lines = read_pilot_lines(args.pilot / "results" / f"{run.path.stem}.detail.txt")
        pairs = pair_lines(run, pilot_lines)
        extra_lines(run, pilot_lines, pairs, details)
        totals.add(against_pilot(run, pilot_lines, pairs, details))
        details.append("    every song line:")
        for no, (line, result) in enumerate(zip(run.lines, run.results, strict=True), 1):
            details.append(f"      {no:>3} {line.raw}   [{outcome(result)}]")
        details.append("")

    rows = [run_row(run) for run in runs]
    refused_hits = sum(t.matched for t in refused)
    stdout = [
        *table([*rows, total_row(rows)]),
        "",
        by_design_summary(by_design_path, entries, sum(run.excused for run in runs)),
        f"refused traps: {len(refused)} unique ({len(refused_lines)} lines), {refused_hits} matched"
        + (" (must be 0)" if refused_hits else ""),
        f"should match (not gated): {len(should)} unique ({len(should_lines)} lines),"
        f" {sum(t.matched for t in should)} matched",
        f"against the pilot (not gated; read each file's [2] in the report):"
        f" lost {sum(totals.lost.values())}, gained {sum(totals.gained.values())},"
        f" other song {totals.other_song}",
    ]
    stdout += [f"{run.path.name}: {run.error}" for run in runs if run.error]
    failed = [run.path.name for run in runs if not run.passed]
    trap_failure = f"{refused_hits} refused traps matched" if refused_hits else None
    stdout += verdict_lines(failed, trap_failure)
    print("\n".join(stdout))

    out += [
        f"catalog: {args.catalog} ({len(index.songs)} playable songs)",
        f"aliases: {args.aliases or 'none (baseline)'} ({len(index.aliases)} in the index)",
        "pass count: distinct tier-1 songs of lines matched by any rule except artist_or_film",
        f"required: the pilot count minus the file's entries in {by_design_path}"
        " that the product does not match (Ruling X2)",
        "pairing with the pilot's results: norm() of the whole line text (the product's raw"
        " line, the pilot's 'artist - title'), then the pilot's dedupe key"
        " (norm(clean_title(title)), artist_keys(artist)) with the product's functions",
        "",
        *stdout,
        "",
        *details,
        "== Against the pilot, all files ==",
        f"    lost {sum(totals.lost.values())}: product {dict(totals.lost.most_common())},"
        f" pilot {dict(totals.lost_pilot.most_common())}",
        f"    gained {sum(totals.gained.values())}: product {dict(totals.gained.most_common())},"
        f" pilot {dict(totals.gained_pilot.most_common())}",
        f"    other song {totals.other_song}",
        f"    song lines unpaired {totals.unpaired}, pilot lines never paired {totals.never_paired}",
        "",
    ]
    traps = [("refused", t) for t in refused] + [("should-match", t) for t in should]
    feat_notes(runs, traps, out)
    out.append("")
    cut_credits(index, runs, out)
    out.append("")
    trap_report("refused (gated: none may match)", refused, out)
    trap_report("should match (not gated)", should, out)
    return 1 if failed or trap_failure else 0


def post_once(url: str, payload: dict[str, Any]) -> tuple[int, Any]:
    request = urllib.request.Request(  # noqa: S310 (main() allows only http and https)
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=API_TIMEOUT_SECONDS) as response:  # noqa: S310
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        try:
            return err.code, json.loads(body)
        except ValueError:
            return err.code, body


def post(url: str, payload: dict[str, Any]) -> tuple[int, Any]:
    """POST once; on HTTP 429 wait a minute and try once more."""
    status, body = post_once(url, payload)
    if status == 429:
        time.sleep(API_RETRY_SECONDS)
        status, body = post_once(url, payload)
    return status, body


def api_result(line: str, reason_of: Mapping[str, str], ready: set[str]) -> tuple[str, bool]:
    """What the API answered for a by-design line, and whether that excuses it."""
    key = line.strip()
    if key in reason_of:
        return f"not found ({reason_of[key]})", True
    return ("ready" if key in ready else "not in the answer"), False


def run_api(args: argparse.Namespace, files: Sequence[Path], out: list[str]) -> int:
    url = args.api.rstrip("/") + "/setlists/check"
    # The by-design list is checked against the lines as the product parses
    # them here (no catalog needed) before any request is sent.
    by_design_path = args.pilot / "_dumps" / BY_DESIGN_NAME
    entries = read_by_design(by_design_path, {path.name: read_lines(path)[0] for path in files})
    rows: list[tuple[object, ...]] = []
    failed: list[str] = []
    errors: list[str] = []
    excused_total = 0
    for i, (path, songs, count) in enumerate(zip(files, PILOT_SONGS, PILOT_COUNTS, strict=True)):
        if i:
            time.sleep(API_PAUSE_SECONDS)
        status, body = post(url, {"text": path.read_text(encoding="utf-8")})
        ok = status == 200 and isinstance(body, dict)
        if not ok:
            errors.append(f"{path.name}: HTTP {status}: {str(body)[:ERROR_CHARS]}")
        answer: dict[str, Any] = body if ok else {}
        tier1 = int(answer.get("list_songs", 0))
        tier2 = int(answer.get("same_artist_songs", 0))
        # An entry is excused when the answer lists its line in not_found.
        reason_of = {r["line"].strip(): r["reason"] for r in answer.get("not_found", [])}
        ready = {r["line"].strip() for r in answer.get("ready", [])}
        items = [
            (entry, *api_result(entry.line, reason_of, ready))
            for entry in file_entries(entries, path)
        ]
        excused = sum(1 for *_, is_excused in items if is_excused)
        excused_total += excused
        required = count - excused
        passed = tier1 >= required
        if not passed:
            failed.append(path.name)
        pool = answer.get("pool_size", 0)
        lines_total = answer.get("lines_total", 0)
        result = "PASS" if passed else "FAIL"
        rows.append(
            (
                path.name,
                lines_total,
                songs,
                tier1,
                count,
                excused,
                required,
                tier1,
                tier2,
                pool,
                result,
            )
        )
        out.append(f"=== {path.name} ===")
        by_design_section(items, out)
        for r in answer.get("ready", []):
            named = (
                f"{r['artist']} - {r['title']}" if r["title"] else f"{r['artist']} (artist or film)"
            )
            out.append(f"    ready      | {r['line']}   ==> {named}")
        for r in answer.get("not_found", []):
            out.append(f"    not found  | {r['line']}   ({r['reason']})")

    refused = unique_by_text(read_pilot_lines(args.pilot / "_dumps" / "refused_traps.txt"))
    texts = [p.list_text for p in refused]
    time.sleep(API_PAUSE_SECONDS)
    status, body = post(url, {"text": "\n".join(texts)})
    if status == 200 and isinstance(body, dict):
        ready = {r["line"].strip() for r in body.get("ready", [])}
        hits = [t for t in texts if t.strip() in ready]
        read = body.get("lines_total")
        problems = []
        if read != len(texts):
            # A trap the API did not read as its own song line was never checked.
            problems.append(
                f"the API read {read} song lines from the {len(texts)} refused traps sent"
                " (must be equal: the trap check is not valid)"
            )
        if hits:
            problems.append(f"{len(hits)} refused traps matched")
        trap_failure = "; ".join(problems) or None
        trap_line = f"refused traps: {len(texts)} sent, {read} read, {len(hits)} in ready" + (
            " (must be 0)" if hits else ""
        )
        out.append("=== refused traps ===")
        out.extend(f"    MATCHED | {t}" for t in hits)
    else:
        trap_failure = f"the refused-trap request failed: HTTP {status}"
        trap_line = f"refused traps: not checked ({trap_failure})"
        errors.append(f"refused traps: HTTP {status}: {str(body)[:ERROR_CHARS]}")

    stdout = [
        f"API mode: {url}",
        "The API does not name the rule: here the pass count is the whole tier 1"
        " (list_songs), lines that name a whole artist included.",
        *table([*rows, total_row(rows)]),
        "",
        by_design_summary(by_design_path, entries, excused_total),
        trap_line,
        *errors,
        *verdict_lines(failed, trap_failure),
    ]
    print("\n".join(stdout))
    out[:0] = [*stdout, ""]
    return 1 if failed or trap_failure else 0


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0] if __doc__ else None)
    parser.add_argument(
        "--pilot", type=Path, default=DEFAULT_PILOT, help="the pilot's batch folder"
    )
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG, help="a catalog dump")
    parser.add_argument("--aliases", type=Path, help="alias rows (JSON); absent = no aliases")
    parser.add_argument("--report", type=Path, help=f"the report file (default: {REPORT_NAME})")
    parser.add_argument("--api", metavar="BASE_URL", help="check the lists on this API instead")
    args = parser.parse_args(argv)
    if args.report is None:
        folder = args.aliases.parent if args.aliases else DEFAULT_CATALOG.parents[1]
        args.report = folder / REPORT_NAME
    if args.api and not args.api.startswith(("https://", "http://")):
        parser.error("--api needs an http:// or https:// address")
    return args


def missing_pilot_files(pilot: Path, files: Sequence[Path], api: bool) -> list[str]:
    """The required files of the pilot folder that are not there, as paths inside it.

    Both modes read the 14 playlists and ``_dumps/refused_traps.txt``; the
    offline mode also reads ``_dumps/should_match.txt`` and one
    ``results/<playlist name>.detail.txt`` per playlist.
    ``_dumps/by_design_losses.txt`` is optional (absent = no exceptions).
    """
    missing = []
    if len(files) != len(PILOT_COUNTS):
        missing.append(
            f"playlists/NN-*.txt ({len(PILOT_COUNTS)} files 01 to 14, found {len(files)})"
        )
    needed = ["_dumps/refused_traps.txt"]
    if not api:
        needed.append("_dumps/should_match.txt")
        if not (pilot / "results").is_dir():
            missing.append("results/ (the folder)")
        else:
            needed += [f"results/{path.stem}.detail.txt" for path in files]
    return [*missing, *(name for name in needed if not (pilot / name).is_file())]


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    files = sorted((args.pilot / "playlists").glob("[0-9][0-9]-*.txt"))
    missing = missing_pilot_files(args.pilot, files, bool(args.api))
    if missing:
        print(
            f"error: the pilot folder {args.pilot} lacks: {', '.join(missing)}"
            " (README.md, step 7, lists what it must hold)",
            file=sys.stderr,
        )
        return 2
    out: list[str] = []
    try:
        code = run_api(args, files, out) if args.api else run_offline(args, files, out)
    except ByDesignError as err:
        print(f"error: the by-design list: {err}", file=sys.stderr)
        return 2
    args.report.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    print(f"report: {args.report}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
