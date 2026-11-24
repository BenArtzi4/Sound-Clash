"""Match a host's pasted song list against the song catalog.

Pure functions over an in-memory catalog: no database, no network. The
catalog loader builds the ``CatalogIndex`` once; ``match_setlist`` then sorts
the list's lines into the songs the host named (tier 1) and more songs by
the same main artists (tier 2). The rules come from the 2026-11-24 setlist
pilot; the spec is section 7 of docs/planning/2026-11-24-custom-setlist-design.md.

Every name is compared after ``norm()`` on both sides: catalog artist keys
keep accents and symbols, alias rows are lower case and trimmed only, and a
pasted list can be in any case. The index keeps dictionaries by cleaned
title and by artist key, so a line costs a few lookups plus a similarity
check against the handful of songs those lookups return, never a pass over
the whole catalog.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from difflib import SequenceMatcher
from types import MappingProxyType
from typing import Literal

from app.services.setlist_text import ListLine, artist_keys, clean_title, is_hebrew, norm, skeleton

Rule = Literal[
    "same_song",
    "alias",
    "other_script_title",
    "soundtrack",
    "near_spelling",
    "artist_or_film",
    "title_alone",
]
Reason = Literal["not_in_catalog", "several_songs_share_this_name"]

# Thresholds proven by the pilot (pilot_match.py).
OTHER_SCRIPT_TITLE_RATIO = 0.80  # rule 3, on consonant skeletons
MIN_CONSONANTS = 3  # rule 3: shorter skeletons say too little
NEAR_ARTIST_RATIO = 0.85  # rule 5, artist spelling
NEAR_TITLE_RATIO = 0.88  # rule 5, title spelling
MIN_NEAR_LENGTH = 4  # rule 5: shorter names are compared only for equality
MAX_NEAR_TITLE_GAP = 6  # rule 5: titles whose lengths differ more are not alike
SOUNDTRACK_MIN_WORDS = 2  # rule 4: a one-word title needs the film's name in the line


@dataclass(frozen=True)
class CatalogSong:
    """One playable catalog song, as the matcher needs it."""

    id: str
    title: str
    artist: str
    artist_keys: tuple[str, ...]  # setlist_text.artist_keys(artist): main artist first
    is_soundtrack: bool


@dataclass(frozen=True)
class LineResult:
    """What one line of the list matched."""

    line: ListLine
    songs: tuple[CatalogSong, ...]  # empty when not found
    rule: Rule | None
    reason: Reason | None


@dataclass(frozen=True)
class SetlistMatch:
    """Every line's result and the two tiers of the game's songs."""

    results: tuple[LineResult, ...]
    list_song_ids: tuple[str, ...]  # tier 1, no duplicates, in list order
    fill_song_ids: tuple[str, ...]  # tier 2: same main artists, minus tier 1


@dataclass(frozen=True)
class _Entry:
    """A catalog song with its names already in norm() form."""

    song: CatalogSong
    keys: frozenset[str]  # every credited artist, empty names dropped
    main: str | None  # the first credited artist; None when it norms to nothing
    title: str  # norm(clean_title(title))
    title_is_hebrew: bool
    title_skeleton: str


def _entry(song: CatalogSong) -> _Entry:
    keys = [norm(key) for key in song.artist_keys]
    title = clean_title(song.title)
    return _Entry(
        song=song,
        keys=frozenset(key for key in keys if key),
        main=(keys[0] or None) if keys else None,
        title=norm(title),
        title_is_hebrew=is_hebrew(title),
        title_skeleton=skeleton(title),
    )


class CatalogIndex:
    """The catalog, indexed by cleaned title and by artist key.

    ``aliases`` maps a lowercased spelling to a key that appears in some
    song's ``artist_keys`` (the ``artist_aliases`` table). Both sides are
    stored in norm() form; entries that norm to nothing are skipped.
    """

    def __init__(self, songs: Sequence[CatalogSong], aliases: Mapping[str, str]) -> None:
        self._songs = tuple(songs)
        self._by_title: dict[str, list[_Entry]] = {}
        self._by_key: dict[str, list[_Entry]] = {}
        for song in self._songs:
            entry = _entry(song)
            if entry.title:
                self._by_title.setdefault(entry.title, []).append(entry)
            for key in entry.keys:
                self._by_key.setdefault(key, []).append(entry)
        normed: dict[str, str] = {}
        for alias, target in aliases.items():
            alias_key, target_key = norm(alias), norm(target)
            if alias_key and target_key:
                normed.setdefault(alias_key, target_key)
        self._aliases: Mapping[str, str] = MappingProxyType(normed)

    @property
    def songs(self) -> tuple[CatalogSong, ...]:
        return self._songs

    @property
    def aliases(self) -> Mapping[str, str]:
        """The alias table in norm() form: spelling -> catalog artist key."""
        return self._aliases

    def artist_key(self, name: str) -> str | None:
        """The catalog artist key (norm form) ``name`` is, directly or by alias.

        A name with recording notes (``Frozen (Original Motion Picture
        Soundtrack)``) is tried as written first, then without its notes.
        """
        for text in _with_and_without_notes(name):
            key = self._resolve(norm(text))
            if key is not None:
                return key
        return None

    def _resolve(self, key: str) -> str | None:
        if key in self._by_key:
            return key
        target = self._aliases.get(key)
        return target if target is not None and target in self._by_key else None

    def _titled(self, title: str) -> Sequence[_Entry]:
        return self._by_title.get(title, ())

    def _credited(self, key: str) -> Sequence[_Entry]:
        return self._by_key.get(key, ())


def _unique(items: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _with_and_without_notes(text: str) -> Iterator[str]:
    """``text`` as written, then (when it differs) with its recording notes removed.

    Spec section 7 cleans both sides of a line the same way, so an artist or
    film side may carry notes too: ``Queen (Live)``.
    """
    yield text
    cleaned = clean_title(text)
    if cleaned != text:
        yield cleaned


def _occurrences(key: str, words: tuple[str, ...]) -> int:
    """How many times ``key`` (norm form) stands in ``words`` as whole words."""
    parts = tuple(key.split())
    size = len(parts)
    return sum(1 for i in range(len(words) - size + 1) if words[i : i + size] == parts)


def _in_notes(key: str, side_words: tuple[str, ...], title_words: tuple[str, ...]) -> bool:
    """True when ``key`` is in the recording notes of a side.

    The notes are what ``clean_title`` dropped, so the key is in them when it
    stands in the side more often than in the side's cleaned title. A film
    key found only in the title itself does not count: ``Dallas`` names no
    film, ``Dallas (From "Dallas")`` does.
    """
    return _occurrences(key, side_words) > _occurrences(key, title_words)


# A year; alone it can be a title ("1999"), so it does not make a side notes.
_YEAR = re.compile(r"(?:19|20)\d\d")


def _is_note(word: str) -> bool:
    """True when ``clean_title`` drops ``word`` as a recording note ("live", "2011")."""
    return not clean_title(f"({word})")


def _ratio(a: str, b: str, floor: float) -> float:
    """``SequenceMatcher`` ratio of ``a`` and ``b``, or 0.0 when it cannot reach ``floor``.

    The two quick ratios are upper bounds of the real one, so skipping on them
    changes no result; it only spares the slow full comparison. The first is
    worked out from the lengths alone (as difflib does), before any matcher
    is built.
    """
    total = len(a) + len(b)
    if total and 2.0 * min(len(a), len(b)) / total < floor:
        return 0.0
    matcher = SequenceMatcher(None, a, b)
    if matcher.quick_ratio() < floor:
        return 0.0
    return matcher.ratio()


@dataclass(frozen=True)
class _Reading:
    """One way to read a line with a separator: this side the artist, that the title."""

    artist: str  # the side read as the artist, as written
    # Its credited artists, norm form, main first; then those it credits
    # once its recording notes are removed ("Queen (Live)" -> "queen").
    keys: tuple[str, ...]
    resolved: tuple[str, ...]  # those that are catalog keys, directly or by alias
    artist_words: tuple[str, ...]  # norm(artist side).split(), to find a film named there
    side_words: tuple[str, ...]  # norm(title side as written).split(), notes included
    title: str  # the title side, norm(clean_title(...))
    title_tokens: tuple[str, ...]  # title.split()
    title_word_count: int  # words of the cleaned title, split on spaces only ("Don't" is one)
    title_is_hebrew: bool
    title_skeleton: str


def _reading(index: CatalogIndex, artist: str, title: str) -> _Reading:
    names = [norm(key) for text in _with_and_without_notes(artist) for key in artist_keys(text)]
    keys = tuple(key for key in _unique(names) if key)
    resolved = _unique(r for r in (index._resolve(key) for key in keys) if r is not None)
    cleaned = clean_title(title)
    normed = norm(cleaned)
    return _Reading(
        artist=artist,
        keys=keys,
        resolved=tuple(resolved),
        artist_words=tuple(norm(artist).split()),
        side_words=tuple(norm(title).split()),
        title=normed,
        title_tokens=tuple(normed.split()),
        title_word_count=sum(1 for word in cleaned.split() if any(ch.isalnum() for ch in word)),
        title_is_hebrew=is_hebrew(cleaned),
        title_skeleton=skeleton(cleaned),
    )


def _main_key(index: CatalogIndex, text: str) -> str | None:
    """The catalog key of the main artist ``text`` credits, after alias mapping.

    ``text`` is tried as written first, then without its recording notes.
    """
    for candidate in _with_and_without_notes(text):
        keys = artist_keys(candidate)
        key = index._resolve(norm(keys[0])) if keys else None
        if key is not None:
            return key
    return None


def _artist_songs(index: CatalogIndex, reading: _Reading) -> list[_Entry]:
    """The songs of the artist the reading names (rule 1 or 2 on the artist alone)."""
    seen: dict[str, _Entry] = {}
    for key in reading.resolved:
        for entry in index._credited(key):
            seen.setdefault(entry.song.id, entry)
    return list(seen.values())


def _best(scored: Iterable[tuple[float, _Entry]], floor: float) -> list[_Entry]:
    """The highest-scoring entry at or above ``floor`` (the first one on a tie)."""
    best: _Entry | None = None
    best_score = 0.0
    for score, entry in scored:
        if score >= floor and (best is None or score > best_score):
            best, best_score = entry, score
    return [] if best is None else [best]


# ----- the rules, in spec order -------------------------------------------------


def _same_song(index: CatalogIndex, r: _Reading) -> list[_Entry]:
    """Rule 1: cleaned titles equal and a credited artist equal."""
    return [e for e in index._titled(r.title) if e.keys.intersection(r.keys)]


def _alias(index: CatalogIndex, r: _Reading) -> list[_Entry]:
    """Rule 2: cleaned titles equal and a list artist maps through an alias."""
    targets = {index.aliases[key] for key in r.keys if key in index.aliases}
    return [e for e in index._titled(r.title) if e.keys.intersection(targets)] if targets else []


def _other_script_title(index: CatalogIndex, r: _Reading) -> list[_Entry]:
    """Rule 3: the artist is known, the title is written in the other script."""
    if len(r.title_skeleton) < MIN_CONSONANTS:
        return []
    return _best(
        (
            (_ratio(r.title_skeleton, e.title_skeleton, OTHER_SCRIPT_TITLE_RATIO), e)
            for e in _artist_songs(index, r)
            if e.title_is_hebrew != r.title_is_hebrew and len(e.title_skeleton) >= MIN_CONSONANTS
        ),
        OTHER_SCRIPT_TITLE_RATIO,
    )


def _film_named(key: str, r: _Reading) -> bool:
    """True when the line names the film ``key`` outside the song title itself:
    in the artist side, or in the title side's recording notes."""
    return _occurrences(key, r.artist_words) > 0 or _in_notes(key, r.side_words, r.title_tokens)


