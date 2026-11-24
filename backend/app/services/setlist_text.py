"""Text rules for a host's pasted song list.

Pure functions with no database or network: the setlist matcher builds on
them. The rules come from the 2026-11-24 setlist pilot, which matched 14 real
playlists against the catalog offline; the spec is section 7 of
docs/planning/2026-11-24-custom-setlist-design.md.

- ``norm`` and ``clean_title`` make a title or a name comparable.
- ``artist_keys`` splits an artist credit exactly as the database's
  ``song_artist_keys()`` does.
- ``skeleton`` compares a name written in Hebrew with the same name in Latin
  letters.
- ``parse_setlist_text`` turns the pasted text into lines, or refuses it with
  a ``SetlistError``.

Hebrew letters are written as they are, so the lint rules for confusable
letters are off in this file; every other special character is an escape.
"""

# ruff: noqa: RUF001, RUF003

from __future__ import annotations

import csv
import re
import unicodedata
from dataclasses import dataclass

from app.db.errors import SetlistError

MAX_LINES = 300
MAX_CHARS = 20_000

_TOO_LONG = f"Your list is too long: at most {MAX_LINES} songs and {MAX_CHARS:,} characters."
_LINKS_ONLY = "These are links, not song names."
_NO_SONGS = "No song names found."

# Invisible characters a paste carries: the byte-order mark, and the
# direction marks, embeddings, overrides and isolates that Hebrew text picks
# up in chat apps and spreadsheets (U+200E, U+200F, U+202A-U+202E,
# U+2066-U+2069).
_INVISIBLE = dict.fromkeys([0xFEFF, 0x200E, 0x200F, *range(0x202A, 0x202F), *range(0x2066, 0x206A)])

# ----- comparing names ------------------------------------------------------

# Punctuation that norm() turns into a space. Same set as
# tools/song-curation/requests/parse_requests.py, proven on the catalog:
# ASCII punctuation, the acute accent, Hebrew geresh and gershayim, curly
# quotes, en dash and em dash.
_PUNCT = frozenset(
    "'\"`\u00b4\u05f3\u05f4\u2019\u2018\u201c\u201d|,.!?/\\-\u2013\u2014_:;+*()[]{}&"
)


def norm(s: str) -> str:
    """Casefold, drop marks, niqqud, accents and punctuation, collapse spaces.

    Hebrew double yod and double vav become single, the spelling the catalog
    mostly uses.
    """
    s = unicodedata.normalize("NFKD", s.translate(_INVISIBLE))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = "".join(" " if ch in _PUNCT else ch for ch in s.casefold())
    s = s.replace("יי", "י").replace("וו", "ו")
    return " ".join(s.split())


# Words that mark a bracketed or " - " part of a title as a note about the
# recording, not part of the name.
JUNK_WORDS = (
    r"feat|ft|featuring|with|remaster|remastered|version|edit|mix|remix|live|official|video|audio|"
    r"lyric|lyrics|from|soundtrack|mono|stereo|deluxe|bonus|single|acoustic|explicit|clean|"
    r"original|album|radio|extended|anniversary|edition|prod|theme|motion picture|"
    r"קליפ|רשמי|הרשמי|מתוך|גרסת|גרסה|הופעה|לייב|עם|בהופעה|רמיקס"
)
_PAREN = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")
# A junk word as a whole word (not inside another word), or a year.
_JUNK_IN = re.compile(
    rf"(?<![^\W\d_])(?:{JUNK_WORDS})(?![^\W\d_])|\b(?:19|20)\d\d\b", re.IGNORECASE
)
# A hyphen, en dash or em dash with spaces around it: separates a list line,
# and the parts of a title.
_DASH = re.compile(r"\s+[-\u2013\u2014]\s+")


def clean_title(s: str) -> str:
    """Drop the bracketed and " - " parts of a title that only describe the recording.

    ``Let It Go - From "Frozen"/Soundtrack Version`` becomes ``Let It Go``;
    ``Everybody (Backstreet's Back)`` keeps its brackets.
    """
    s = _PAREN.sub(lambda m: "" if _JUNK_IN.search(m.group(0)) else m.group(0), s)
    parts = _DASH.split(s)
    kept = [parts[0]] + [p for p in parts[1:] if not _JUNK_IN.search(p)]
    return " ".join(" - ".join(kept).strip(" -\u2013\u2014").split())


