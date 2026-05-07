"""award_points() — happy path, idempotency, timeout case, accumulation.

Spec: docs/rpc-functions.md §3 and db/migrations/014_scoring_revamp.sql.
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
    # The round row's buzzed_team_id is updated by buzz_in itself (migration 011);
    # the older comment that the manager UI did this is stale.
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
        0,  # wrong_buzz
        0,  # timeout
    )
    assert len(rows) == 1
    assert rows[0]["team_id"] == team_id
    assert rows[0]["points_awarded"] == 3
    assert rows[0]["team_total_score"] == 3

    round_row = await db.fetchrow(
        "SELECT title_points, artist_points, wrong_buzz_penalty, ended_at "
        "FROM game_rounds WHERE id = $1",
        round_id,
    )
    assert round_row is not None
    assert round_row["title_points"] == 2
    assert round_row["artist_points"] == 1
    assert round_row["wrong_buzz_penalty"] == 0
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
async def test_award_points_wrong_buzz_deducts(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    # Seed baseline so we can see the deduction.
    await db.execute("UPDATE game_teams SET score = 10 WHERE id = $1", team_id)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    rows = await db.fetch(
        "SELECT team_id, points_awarded, team_total_score "
        "FROM award_points($1, $2, 0, 0, 3, 0)",
        game_code,
        round_id,
    )
    assert rows[0]["team_id"] == team_id
    assert rows[0]["points_awarded"] == -3
    assert rows[0]["team_total_score"] == 7

    round_row = await db.fetchrow(
        "SELECT wrong_buzz_penalty FROM game_rounds WHERE id = $1", round_id
    )
    assert round_row is not None
    assert round_row["wrong_buzz_penalty"] == 3


@pytest.mark.asyncio
async def test_award_points_wrong_buzz_with_correct_raises(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute(
            "SELECT award_points($1, $2, 10, 0, 3, 0)", game_code, round_id
        )
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_points_timeout_no_score_change(db: asyncpg.Connection) -> None:
    """timeout=1 ends the round but never moves any team's score."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    await db.execute("UPDATE game_teams SET score = 5 WHERE id = $1", team_id)

    song_id = await create_test_song(db)
    round_id = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)

    rows = await db.fetch(
        "SELECT team_id, points_awarded, team_total_score "
        "FROM award_points($1, $2, 0, 0, 0, 1)",
        game_code,
        round_id,
    )
    assert len(rows) == 1
    assert rows[0]["team_id"] is None
    assert rows[0]["points_awarded"] == 0

    round_row = await db.fetchrow(
        "SELECT wrong_buzz_penalty, ended_at FROM game_rounds WHERE id = $1",
        round_id,
    )
    assert round_row is not None
    assert round_row["wrong_buzz_penalty"] == 0
    assert round_row["ended_at"] is not None

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
        await db.execute(
            "SELECT award_points($1, $2, $3, 0, 0, 0)", game_code, round_id, points
        )

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
