"""Pick a random unplayed song for a game.

Joins ``songs`` with ``song_genres`` filtered to the game's selected genres
and excludes any song already used in this game's ``game_rounds``. Returns
a single song dict or raises :class:`ConflictError` when the pool is empty.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import anyio

from app.db.errors import ConflictError
from app.db.supabase_client import SupabaseClientLike

SONG_COLUMNS = "id,title,artist,youtube_id,start_time,is_soundtrack,source"


def _pick_blocking(
    client: SupabaseClientLike, game_code: str, genre_ids: list[str]
) -> dict[str, Any]:
    played = client.table("game_rounds").select("song_id").eq("game_code", game_code).execute()
    played_ids: list[str] = [row["song_id"] for row in (played.data or []) if row.get("song_id")]

    matching = client.table("song_genres").select("song_id").in_("genre_id", genre_ids).execute()
    candidate_ids = {row["song_id"] for row in (matching.data or [])}
    candidate_ids.difference_update(played_ids)

    if not candidate_ids:
        raise ConflictError(
            "no songs left in selected genres",
            details={"reason": "no_more_songs"},
        )

    songs = client.table("songs").select(SONG_COLUMNS).in_("id", list(candidate_ids)).execute()
    rows: list[dict[str, Any]] = list(songs.data or [])
    if not rows:
        raise ConflictError(
            "no songs left in selected genres",
            details={"reason": "no_more_songs"},
        )

    import secrets as _secrets

    return rows[_secrets.randbelow(len(rows))]


async def pick_random_song(
    client: SupabaseClientLike,
    game_code: str,
    genre_ids: list[UUID] | list[str],
) -> dict[str, Any]:
    ids = [str(g) for g in genre_ids]
    return await anyio.to_thread.run_sync(_pick_blocking, client, game_code, ids)