# The separator of song_artist_keys() in db/migrations/049_song_spacing.sql:
# " & ", " featuring ", " feat. ", " ft. ", " vs. " | " x " (but not the X of
# "Lil Nas X & ...") | "," | the Hebrew " ו" prefix.
#
# The production database uses the ICU locale provider (PostgreSQL 17,
# locale en-US). There its regex \s is Python's \s, no-break spaces included,
# and its lower() is str.lower(). Its case-insensitive match is ASCII only, so
# the words are matched under (?a:...): with Unicode case folding Python would
# also take a long s (U+017F) for "s" and a dotless i (U+0131) for "i".
# tests/db/test_artist_keys_parity.py runs the SQL function under the same
# ICU collation, because the test database's default (libc) locale does not
# count no-break spaces as \s.
_ARTIST_SPLIT = re.compile(
    r"\s+(?a:&|featuring|feat\.?|ft\.?|vs\.?)\s+|\s+(?a:x)\s+(?!&)|\s*,\s*|\s+ו(?=\S)",
    re.IGNORECASE,
)


def artist_keys(s: str) -> tuple[str, ...]:
    """The artists credited in an artist string, lowercased, main artist first.

    Splits exactly as the database's ``song_artist_keys()`` (migration 049), so
    a key from a pasted list can equal a key in ``songs.artist_keys``;
    tests/db/test_artist_keys_parity.py holds the two in step. Like the
    database, each piece is trimmed of spaces only and empty pieces are
    dropped. Unlike it (it sorts), the credit order is kept and repeats are
    dropped.
    """
    keys: list[str] = []
    for piece in _ARTIST_SPLIT.split(s):
        key = piece.strip(" ").lower()
        if key and key not in keys:
            keys.append(key)
    return tuple(keys)


# ----- Hebrew and Latin letters ----------------------------------------------
# Spotify and Apple Music show Israeli artists (and many titles) in Latin
# letters; the catalog stores them in Hebrew. A skeleton drops the vowels and
# maps both scripts to the same coarse consonants, so "Zohar Argov" and
# "זוהר ארגוב" are both "zrgb".

HEB = {
    "א": "", "ה": "", "ו": "", "י": "", "ע": "", "ח": "",
    "ב": "b", "ג": "g", "ד": "d", "ז": "z", "ט": "t", "כ": "k", "ך": "k", "ל": "l",
    "מ": "m", "ם": "m", "נ": "n", "ן": "n", "ס": "s", "פ": "p", "ף": "p", "צ": "z",
    "ץ": "z", "ק": "k", "ר": "r", "ש": "s", "ת": "t",
}  # fmt: skip
LAT_PAIRS = (
    ("tz", "z"), ("ts", "z"), ("sh", "s"), ("ch", "k"), ("kh", "k"), ("ph", "p"), ("x", "ks"),
)  # fmt: skip
LAT = {
    "b": "b", "v": "b", "w": "b", "p": "p", "f": "p", "c": "k", "k": "k", "q": "k", "g": "g",
    "j": "g", "d": "d", "t": "t", "z": "z", "s": "s", "l": "l", "m": "m", "n": "n", "r": "r",
}  # fmt: skip
_HEBREW_LETTER = re.compile("[א-ת]")
_DOUBLED = re.compile(r"(.)\1+")


def is_hebrew(s: str) -> bool:
    """True when ``s`` holds a Hebrew letter."""
    return _HEBREW_LETTER.search(s) is not None


def skeleton(s: str) -> str:
    """Consonants only, doubled letters collapsed, the same in both scripts."""
    s = norm(s).replace("$", "s")
    if is_hebrew(s):
        out = "".join(HEB.get(ch, ch if ch.isdigit() else "") for ch in s)
    else:
        for pair, single in LAT_PAIRS:
            s = s.replace(pair, single)
        out = "".join(LAT.get(ch, ch if ch.isdigit() else "") for ch in s)
    return _DOUBLED.sub(r"\1", out)


# ----- reading the pasted list -------------------------------------------------


@dataclass(frozen=True)
class ListLine:
    """One song line of a host's list, split but not yet matched."""

    raw: str  # the line as the host wrote it, trimmed
    left: str  # text before the first separator, or the whole line
    right: str | None  # text after it; None when the line has no separator


