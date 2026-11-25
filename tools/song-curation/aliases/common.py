"""Shared helpers for the artist-alias tools.

The tools measure the product's own setlist code, never a copy of it: this
module puts the repository's ``backend/`` first on ``sys.path``, so
``from app.services... import ...`` reads the backend next to this file (in a
worktree, the worktree's backend, even when the interpreter's venv has
another checkout installed in editable mode). Standard library only; nothing
here touches a database or the network.

Data files (catalog dumps, alias rows, reports) hold real artist names and
live only in the git-ignored ``tools/song-curation/batches/`` folders.
"""

from __future__ import annotations

import json
import re
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "backend"
sys.path.insert(0, str(BACKEND))

import app  # noqa: E402
from app.services.setlist_catalog import SOUNDTRACK_GENRE_SLUGS  # noqa: E402
from app.services.setlist_matcher import CatalogIndex, CatalogSong  # noqa: E402
from app.services.setlist_text import artist_keys, norm  # noqa: E402

if Path(app.__file__).resolve().parent != BACKEND / "app":
    raise ImportError(f"app was imported from {app.__file__}, not from {BACKEND / 'app'}")


def read_json(path: str | Path) -> Any:
    """A JSON file (UTF-8; a byte-order mark from a Windows editor is allowed)."""
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path: str | Path, obj: Any, indent: int = 1) -> None:
    """Write ``obj`` as UTF-8 JSON with the letters as they are and LF line ends."""
    text = json.dumps(obj, ensure_ascii=False, indent=indent) + "\n"
    Path(path).write_text(text, encoding="utf-8", newline="\n")


def supabase_rows(path: str | Path) -> list[dict[str, Any]]:
    """The rows of a ``supabase db query --linked "<sql>" > file`` dump.

    The CLI can print chatter lines first; the JSON object
    (``{"boundary": ..., "rows": [...]}``) starts on the first line that
    starts with ``{``.
    """
    text = Path(path).read_text(encoding="utf-8-sig")
    start = re.search(r"^\{", text, re.MULTILINE)
    if start is None:
        raise ValueError(f"{path}: no JSON object in this dump")
    obj, _ = json.JSONDecoder().raw_decode(text[start.start() :])
    return list(obj["rows"])


def _genre_slugs(row: Mapping[str, Any]) -> list[str]:
    genres = row.get("genres") or ""
    return genres.split(";") if isinstance(genres, str) else list(genres)


def catalog_songs(rows: Iterable[Mapping[str, Any]]) -> list[CatalogSong]:
    """The playable songs of a catalog dump, as the backend builds them.

    Must stay in step with ``_load_blocking`` in
    ``backend/app/services/setlist_catalog.py``: rows in song id order (the
    backend reads ``songs`` ordered by ``id``; a uuid sorts as its lowercase
    text does), a song with ``unavailable_at`` set left out, one song per id
    (the first row wins), ``artist_keys`` split by ``setlist_text.artist_keys``
    (main artist first; not the dump's ``artist_keys`` column, which the
    database sorts), and ``is_soundtrack`` when one of the song's genre slugs
    is in ``SOUNDTRACK_GENRE_SLUGS``. A dump with no ``id`` column (the pilot's
    snapshot) uses ``youtube_id`` as the id.
    """

    def song_id(row: Mapping[str, Any]) -> str:
        return str(row.get("id") or row["youtube_id"])

    songs: dict[str, CatalogSong] = {}
    for row in sorted(rows, key=song_id):
        if row.get("unavailable_at") is not None:
            continue
        sid = song_id(row)
        songs.setdefault(
            sid,
            CatalogSong(
                id=sid,
                title=row["title"],
                artist=row["artist"],
                artist_keys=artist_keys(row["artist"]),
                is_soundtrack=any(slug in SOUNDTRACK_GENRE_SLUGS for slug in _genre_slugs(row)),
            ),
        )
    return list(songs.values())


def catalog_index(rows: Iterable[Mapping[str, Any]], aliases: Mapping[str, str]) -> CatalogIndex:
    """The product's ``CatalogIndex`` over a catalog dump and an alias table."""
    return CatalogIndex(catalog_songs(rows), aliases)


def load_aliases(path: str | Path) -> dict[str, str]:
    """``alias -> artist_key`` from a JSON list of rows holding both fields.

    A row with a ``"verdict"`` (the checking step's output) is used only when
    the verdict is ``"confirmed"``. Aliases are kept lowercased and trimmed,
    the form the upload writes and the table's unique key. One alias with two
    different artist keys raises ``ValueError`` naming it. Both are compared
    in ``norm()`` form, as ``CatalogIndex`` reads them: of two aliases that
    norm alike (``"zed-kay"``, ``"zed kay"``) the index keeps only the first,
    and the backend's first (rows sorted by alias) need not be this file's.
    """
    aliases: dict[str, str] = {}
    first: dict[str, tuple[str, str]] = {}  # norm(alias) -> (alias, artist_key) of its first row
    for row in read_json(path):
        if "verdict" in row and row["verdict"] != "confirmed":
            continue
        alias, key = row["alias"].strip().lower(), row["artist_key"].strip()
        seen_alias, seen_key = first.setdefault(norm(alias), (alias, key))
        if norm(seen_key) != norm(key):
            raise ValueError(
                f"alias {alias!r} has two artist keys: {seen_key!r} (row {seen_alias!r}) and {key!r}"
            )
        aliases.setdefault(alias, key)
    return aliases
