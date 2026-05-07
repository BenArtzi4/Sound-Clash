"""award_bonus() — host-discretion award to any team.

Spec: docs/rpc-functions.md and db/migrations/014_scoring_revamp.sql.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_team

pytestmark = pytest.mark.needs_docker


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
