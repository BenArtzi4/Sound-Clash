"""Verdicts and Continue are scoped to the buzz observed by the host."""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import UUID

import asyncpg
import pytest

from ._helpers import (
    call_buzz_in,
    create_test_game,
    create_test_song,
    create_test_team,
    fetch_manager_token,
)

pytestmark = pytest.mark.needs_docker


async def _setup(db):
    code = await create_test_game(db, status="waiting")
    alpha = await create_test_team(db, code, name="Alpha")
    bravo = await create_test_team(db, code, name="Bravo")
    token = await fetch_manager_token(db, code)
    song = await create_test_song(db)
    round_id = await db.fetchval("SELECT start_round($1, $2)", code, song)
    assert (await call_buzz_in(db, code, alpha))["locked"]
    return code, token, round_id, alpha, bravo


async def _attempt_id(db, code):
    return await db.fetchval("SELECT buzz_attempt_id FROM active_games WHERE game_code = $1", code)


async def _award(db, code, token, round_id, attempt_id, *, title=False, artist=False, wrong=False):
    sql = "SELECT * FROM award_attempt($1, $2, $3, $4, $5, $6"
    args = (code, round_id, title, artist, wrong, token)
    if attempt_id is None:  # Exercise the previous browser overload during rollout.
        return await db.fetchrow(sql + ")", *args)
    return await db.fetchrow(sql + ", $7)", *args, attempt_id)


async def _totals(db, code):
    rows = await db.fetch("SELECT name, score FROM game_teams WHERE game_code = $1", code)
    return {row["name"]: row["score"] for row in rows}


@pytest.mark.parametrize("same_team", [False, True])
async def test_delayed_verdict_and_continue_cannot_change_a_new_buzz(db, same_team):
    code, token, round_id, alpha, bravo = await _setup(db)
    old_attempt = await _attempt_id(db, code)
    await db.execute("SELECT release_buzz_lock($1, $2, $3)", code, token, old_attempt)
    next_team = alpha if same_team else bravo
    assert (await call_buzz_in(db, code, next_team))["locked"]
    new_attempt = await _attempt_id(db, code)
    assert new_attempt != old_attempt

    with pytest.raises(asyncpg.RaiseError, match="stale_buzz"):
        await _award(db, code, token, round_id, old_attempt, title=True)
    with pytest.raises(asyncpg.RaiseError, match="stale_buzz"):
        await db.execute("SELECT release_buzz_lock($1, $2, $3)", code, token, old_attempt)
    assert await _totals(db, code) == {"Alpha": 0, "Bravo": 0}
    assert (
        await db.fetchval("SELECT count(*) FROM game_round_attempts WHERE round_id = $1", round_id)
        == 0
    )
    assert await _attempt_id(db, code) == new_attempt
    assert (await _award(db, code, token, round_id, new_attempt, title=True))[
        "team_id"
    ] == next_team


async def _while_first_transaction_is_open(db, pool, first, second, *, before_commit=None):
    """Release the first transaction only once the second asks Postgres for a lock."""
    async with pool.acquire() as peer:
        async with db.transaction():
            first_result = await first(db)
            task = asyncio.create_task(second(peer))
            try:
                async with asyncio.timeout(5):
                    while not await db.fetchval(
                        "SELECT $1 = ANY(pg_blocking_pids($2))",
                        db.get_server_pid(),
                        peer.get_server_pid(),
                    ):
                        if task.done():
                            task.result()
                            pytest.fail("Second verdict returned before the first committed")
                        await asyncio.sleep(0.01)
                if before_commit is not None:
                    await before_commit(db)
            except BaseException:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise
        (second_result,) = await asyncio.gather(task, return_exceptions=True)
    return first_result, second_result


@pytest.mark.parametrize("guarded", [False, True])
@pytest.mark.parametrize(
    ("first_flags", "second_flags", "score", "error"),
    [
        ({"title": True}, {"title": True}, 10, "title_already_claimed"),
        ({"wrong": True}, {"wrong": True}, -3, "stale_buzz"),
        ({"title": True}, {"artist": True}, 15, None),
    ],
)
async def test_overlapping_verdicts_only_apply_valid_points(
    db, pool, guarded, first_flags, second_flags, score, error
):
    code, token, round_id, _, _ = await _setup(db)
    attempt_id = await _attempt_id(db, code) if guarded else None

    result, following = await _while_first_transaction_is_open(
        db,
        pool,
        lambda conn: _award(conn, code, token, round_id, attempt_id, **first_flags),
        lambda conn: _award(conn, code, token, round_id, attempt_id, **second_flags),
    )
    if error:
        assert isinstance(following, asyncpg.RaiseError), following
        assert str(following) == error
        assert result["team_total_score"] == score
    else:
        assert isinstance(following, asyncpg.Record), following
        assert following["team_total_score"] == score
        if guarded:
            assert await _attempt_id(db, code) == attempt_id
    assert await _totals(db, code) == {"Alpha": score, "Bravo": 0}
    assert await db.fetchval(
        "SELECT count(*) FROM game_round_attempts WHERE round_id = $1", round_id
    ) == (1 if error else 2)


