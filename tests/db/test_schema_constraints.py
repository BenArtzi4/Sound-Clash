"""Schema-level integrity: unique, check, and FK-cascade behavior.

Spec: docs/data-model.md §2.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_duplicate_team_name_in_same_game_rejected(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db)
    await create_test_team(db, game_code, name="Alpha")
    with pytest.raises(asyncpg.UniqueViolationError):
        await create_test_team(db, game_code, name="Alpha")


@pytest.mark.asyncio
async def test_same_team_name_allowed_across_games(db: asyncpg.Connection) -> None:
    code_a = await create_test_game(db)
    code_b = await create_test_game(db)
    await create_test_team(db, code_a, name="Alpha")
    # Should not raise: the unique key is (game_code, name).
    await create_test_team(db, code_b, name="Alpha")


@pytest.mark.asyncio
async def test_duplicate_round_number_in_same_game_rejected(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db)
    song_id = await create_test_song(db)
    await db.execute(
        "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, 1, $2)",
        game_code,
        song_id,
    )
    with pytest.raises(asyncpg.UniqueViolationError):
        await db.execute(
            "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, 1, $2)",
            game_code,
            song_id,
        )


@pytest.mark.asyncio
async def test_invalid_status_rejected(db: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.CheckViolationError):
        await db.execute(
            "INSERT INTO active_games (game_code, status) "
            "VALUES ('XX1234', 'paused')"
        )


@pytest.mark.asyncio
async def test_deleting_game_cascades_to_teams_and_rounds(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db)
    song_id = await create_test_song(db)
    await create_test_team(db, game_code)
    await db.execute(
        "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, 1, $2)",
        game_code,
        song_id,
    )

    await db.execute("DELETE FROM active_games WHERE game_code = $1", game_code)

    teams = await db.fetch("SELECT 1 FROM game_teams WHERE game_code = $1", game_code)
    rounds = await db.fetch("SELECT 1 FROM game_rounds WHERE game_code = $1", game_code)
    assert teams == []
    assert rounds == []
