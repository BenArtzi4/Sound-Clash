"""award_bonus(): host-discretion award to any team.

Spec: docs/rpc-functions.md and db/migrations/014_scoring_revamp.sql.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_team, fetch_manager_token

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_manager_bonus_as_anon(db: asyncpg.Connection, anon_conn: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    team = await create_test_team(db, code)
    token = await fetch_manager_token(db, code)
    award = "SELECT award_manager_bonus($1, $2, $3)"
    assert await anon_conn.fetchval(award, code, token, team) == 4
    assert await anon_conn.fetchval(award, code, token, team) == 8
    assert await db.fetchval("SELECT score FROM game_teams WHERE id = $1", team) == 8


@pytest.mark.asyncio
async def test_manager_bonus_checks_token_and_team(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    code = await create_test_game(db)
    other_code = await create_test_game(db)
    team = await create_test_team(db, code)
    token = await fetch_manager_token(db, code)
    other_token = await fetch_manager_token(db, other_code)
    award = "SELECT award_manager_bonus($1, $2, $3)"
    for invalid_token in (other_token, None):
        with pytest.raises(asyncpg.PostgresError, match="manager_token_required") as exc:
            await anon_conn.fetchval(award, code, invalid_token, team)
        assert exc.value.sqlstate == "28000"
    with pytest.raises(asyncpg.PostgresError, match="team_not_in_game"):
        await anon_conn.fetchval(award, other_code, other_token, team)
    await db.execute("UPDATE active_games SET status = 'ended' WHERE game_code = $1", code)
    with pytest.raises(asyncpg.PostgresError, match="game_already_ended"):
        await anon_conn.fetchval(award, code, token, team)
    assert await db.fetchval("SELECT score FROM game_teams WHERE id = $1", team) == 0


@pytest.mark.asyncio
async def test_award_bonus_default_4(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    new_total = await db.fetchval(
        "SELECT award_bonus($1, $2)", game_code, team_id
    )
    assert new_total == 4


@pytest.mark.asyncio
async def test_award_bonus_custom_points(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    new_total = await db.fetchval(
        "SELECT award_bonus($1, $2, 7)", game_code, team_id
    )
    assert new_total == 7


@pytest.mark.asyncio
async def test_award_bonus_accumulates(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    for _ in range(3):
        await db.fetchval("SELECT award_bonus($1, $2)", game_code, team_id)
    score = await db.fetchval(
        "SELECT score FROM game_teams WHERE id = $1", team_id
    )
    assert score == 12


@pytest.mark.asyncio
async def test_award_bonus_rejects_non_positive(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetchval("SELECT award_bonus($1, $2, 0)", game_code, team_id)
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_bonus_team_must_be_in_game(db: asyncpg.Connection) -> None:
    code_a = await create_test_game(db, status="playing")
    code_b = await create_test_game(db, status="playing")
    team_in_b = await create_test_team(db, code_b)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetchval("SELECT award_bonus($1, $2)", code_a, team_in_b)
    assert exc.value.sqlstate == "P0002"


@pytest.mark.asyncio
async def test_award_bonus_game_not_found(db: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetchval(
            "SELECT award_bonus($1, $2)", "ZZZZZZ", uuid.uuid4()
        )
    assert exc.value.sqlstate == "P0002"


@pytest.mark.asyncio
async def test_award_bonus_rejects_ended_game(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="ended")
    team_id = await create_test_team(db, game_code)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetchval("SELECT award_bonus($1, $2)", game_code, team_id)
    assert exc.value.sqlstate == "P0001"