def _soundtrack(index: CatalogIndex, r: _Reading) -> list[_Entry]:
    """Rule 4: a soundtrack song of that title; the catalog credits the film."""
    films = [e for e in index._titled(r.title) if e.song.is_soundtrack]
    named = [e for e in films if any(_film_named(key, r) for key in e.keys)]
    if named:
        return named
    return films if r.title_word_count >= SOUNDTRACK_MIN_WORDS else []


def _artist_likeness(list_key: str, catalog_key: str) -> float:
    if list_key.replace(" ", "") == catalog_key.replace(" ", ""):
        return 1.0
    if min(len(list_key), len(catalog_key)) < MIN_NEAR_LENGTH:
        return 0.0
    return _ratio(list_key, catalog_key, NEAR_ARTIST_RATIO)


def _near_spelling(index: CatalogIndex, r: _Reading) -> list[_Entry]:
    """Rule 5: the artist nearly alike and the title equal, or the other way round."""
    found = _best(
        (
            (max((_artist_likeness(a, b) for a in r.keys for b in e.keys), default=0.0), e)
            for e in index._titled(r.title)
        ),
        NEAR_ARTIST_RATIO,
    )
    if found or len(r.title) < MIN_NEAR_LENGTH:
        return found
    return _best(
        (
            (_ratio(r.title, e.title, NEAR_TITLE_RATIO), e)
            for e in _artist_songs(index, r)
            if abs(len(e.title) - len(r.title)) <= MAX_NEAR_TITLE_GAP
        ),
        NEAR_TITLE_RATIO,
    )


