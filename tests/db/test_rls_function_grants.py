"""RLS — anon EXECUTE grants on the 6 RPC functions.

Spec: docs/security-rls.md §2.

Only buzz_in is callable by anon. The other five functions must reject.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_anon_can_execute_buzz_in(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)

    rows = await anon_conn.fetch(
        "SELECT locked, locked_team_id, locked_at FROM buzz_in($1, $2)",
        game_code,
        team_id,
    )
    assert len(rows) == 1
    assert rows[0]["locked"] is True


@pytest.mark.asyncio
async def test_anon_cannot_execute_start_round(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game_code = await create_test_game(db)
    song_id = await create_test_song(db)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute("SELECT start_round($1, $2)", game_code, song_id)


@pytest.mark.asyncio
async def test_anon_cannot_execute_award_points(
    anon_conn: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute(
            "SELECT award_points($1, $2, 0, 0, 0, 0)",
            "ABCDEF",
            uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_anon_cannot_execute_award_bonus(
    anon_conn: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute(
            "SELECT award_bonus($1, $2)",
            "ABCDEF",
            uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_anon_cannot_execute_end_game(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game_code = await create_test_game(db)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute("SELECT end_game($1)", game_code)


@pytest.mark.asyncio
async def test_anon_cannot_execute_cleanup_expired_games(
    anon_conn: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute("SELECT cleanup_expired_games()")