# Leading numbering: at most 3 digits and ".", ")" or " - " ("50 Cent" and
# "1999 - Prince" stay whole, and "10.000" is a number, not "10."), or a
# bullet: U+2022, or a star, hyphen, en dash or em dash before a space (a name
# that starts with a star keeps it).
_NUMBERING = re.compile(
    r"^(?:\d{1,3}(?:\.(?!\d)|\)|\s+[-\u2013\u2014]\s)|\u2022|[*\-\u2013\u2014](?=\s))\s*"
)
# A trailing duration: "3:51", "(4:02)", "1:02:33". Not straight after a
# separator, so a song called "12:51" keeps its title.
_DURATION = re.compile(r"(?<![-\u2013\u2014\s])\s+[(\[]?\d{1,2}:\d{2}(?::\d{2})?[)\]]?$")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)

# A CSV or TSV export's header: a title column and an artist column.
_TITLE_COLUMNS = frozenset({"track name", "title", "song"})
# "Artist URI(s)" and "Artist ID" are not names.
_NOT_A_NAME = re.compile(r"\b(?:uri|url|id)s?\b")

_Columns = tuple[str, int, int]  # delimiter, artist column, title column


def _csv_columns(header: str) -> _Columns | None:
    """Where the artist and the title are, when the first line is a header."""
    delimiter = "\t" if "\t" in header else ","
    cells = [c.strip().lower() for c in next(csv.reader([header], delimiter=delimiter), [])]
    title = next((i for i, c in enumerate(cells) if c in _TITLE_COLUMNS), None)
    artist = next(
        (i for i, c in enumerate(cells) if c.startswith("artist") and not _NOT_A_NAME.search(c)),
        None,
    )
    if title is None or artist is None:
        return None
    return delimiter, artist, title


def _row_names(row: str, columns: _Columns | None) -> tuple[str, str] | None:
    """(artist, title) of a CSV or TSV row; None when the row has no such cells."""
    if columns is None:
        return None
    delimiter, artist_col, title_col = columns
    cells = next(csv.reader([row], delimiter=delimiter), [])
    if len(cells) <= max(artist_col, title_col):
        return None
    return cells[artist_col].strip(), cells[title_col].strip()


def _has_alnum(s: str) -> bool:
    return any(ch.isalnum() for ch in s)


def _cells_line(raw: str, artist: str, title: str) -> ListLine | None:
    names = [name for name in (artist, title) if _has_alnum(name)]
    if not names:
        return None
    return ListLine(raw, names[0], names[1] if len(names) == 2 else None)


def _text_line(raw: str, body: str) -> ListLine | None:
    body = _DURATION.sub("", body)
    if not _has_alnum(body):
        return None
    sep = _DASH.search(body)
    if sep is None:
        return ListLine(raw, body, None)
    return ListLine(raw, body[: sep.start()], body[sep.end() :])


def parse_setlist_text(text: str) -> list[ListLine]:
    """Split a pasted song list into its song lines.

    Drops the invisible marks, empty lines, ``#`` comments, numbering,
    bullets and durations, and lines that are only a link or have no letter
    or digit. A first line that is a CSV or TSV header turns every row into
    artist and title. Raises ``SetlistError``: ``setlist_too_long`` (over
    ``MAX_CHARS`` characters, checked first, or over ``MAX_LINES`` song
    lines), ``setlist_links_only`` (only links) or ``setlist_no_songs``.
    """
    if len(text) > MAX_CHARS:
        raise SetlistError("setlist_too_long", _TOO_LONG)
    rows = [
        row
        for row in text.translate(_INVISIBLE).splitlines()
        if row.strip() and not row.lstrip().startswith("#")
    ]
    columns = _csv_columns(rows[0]) if rows else None
    if columns is not None:
        rows = rows[1:]

    lines: list[ListLine] = []
    links = 0
    for row in rows:
        raw = row.strip()
        body = _NUMBERING.sub("", raw)
        if _URL.fullmatch(body):
            links += 1
            continue
        names = _row_names(row, columns)
        line = _cells_line(raw, *names) if names is not None else _text_line(raw, body)
        if line is None:
            continue
        lines.append(line)
        if len(lines) > MAX_LINES:
            raise SetlistError("setlist_too_long", _TOO_LONG)

    if lines:
        return lines
    if links:
        raise SetlistError("setlist_links_only", _LINKS_ONLY)
    raise SetlistError("setlist_no_songs", _NO_SONGS)