_Finder = Callable[[CatalogIndex, _Reading], list[_Entry]]
_PAIR_RULES: tuple[tuple[Rule, _Finder], ...] = (
    ("same_song", _same_song),
    ("alias", _alias),
    ("other_script_title", _other_script_title),
    ("soundtrack", _soundtrack),
    ("near_spelling", _near_spelling),
)


@dataclass(frozen=True)
class _Found:
    result: LineResult
    entries: tuple[_Entry, ...]
    # The catalog key of the main artist of the text that matched as the
    # artist, for the fill; None when no artist text matched.
    artist_key: str | None


def _found(line: ListLine, entries: Sequence[_Entry], rule: Rule, artist_key: str | None) -> _Found:
    songs = tuple(e.song for e in entries)
    return _Found(LineResult(line, songs, rule, None), tuple(entries), artist_key)


def _not_found(line: ListLine, reason: Reason) -> _Found:
    return _Found(LineResult(line, (), None, reason), (), None)


def _only_notes(index: CatalogIndex, side: str) -> bool:
    """True when a side of a line holds recording notes only ("Remastered 2011").

    That is a side that cleans to nothing, or whose every word is a note
    word. A side of years only ("1999") can be a song title, and a side that
    is a catalog artist ("Live") names that artist, so neither counts.
    """
    if index.artist_key(side) is not None:
        return False
    if not norm(clean_title(side)):
        return True
    words = norm(side).split()
    return all(_is_note(word) for word in words) and not all(
        _YEAR.fullmatch(word) for word in words
    )


