"""The catalog snapshot the setlist matcher reads.

``get_catalog_index()`` loads the playable catalog into a ``CatalogIndex`` and
keeps it for ``CACHE_SECONDS``, so matching a host's list costs no database
round trip while the snapshot is fresh. It reads, as service role through the
supabase client:

- ``songs`` (``id,title,artist,unavailable_at``). Songs with ``unavailable_at``
  set (a dead video, migration 045) are left out, as the random pickers leave
  them out. ``CatalogSong.artist_keys`` comes from ``setlist_text.artist_keys``,
  main artist first, not from the ``songs.artist_keys`` column: migration 049
  builds that column with ``array_agg(DISTINCT)``, which sorts the keys and
  loses the main artist. A parity test keeps the two splitters identical.
- ``genres`` for the ids of the slugs ``soundtracks`` and ``israeli-soundtracks``,
  then ``song_genres`` for each of them: a song with such a row is a soundtrack.
- ``artist_aliases``, as ``alias -> artist_key`` exactly as stored (the index
  normalises both sides).

PostgREST returns at most 1,000 rows per request, so every table that can pass
that is read in pages of ``PAGE_SIZE`` with ``.order(...).range(start, end)``
until a short page. Each query orders by a column that is unique within what
it reads (``songs.id``, ``song_genres.song_id`` within one genre,
``artist_aliases.alias``), so pages never skip or repeat a row.

The blocking supabase-py calls run in a worker thread (``anyio.to_thread``).
Concurrent callers on a cold or stale cache wait for one load. A failed load
raises the mapped ``DomainError`` and caches nothing, so the next call tries
again. Plan: docs/planning/2026-11-24-custom-setlist-phase1-plan.md, Task 5;
the matcher's rules are section 7 of docs/planning/2026-11-24-custom-setlist-design.md.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from time import monotonic
from typing import Any

import anyio

from app.db.errors import mapped_postgrest_errors
from app.db.supabase_client import SupabaseClientLike, get_supabase_client
from app.services.setlist_matcher import CatalogIndex, CatalogSong
from app.services.setlist_text import artist_keys

CACHE_SECONDS = 600
PAGE_SIZE = 1000  # PostgREST's row cap per request
SOUNDTRACK_GENRE_SLUGS = ("soundtracks", "israeli-soundtracks")

SONG_COLUMNS = "id,title,artist,unavailable_at"
ALIAS_COLUMNS = "alias,artist_key"


@dataclass(frozen=True)
class _Snapshot:
    index: CatalogIndex
    loaded_at: float  # monotonic() when its load began


@dataclass
class _Cache:
    snapshot: _Snapshot | None = None
    generation: int = 0  # bumped by every reset, so a load begun before one is not kept
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_cache = _Cache()


# ----- the load (blocking, in a worker thread) -----------------------------------


def _all_rows(page: Callable[[int, int], Any]) -> list[dict[str, Any]]:
    """Every row of a query, one request per ``PAGE_SIZE`` rows.

    ``page(start, end)`` builds the query for rows ``start`` to ``end``
    (inclusive, as ``range()`` counts), ordered by a unique column. A page
    shorter than ``PAGE_SIZE`` is the last one.
    """
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        with mapped_postgrest_errors():
            resp = page(start, start + PAGE_SIZE - 1).execute()
        batch = [dict(row) for row in (resp.data or [])]
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows
        start += PAGE_SIZE


def _genre_song_ids(client: SupabaseClientLike, genre_id: str) -> set[str]:
    rows = _all_rows(
        lambda start, end: (
            client.table("song_genres")
            .select("song_id")
            .eq("genre_id", genre_id)
            .order("song_id")
            .range(start, end)
        )
    )
    return {str(row["song_id"]) for row in rows}


def _soundtrack_song_ids(client: SupabaseClientLike) -> set[str]:
    """The ids of the songs in either soundtrack genre."""
    with mapped_postgrest_errors():
        resp = (
            client.table("genres").select("id").in_("slug", list(SOUNDTRACK_GENRE_SLUGS)).execute()
        )
    ids: set[str] = set()
    for genre in resp.data or []:
        ids |= _genre_song_ids(client, str(genre["id"]))
    return ids


def _load_blocking(client: SupabaseClientLike) -> CatalogIndex:
    song_rows = _all_rows(
        lambda start, end: client.table("songs").select(SONG_COLUMNS).order("id").range(start, end)
    )
    soundtrack_ids = _soundtrack_song_ids(client)
    alias_rows = _all_rows(
        lambda start, end: (
            client.table("artist_aliases").select(ALIAS_COLUMNS).order("alias").range(start, end)
        )
    )

    songs: dict[str, CatalogSong] = {}
    for row in song_rows:
        if row.get("unavailable_at") is not None:
            continue
        song_id = str(row["id"])
        songs.setdefault(
            song_id,
            CatalogSong(
                id=song_id,
                title=row["title"],
                artist=row["artist"],
                artist_keys=artist_keys(row["artist"]),
                is_soundtrack=song_id in soundtrack_ids,
            ),
        )
    aliases = {row["alias"]: row["artist_key"] for row in alias_rows}
    return CatalogIndex(list(songs.values()), aliases)


# ----- the cache --------------------------------------------------------------------


def _fresh_snapshot() -> _Snapshot | None:
    snapshot = _cache.snapshot
    if snapshot is not None and monotonic() - snapshot.loaded_at < CACHE_SECONDS:
        return snapshot
    return None


async def get_catalog_index() -> CatalogIndex:
    """The playable catalog as a ``CatalogIndex``, loaded at most once per ``CACHE_SECONDS``."""
    snapshot = _fresh_snapshot()
    if snapshot is not None:
        return snapshot.index
    async with _cache.lock:
        # Another caller may have loaded it while this one waited for the lock.
        snapshot = _fresh_snapshot()
        if snapshot is not None:
            return snapshot.index
        generation = _cache.generation
        started = monotonic()
        index = await anyio.to_thread.run_sync(_load_blocking, get_supabase_client())
        if _cache.generation == generation:
            _cache.snapshot = _Snapshot(index=index, loaded_at=started)
        return index


def reset_catalog_index_cache() -> None:
    """Forget the snapshot, so the next call loads the catalog again.

    A load already running is not kept, and the lock is new: the next caller
    never waits on a load the reset made stale, and each test's event loop
    gets a lock of its own.
    """
    _cache.snapshot = None
    _cache.generation += 1
    _cache.lock = asyncio.Lock()
