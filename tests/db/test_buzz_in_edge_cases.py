"""buzz_in() error and edge-case behavior.

Spec: docs/rpc-functions.md §1 ("Error semantics" table).
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import call_buzz_in, create_test_game, create_test_team

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_buzz_when_game_waiting_returns_locked_false(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="waiting")
    team_id = await create_test_team(db, game_code)

    row = await call_buzz_in(db, game_code, team_id)

    assert row is not None
    assert row["locked"] is False
    assert row["locked_team_id"] is None


@pytest.mark.asyncio
async def test_buzz_when_game_ended_returns_locked_false(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="ended")
    team_id = await create_test_team(db, game_code)

    row = await call_buzz_in(db, game_code, team_id)

    assert row is not None
    assert row["locked"] is False


@pytest.mark.asyncio
async def test_buzz_when_game_missing_returns_empty(
    db: asyncpg.Connection,
) -> None:
    row = await call_buzz_in(db, "ZZZZZZ", uuid.uuid4())
    assert row is None


@pytest.mark.asyncio
async def test_buzz_when_lock_already_held_returns_holder(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    first = await create_test_team(db, game_code, name="First")
    second = await create_test_team(db, game_code, name="Second")

    win = await call_buzz_in(db, game_code, first)
    assert win is not None and win["locked"] is True
    assert win["locked_team_id"] == first

    loss = await call_buzz_in(db, game_code, second)
    assert loss is not None
    assert loss["locked"] is False
    assert loss["locked_team_id"] == first
    assert loss["locked_at"] == win["locked_at"]
