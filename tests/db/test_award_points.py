"""award_points() — happy path, idempotency, timeout case, accumulation.

Spec: docs/rpc-functions.md §3.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import call_buzz_in, create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker


async def _start_round_and_buzz(
    conn: asyncpg.Connection,
    game_code: str,
    team_id: uuid.UUID,
) -> uuid.UUID:
    """Helper: start a round and have one team buzz in. Returns the round id."""
    song_id = await create_test_song(conn, youtube_id=uuid.uuid4().hex[:11])
    round_id = await conn.fetchval("SELECT start_round($1, $2)", game_code, song_id)
    assert round_id is not None
    await call_buzz_in(conn, game_code, team_id)
    # The round row's buzzed_team_id is updated by the manager UI in production
    # via a separate update; mimic that here so award_points reads it.
    await conn.execute(
        "UPDATE game_rounds SET buzzed_team_id = $1 WHERE id = $2",
        team_id,
        round_id,
    )
    return round_id


@pytest.mark.asyncio
async def test_award_points_happy_path(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    rows = await db.fetch(
        "SELECT team_id, points_awarded, team_total_score "
        "FROM award_points($1, $2, $3, $4, $5, $6)",
        game_code,
        round_id,
        2,  # title
        1,  # artist
        0,  # source
        0,  # timeout
    )
    assert len(rows) == 1
    assert rows[0]["team_id"] == team_id
    assert rows[0]["points_awarded"] == 3
    assert rows[0]["team_total_score"] == 3

    round_row = await db.fetchrow(
        "SELECT title_points, artist_points, source_points, timeout_penalty, ended_at "
        "FROM game_rounds WHERE id = $1",
        round_id,
    )
    assert round_row is not None
    assert round_row["title_points"] == 2
    assert round_row["artist_points"] == 1
    assert round_row["source_points"] == 0
    assert round_row["timeout_penalty"] == 0
    assert round_row["ended_at"] is not None

    game = await db.fetchrow(
        "SELECT buzzed_team_id, locked_at FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert game is not None
    assert game["buzzed_team_id"] is None
    assert game["locked_at"] is None


@pytest.mark.asyncio
async def test_award_points_idempotency_raises_on_second_call(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    await db.execute("SELECT award_points($1, $2, 1, 0, 0, 0)", game_code, round_id)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT award_points($1, $2, 1, 0, 0, 0)", game_code, round_id)
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_points_timeout_penalty_no_buzz(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    # Give the team some baseline points so we can prove the timeout case
    # doesn't accidentally subtract from their score.
    await db.execute("UPDATE game_teams SET score = 5 WHERE id = $1", team_id)

    song_id = await create_test_song(db)
    round_id = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)

    # No buzz happened — round.buzzed_team_id stays NULL.
    rows = await db.fetch(
        "SELECT team_id, points_awarded, team_total_score FROM award_points($1, $2, 0, 0, 0, 2)",
        game_code,
        round_id,
    )
    assert len(rows) == 1
    assert rows[0]["team_id"] is None
    assert rows[0]["points_awarded"] == -2  # 0 + 0 + 0 - 2

    round_row = await db.fetchrow(
        "SELECT timeout_penalty, ended_at FROM game_rounds WHERE id = $1",
        round_id,
    )
    assert round_row is not None
    assert round_row["timeout_penalty"] == 2
    assert round_row["ended_at"] is not None

    # Score unchanged for the team — no buzz means no penalty applied.
    score = await db.fetchval("SELECT score FROM game_teams WHERE id = $1", team_id)
    assert score == 5


@pytest.mark.asyncio
async def test_award_points_accumulates_across_rounds(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)

    for points in (1, 2, 3):
        round_id = await _start_round_and_buzz(db, game_code, team_id)
        await db.execute("SELECT award_points($1, $2, $3, 0, 0, 0)", game_code, round_id, points)

    score = await db.fetchval("SELECT score FROM game_teams WHERE id = $1", team_id)
    assert score == 6


@pytest.mark.asyncio
async def test_award_points_round_not_found_raises(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute(
            "SELECT award_points($1, $2, 1, 0, 0, 0)",
            game_code,
            uuid.uuid4(),
        )
    assert exc.value.sqlstate == "P0002"
