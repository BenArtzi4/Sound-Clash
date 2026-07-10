"""buzz_in() error and edge-case behavior.

Spec: docs/rpc-functions.md §1 ("Error semantics" table).
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import call_buzz_in, create_test_game, create_test_song, create_test_team

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


@pytest.mark.asyncio
async def test_buzz_member_team_wins_lock(
    db: asyncpg.Connection,
) -> None:
    """Happy path unchanged (mig 041): a team that belongs to the game buzzes and
    wins the lock, which is recorded on active_games.buzzed_team_id."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)

    row = await call_buzz_in(db, game_code, team_id)

    assert row is not None
    assert row["locked"] is True
    assert row["locked_team_id"] == team_id

    active_lock = await db.fetchval(
        "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", game_code
    )
    assert active_lock == team_id


@pytest.mark.asyncio
async def test_buzz_foreign_team_cannot_win_lock(
    db: asyncpg.Connection,
) -> None:
    """Migration 041: a team from a DIFFERENT game cannot be planted into this
    game's buzz lock. Passing a foreign game's team_id to buzz_in for this game
    must NOT win the lock -- active_games.buzzed_team_id stays NULL and the return
    row is locked=false. This closes the cross-game score-write vector (the FK
    alone accepted any game_teams row; award_bonus already guards this with
    team_not_in_game)."""
    game_code = await create_test_game(db, status="playing")
    other_game = await create_test_game(db, status="playing")
    foreign_team = await create_test_team(db, other_game, name="Foreign")

    row = await call_buzz_in(db, game_code, foreign_team)

    # The foreign team fails the membership predicate, so the UPDATE matches 0
    # rows and the function falls through to the "already locked / not playable"
    # branch, returning the (still-empty) lock state for this game.
    assert row is not None
    assert row["locked"] is False
    assert row["locked_team_id"] is None

    # No foreign team was planted into this game's lock.
    active_lock = await db.fetchval(
        "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", game_code
    )
    assert active_lock is None

    # And a legitimate member of this game can still buzz afterwards.
    member = await create_test_team(db, game_code, name="Member")
    win = await call_buzz_in(db, game_code, member)
    assert win is not None and win["locked"] is True
    assert win["locked_team_id"] == member


@pytest.mark.asyncio
async def test_buzz_sets_active_games_lock_only_not_round(
    db: asyncpg.Connection,
) -> None:
    """Migration 035: buzz_in records the lock ONLY on active_games. The dead
    mirror-write to game_rounds.buzzed_team_id (mig 011, for the retired
    award_points) is gone -- that column stays NULL, and the buzz-path no longer
    broadcasts a redundant game_rounds ROUND_CHANGE on every buzz."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    song_id = await create_test_song(db)
    round_id = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)

    win = await call_buzz_in(db, game_code, team_id)
    assert win is not None and win["locked"] is True

    # The lock lives on active_games...
    active_lock = await db.fetchval(
        "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", game_code
    )
    assert active_lock == team_id
    # ...and buzz_in no longer touches game_rounds.buzzed_team_id.
    round_lock = await db.fetchval(
        "SELECT buzzed_team_id FROM game_rounds WHERE id = $1", round_id
    )
    assert round_lock is None
