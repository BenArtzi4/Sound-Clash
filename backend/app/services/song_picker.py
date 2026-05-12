"""Pick a random unplayed song for a game, mixing the selected genres evenly.

Each call picks a random *eligible* genre (one that still has an unplayed song
in this game) and then a random unplayed song within it. Weighting genres
equally — rather than sampling uniformly over the union of all candidate songs —
keeps small genres from being drowned out by large ones, so a game with several
selected genres interleaves them throughout instead of front-loading the biggest
one. Songs already used in this game's ``game_rounds`` are excluded; when every
selected genre is exhausted, raises :class:`ConflictError`.
"""

from __future__ import annotations

import secrets
from typing import Any
from uuid import UUID

import anyio

from app.db.errors import ConflictError
from app.db.supabase_client import SupabaseClientLike

SONG_COLUMNS = "id,title,artist,youtube_id,start_time,is_soundtrack,source"


def _no_more_songs() -> ConflictError:
    return ConflictError(
        "no songs left in selected genres",
        details={"reason": "no_more_songs"},
    )


def _pick_blocking(
    client: SupabaseClientLike, game_code: str, genre_ids: list[str]
) -> dict[str, Any]:
    played = client.table("game_rounds").select("song_id").eq("game_code", game_code).execute()
    played_ids: set[str] = {row["song_id"] for row in (played.data or []) if row.get("song_id")}

    matching = (
        client.table("song_genres").select("song_id,genre_id").in_("genre_id", genre_ids).execute()
    )
    # Bucket unplayed candidate songs by genre. A song that belongs to several
    # selected genres lands in each bucket; once played it drops out of all of
    # them via played_ids.
    by_genre: dict[str, list[str]] = {}
    for row in matching.data or []:
        song_id = row.get("song_id")
        genre_id = row.get("genre_id")
        if song_id is None or genre_id is None or song_id in played_ids:
            continue
        by_genre.setdefault(genre_id, []).append(song_id)

    eligible_genres = [g for g, songs in by_genre.items() if songs]
    if not eligible_genres:
        raise _no_more_songs()

    chosen_genre = eligible_genres[secrets.randbelow(len(eligible_genres))]
    candidates = by_genre[chosen_genre]
    chosen_id = candidates[secrets.randbelow(len(candidates))]

    songs = client.table("songs").select(SONG_COLUMNS).eq("id", chosen_id).execute()
    rows: list[dict[str, Any]] = list(songs.data or [])
    if not rows:
        # The song_genres row referenced a song that's no longer in the catalog.
        # Treat it as a depleted pool rather than a 500.
        raise _no_more_songs()
    return rows[0]


async def pick_random_song(
    client: SupabaseClientLike,
    game_code: str,
    genre_ids: list[UUID] | list[str],
) -> dict[str, Any]:
    ids = [str(g) for g in genre_ids]
    return await anyio.to_thread.run_sync(_pick_blocking, client, game_code, ids)
