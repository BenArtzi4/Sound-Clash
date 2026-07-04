"""Test data builders for db tests.

Keep test bodies focused on the assertion under test; routine fixture creation
goes here.
"""

from __future__ import annotations

import secrets
import uuid
from typing import Literal

import asyncpg

GameStatus = Literal["waiting", "playing", "ended"]

GAME_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_game_code() -> str:
    """6 chars from the unambiguous alphabet (matches FastAPI's generator)."""
    return "".join(secrets.choice(GAME_CODE_ALPHABET) for _ in range(6))


async def create_test_game(
    conn: asyncpg.Connection,
    *,
    status: GameStatus = "playing",
    expires_in_hours: int = 4,
    game_code: str | None = None,
) -> str:
    """Insert one row into active_games and return its game_code."""
    code = game_code or generate_game_code()
    await conn.execute(
        """
        INSERT INTO active_games (game_code, status, expires_at)
        VALUES ($1, $2, now() + ($3 || ' hours')::interval)
        """,
        code,
        status,
        str(expires_in_hours),
    )
    return code


async def fetch_manager_token(
    conn: asyncpg.Connection,
    game_code: str,
) -> uuid.UUID:
    """Return the per-game manager_token. Migration 034 moved it off
    active_games into the anon-invisible ``game_secrets`` table (auto-provisioned
    by an AFTER INSERT trigger on active_games). Tests for token-gated RPCs
    (``award_attempt``, ``release_buzz_lock``, ``select_next_song``,
    ``peek_next_song``) need this to pass as the p_manager_token argument.
    """
    token = await conn.fetchval(
        "SELECT manager_token FROM game_secrets WHERE game_code = $1", game_code
    )
    assert token is not None
    return token


async def create_test_team(
    conn: asyncpg.Connection,
    game_code: str,
    *,
    name: str | None = None,
) -> uuid.UUID:
    """Insert one row into game_teams and return its id."""
    team_name = name or f"Team-{secrets.token_hex(3)}"
    row = await conn.fetchrow(
        """
        INSERT INTO game_teams (game_code, name)
        VALUES ($1, $2)
        RETURNING id
        """,
        game_code,
        team_name,
    )
    assert row is not None
    return row["id"]


async def create_test_song(
    conn: asyncpg.Connection,
    *,
    title: str = "Test Title",
    artist: str = "Test Artist",
    youtube_id: str = "abcdefghijk",
    release_year: int | None = None,
) -> uuid.UUID:
    """Insert one row into songs and return its id.

    Soundtrack-ness is derived from genre membership (migration 028), so there
    is no is_soundtrack column to set here; attach the song to the 'soundtracks'
    or 'israeli-soundtracks' genre via song_genres to make it a soundtrack.

    release_year (migration 031) is NULL unless given; pass it to exercise the
    decade filter (migration 032).
    """
    row = await conn.fetchrow(
        """
        INSERT INTO songs (title, artist, youtube_id, release_year)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        """,
        title,
        artist,
        youtube_id,
        release_year,
    )
    assert row is not None
    return row["id"]


async def call_buzz_in(
    conn: asyncpg.Connection,
    game_code: str,
    team_id: uuid.UUID,
) -> asyncpg.Record | None:
    """Invoke buzz_in and return the single row (or None if zero rows).

    The function returns one row when the game exists, regardless of whether
    the lock was won; zero rows only when game_code matches no row.
    """
    rows = await conn.fetch(
        "SELECT locked, locked_team_id, locked_at FROM buzz_in($1, $2)",
        game_code,
        team_id,
    )
    return rows[0] if rows else None
