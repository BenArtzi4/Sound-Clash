"""end_game(): happy path + state-machine errors.

Spec: docs/rpc-functions.md §4.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, create_test_team

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
async def test_end_game_archives_history(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    await create_test_team(db, game_code, name="Archivers")
    song_id = await create_test_song(db, youtube_id="jjjjjjjjjjj")
    await db.execute(
        "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, 1, $2)",
        game_code,
        song_id,
    )

    await db.fetchval("SELECT end_game($1)", game_code)

    hist = await db.fetchrow("SELECT round_count, team_count FROM game_history WHERE game_code = $1", game_code)
    assert hist is not None
    assert hist["round_count"] == 1
    assert hist["team_count"] == 1


@pytest.mark.asyncio
async def test_end_game_skips_archive_for_zero_round_game(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    await db.fetchval("SELECT end_game($1)", game_code)
    # A game with no rounds is ended normally but not archived.
    assert await db.fetchval("SELECT count(*) FROM game_history WHERE game_code = $1", game_code) == 0


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
