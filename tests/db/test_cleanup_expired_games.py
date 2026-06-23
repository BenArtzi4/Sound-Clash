"""cleanup_expired_games(): TTL sweep + cascade.

Spec: docs/rpc-functions.md §5.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_cleanup_deletes_expired_and_cascades(
    db: asyncpg.Connection,
) -> None:
    expired_code = await create_test_game(db, status="playing")
    fresh_code = await create_test_game(db, status="playing")

    team_id = await create_test_team(db, expired_code)
    song_id = await create_test_song(db)
    await db.execute(
        "INSERT INTO game_rounds (game_code, round_number, song_id, buzzed_team_id) "
        "VALUES ($1, 1, $2, $3)",
        expired_code,
        song_id,
        team_id,
    )

    # Force the expired game past its TTL.
    await db.execute(
        "UPDATE active_games SET expires_at = now() - interval '1 minute' WHERE game_code = $1",
        expired_code,
    )

    deleted = await db.fetchval("SELECT cleanup_expired_games()")
    assert deleted >= 1

    expired_row = await db.fetchrow("SELECT 1 FROM active_games WHERE game_code = $1", expired_code)
    assert expired_row is None

    fresh_row = await db.fetchrow("SELECT 1 FROM active_games WHERE game_code = $1", fresh_code)
    assert fresh_row is not None

    teams = await db.fetch("SELECT 1 FROM game_teams WHERE game_code = $1", expired_code)
    assert teams == []
    rounds = await db.fetch("SELECT 1 FROM game_rounds WHERE game_code = $1", expired_code)
    assert rounds == []


@pytest.mark.asyncio
async def test_cleanup_returns_zero_when_nothing_expired(
    db: asyncpg.Connection,
) -> None:
    await create_test_game(db, status="playing")
    deleted = await db.fetchval("SELECT cleanup_expired_games()")
    assert deleted == 0


@pytest.mark.asyncio
async def test_cleanup_archives_before_delete(db: asyncpg.Connection) -> None:
    """An abandoned game the host never ended is still archived before the sweep."""
    code = await create_test_game(db, status="playing")
    await create_test_team(db, code, name="Lapsed")
    song_id = await create_test_song(db, youtube_id="kkkkkkkkkkk")
    await db.execute(
        "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, 1, $2)",
        code,
        song_id,
    )
    await db.execute(
        "UPDATE active_games SET expires_at = now() - interval '1 minute' WHERE game_code = $1",
        code,
    )

    await db.fetchval("SELECT cleanup_expired_games()")

    # The ephemeral row is gone, but the durable snapshot remains.
    assert await db.fetchrow("SELECT 1 FROM active_games WHERE game_code = $1", code) is None
    hist = await db.fetchrow("SELECT round_count FROM game_history WHERE game_code = $1", code)
    assert hist is not None
    assert hist["round_count"] == 1


@pytest.mark.asyncio
async def test_cleanup_skips_archive_for_zero_round_game(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="playing")
    await db.execute(
        "UPDATE active_games SET expires_at = now() - interval '1 minute' WHERE game_code = $1",
        code,
    )

    await db.fetchval("SELECT cleanup_expired_games()")

    assert await db.fetchrow("SELECT 1 FROM active_games WHERE game_code = $1", code) is None
    assert await db.fetchval("SELECT count(*) FROM game_history WHERE game_code = $1", code) == 0
