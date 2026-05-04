"""start_round() — happy path + state-machine errors.

Spec: docs/rpc-functions.md §2.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_start_round_happy_path(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="waiting")
    song_id = await create_test_song(db)

    new_round_id = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)
    assert new_round_id is not None

    game = await db.fetchrow(
        "SELECT status, round_number, current_song_id, current_round_id, "
        "buzzed_team_id, locked_at FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert game is not None
    assert game["status"] == "playing"
    assert game["round_number"] == 1
    assert game["current_song_id"] == song_id
    assert game["current_round_id"] == new_round_id
    assert game["buzzed_team_id"] is None
    assert game["locked_at"] is None

    round_row = await db.fetchrow(
        "SELECT game_code, round_number, song_id FROM game_rounds WHERE id = $1",
        new_round_id,
    )
    assert round_row is not None
    assert round_row["game_code"] == game_code
    assert round_row["round_number"] == 1
    assert round_row["song_id"] == song_id


@pytest.mark.asyncio
async def test_start_round_advances_round_number(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="waiting")
    song1 = await create_test_song(db, youtube_id="aaaaaaaaaaa")
    song2 = await create_test_song(db, youtube_id="bbbbbbbbbbb")
    song3 = await create_test_song(db, youtube_id="ccccccccccc")

    await db.execute("SELECT start_round($1, $2)", game_code, song1)
    await db.execute("SELECT start_round($1, $2)", game_code, song2)
    await db.execute("SELECT start_round($1, $2)", game_code, song3)

    rn = await db.fetchval("SELECT round_number FROM active_games WHERE game_code = $1", game_code)
    assert rn == 3
    rounds = await db.fetch(
        "SELECT round_number FROM game_rounds WHERE game_code = $1 ORDER BY round_number",
        game_code,
    )
    assert [r["round_number"] for r in rounds] == [1, 2, 3]


@pytest.mark.asyncio
async def test_start_round_clears_prior_buzz(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    song_id = await create_test_song(db)

    # Simulate a buzz from a previous round.
    await db.execute(
        "UPDATE active_games SET buzzed_team_id = $1, locked_at = now() WHERE game_code = $2",
        team_id,
        game_code,
    )

    await db.execute("SELECT start_round($1, $2)", game_code, song_id)

    game = await db.fetchrow(
        "SELECT buzzed_team_id, locked_at FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert game is not None
    assert game["buzzed_team_id"] is None
    assert game["locked_at"] is None


@pytest.mark.asyncio
async def test_start_round_when_game_missing_raises(
    db: asyncpg.Connection,
) -> None:
    song_id = await create_test_song(db)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT start_round($1, $2)", "ZZZZZZ", song_id)
    assert exc.value.sqlstate == "P0002"


@pytest.mark.asyncio
async def test_start_round_when_game_ended_raises(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="ended")
    song_id = await create_test_song(db)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT start_round($1, $2)", game_code, song_id)
    assert exc.value.sqlstate == "P0001"