async def test_old_round_cannot_score_or_release_the_new_lock(db):
    code, token, old_round, _, bravo = await _setup(db)
    old_attempt = await _attempt_id(db, code)
    song = await create_test_song(db, youtube_id="abcdefghijl")
    await db.fetchval("SELECT start_round($1, $2)", code, song)
    assert await _attempt_id(db, code) is None
    assert (await call_buzz_in(db, code, bravo))["locked"]
    new_attempt = await _attempt_id(db, code)

    with pytest.raises(asyncpg.RaiseError, match="round_already_ended"):
        await _award(db, code, token, old_round, old_attempt, wrong=True)
    with pytest.raises(asyncpg.RaiseError, match="stale_buzz"):
        await db.execute("SELECT release_buzz_lock($1, $2, $3)", code, token, old_attempt)
    assert await _attempt_id(db, code) == new_attempt
    assert await _totals(db, code) == {"Alpha": 0, "Bravo": 0}


async def test_guarded_calls_still_require_the_manager_token(db, anon_conn):
    code, token, round_id, _, _ = await _setup(db)
    attempt_id = await _attempt_id(db, code)
    invalid = UUID(int=0)
    with pytest.raises(
        asyncpg.InvalidAuthorizationSpecificationError, match="manager_token_required"
    ):
        await _award(anon_conn, code, invalid, round_id, attempt_id, title=True)
    with pytest.raises(
        asyncpg.InvalidAuthorizationSpecificationError, match="manager_token_required"
    ):
        await anon_conn.execute("SELECT release_buzz_lock($1, $2, $3)", code, invalid, attempt_id)
    assert await _totals(db, code) == {"Alpha": 0, "Bravo": 0}
    assert await _attempt_id(db, code) == attempt_id
    assert (await _award(anon_conn, code, token, round_id, attempt_id, title=True))[
        "points_delta"
    ] == 10


async def test_backfill_keeps_a_held_buzz_scoreable_and_is_idempotent(db):
    code, token, round_id, _, _ = await _setup(db)
    migrations = Path(__file__).resolve().parents[2] / "db" / "migrations"
    broadcast = migrations / "058_buzz_lock_broadcast.sql"
    guard = migrations / "059_guard_scoring_by_buzz.sql"
    await db.execute(broadcast.read_text(encoding="utf-8"))
    await db.execute("UPDATE active_games SET buzz_attempt_id = NULL WHERE game_code = $1", code)
    original_time = await db.fetchval(
        "SELECT locked_at FROM active_games WHERE game_code = $1", code
    )
    assert await _attempt_id(db, code) is None

    await db.execute(guard.read_text(encoding="utf-8"))
    attempt_id = await _attempt_id(db, code)
    assert isinstance(attempt_id, int)
    await db.execute(guard.read_text(encoding="utf-8"))
    assert await _attempt_id(db, code) == attempt_id
    assert (
        await db.fetchval("SELECT locked_at FROM active_games WHERE game_code = $1", code)
        == original_time
    )
    result = await _award(db, code, token, round_id, attempt_id, title=True, artist=True)
    assert result["points_delta"] == 15
    assert await _attempt_id(db, code) == attempt_id


async def test_player_buzz_does_not_wait_on_host_transaction_lock(db, pool):
    code, token, _, _, bravo = await _setup(db)
    await db.execute(
        "SELECT release_buzz_lock($1, $2, $3)", code, token, await _attempt_id(db, code)
    )
    async with db.transaction(), pool.acquire() as player:
        await db.execute("SELECT pg_advisory_xact_lock(194784, hashtext($1))", code)
        async with asyncio.timeout(2):
            result = await call_buzz_in(player, code, bravo)
        assert result["locked"] and result["locked_team_id"] == bravo


async def test_ended_game_rejects_verdict_and_continue(db):
    code, token, round_id, _, _ = await _setup(db)
    attempt_id = await _attempt_id(db, code)
    await db.execute("SELECT end_game($1)", code)

    with pytest.raises(asyncpg.RaiseError, match="game_ended"):
        await _award(db, code, token, round_id, attempt_id, title=True)
    with pytest.raises(asyncpg.RaiseError, match="game_ended"):
        await db.execute("SELECT release_buzz_lock($1, $2, $3)", code, token, attempt_id)
    assert await _totals(db, code) == {"Alpha": 0, "Bravo": 0}


async def test_lock_change_during_verdict_rolls_back_all_writes(db, pool):
    code, token, round_id, alpha, bravo = await _setup(db)
    attempt_id = await _attempt_id(db, code)

    async def block_score(conn):
        await conn.execute("SELECT id FROM game_teams WHERE id = $1 FOR NO KEY UPDATE", alpha)

    async def replace_buzz(conn):
        # Simulate a game-row change that does not use the host advisory lock.
        await conn.execute(
            "UPDATE active_games SET buzzed_team_id = NULL, locked_at = NULL WHERE game_code = $1",
            code,
        )
        assert (await call_buzz_in(conn, code, bravo))["locked"]

    _, error = await _while_first_transaction_is_open(
        db,
        pool,
        block_score,
        lambda conn: _award(conn, code, token, round_id, attempt_id, title=True),
        before_commit=replace_buzz,
    )

    assert isinstance(error, asyncpg.RaiseError) and str(error) == "stale_buzz"
    assert await _totals(db, code) == {"Alpha": 0, "Bravo": 0}
    assert (
        await db.fetchval("SELECT title_claimed_by FROM game_rounds WHERE id = $1", round_id)
        is None
    )
    assert (
        await db.fetchval("SELECT count(*) FROM game_round_attempts WHERE round_id = $1", round_id)
        == 0
    )
    assert (
        await db.fetchval("SELECT buzzed_team_id FROM active_games WHERE game_code = $1", code)
        == bravo
    )
