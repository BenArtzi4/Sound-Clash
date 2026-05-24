"""Test data builders for backend tests.

Some helpers seed via direct asyncpg (using the ``db`` fixture); others
exercise the API through the FastAPI test client. Pick the layer that
matches the assertion under test.
"""

from __future__ import annotations

import secrets
from typing import Any
from uuid import UUID

import asyncpg

GAME_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def random_game_code() -> str:
    return "".join(secrets.choice(GAME_CODE_ALPHABET) for _ in range(6))


def random_youtube_id() -> str:
    alphabet = (
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    )
    return "".join(secrets.choice(alphabet) for _ in range(11))


async def fetch_genre_ids(
    db: asyncpg.Connection, slugs: list[str] | None = None
) -> list[UUID]:
    if slugs:
        rows = await db.fetch(
            "SELECT id FROM genres WHERE slug = ANY($1::text[]) ORDER BY slug",
            slugs,
        )
    else:
        rows = await db.fetch("SELECT id FROM genres ORDER BY slug LIMIT 3")
    return [row["id"] for row in rows]


async def insert_song(
    db: asyncpg.Connection,
    *,
    title: str = "Test Title",
    artist: str = "Test Artist",
    youtube_id: str | None = None,
    source: str | None = None,
    genre_slugs: list[str] | None = None,
) -> UUID:
    yid = youtube_id or random_youtube_id()
    row = await db.fetchrow(
        """
        INSERT INTO songs (title, artist, youtube_id, source)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        """,
        title,
        artist,
        yid,
        source,
    )
    assert row is not None
    song_id: UUID = row["id"]
    if genre_slugs:
        for slug in genre_slugs:
            await db.execute(
                """
                INSERT INTO song_genres (song_id, genre_id)
                SELECT $1, id FROM genres WHERE slug = $2
                """,
                song_id,
                slug,
            )
    return song_id


async def insert_game(
    db: asyncpg.Connection,
    *,
    status: str = "playing",
    selected_genres: list[UUID] | None = None,
    expires_in_hours: int = 4,
    game_code: str | None = None,
) -> tuple[str, UUID]:
    code = game_code or random_game_code()
    row = await db.fetchrow(
        """
        INSERT INTO active_games (game_code, status, selected_genres, expires_at)
        VALUES ($1, $2, $3::uuid[], now() + ($4 || ' hours')::interval)
        RETURNING manager_token
        """,
        code,
        status,
        selected_genres or [],
        str(expires_in_hours),
    )
    assert row is not None
    token: UUID = row["manager_token"]
    return code, token


def manager_headers(token: UUID | str) -> dict[str, str]:
    return {"X-Manager-Token": str(token)}


async def insert_team(
    db: asyncpg.Connection, game_code: str, *, name: str | None = None
) -> UUID:
    team_name = name or f"Team-{secrets.token_hex(3)}"
    row = await db.fetchrow(
        """
        INSERT INTO game_teams (game_code, name)
        VALUES ($1, $2)
        RETURNING id
        """,
        game_code,
        team_name,
    )
    assert row is not None
    team_id: UUID = row["id"]
    return team_id


async def create_game_via_api(
    client: Any,
    selected_genres: list[UUID],
) -> dict[str, Any]:
    resp = await client.post(
        "/games",
        json={
            "selected_genres": [str(g) for g in selected_genres],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()
