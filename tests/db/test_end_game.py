"""end_game() — happy path + state-machine errors.

Spec: docs/rpc-functions.md §4.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_end_game_happy_path(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    ended_at = await db.fetchval("SELECT end_game($1)", game_code)
    assert ended_at is not None

    row = await db.fetchrow(
        "SELECT status, ended_at FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert row is not None
    assert row["status"] == "ended"
    assert row["ended_at"] is not None


@pytest.mark.asyncio
async def test_end_game_when_missing_raises(db: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT end_game($1)", "ZZZZZZ")
    assert exc.value.sqlstate == "P0002"


@pytest.mark.asyncio
async def test_end_game_when_already_ended_raises(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="ended")
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT end_game($1)", game_code)
    assert exc.value.sqlstate == "P0001"