def _match_pair(index: CatalogIndex, line: ListLine, right: str) -> _Found:
    """Rules 1 to 5 for a line with a separator, rule by rule in both orders.

    When none matches and exactly one side is only recording notes
    (``Bohemian Rhapsody - Remastered 2011``), the other side is matched as a
    line with no separator.
    """
    readings = (_reading(index, line.left, right), _reading(index, right, line.left))
    for rule, find in _PAIR_RULES:
        for reading in readings:
            entries = find(index, reading)
            if entries:
                return _found(line, entries, rule, _main_key(index, reading.artist))
    for notes, other in ((line.left, right), (right, line.left)):
        if _only_notes(index, notes) and not _only_notes(index, other):
            alone = _match_name(index, ListLine(line.raw, other, None))
            return replace(alone, result=replace(alone.result, line=line))
    return _not_found(line, "not_in_catalog")


def _match_name(index: CatalogIndex, line: ListLine) -> _Found:
    """Rule 6 for a line with no separator: an artist or film, then a song name.

    When several songs share the name, a film named in the line's recording
    notes (``Beyond (From "Moana 2")``) picks its soundtrack song.
    """
    key = index.artist_key(line.left)
    if key is not None:
        return _found(line, index._credited(key), "artist_or_film", key)
    title = norm(clean_title(line.left))
    titled = index._titled(title)
    if len(titled) == 1:
        return _found(line, titled, "title_alone", None)
    if titled:
        side_words, title_words = tuple(norm(line.left).split()), tuple(title.split())
        named = [
            e
            for e in titled
            if e.song.is_soundtrack and any(_in_notes(k, side_words, title_words) for k in e.keys)
        ]
        if len(named) == 1:
            return _found(line, named, "soundtrack", None)
        return _not_found(line, "several_songs_share_this_name")
    return _not_found(line, "not_in_catalog")


def _match(index: CatalogIndex, line: ListLine) -> _Found:
    if line.right is None:
        return _match_name(index, line)
    return _match_pair(index, line, line.right)


def match_line(index: CatalogIndex, line: ListLine) -> LineResult:
    """Match one line: the first rule that matches in either order wins."""
    return _match(index, line).result


# ----- the two tiers ----------------------------------------------------------


def _fill_keys(index: CatalogIndex, found: _Found) -> list[str]:
    """The main artists whose other songs join tier 2 because of this line.

    A found line gives the main artist of the side read as the artist and the
    main artist of every matched song (a soundtrack match gives its film). A
    line that was not found gives the main artist of each side that is a
    catalog artist, so "Artist - Title" and "Title - Artist" both count.
    """
    if found.result.songs:
        keys = [found.artist_key] + [e.main for e in found.entries]
    else:
        line = found.result.line
        sides = [line.left] if line.right is None else [line.left, line.right]
        keys = [_main_key(index, side) for side in sides]
    return [key for key in keys if key is not None]


def match_setlist(index: CatalogIndex, lines: Sequence[ListLine]) -> SetlistMatch:
    """Match every line and build the two tiers.

    Tier 1 is every matched song, once, in list order. Tier 2 is every song
    that credits the main artist of any line, found or not, or the main artist
    of a matched song, in list order and without the tier 1 songs.
    """
    found = [_match(index, line) for line in lines]
    list_ids = dict.fromkeys(song.id for f in found for song in f.result.songs)
    fill_keys = _unique(key for f in found for key in _fill_keys(index, f))
    fill_ids = dict.fromkeys(
        e.song.id for key in fill_keys for e in index._credited(key) if e.song.id not in list_ids
    )
    return SetlistMatch(
        results=tuple(f.result for f in found),
        list_song_ids=tuple(list_ids),
        fill_song_ids=tuple(fill_ids),
    )
