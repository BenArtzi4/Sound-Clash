"""extend_game(): the token-gated "keep playing" TTL extension (migration 039).

Spec: docs/rpc-functions.md §3e, docs/security-rls.md §2.

The manager console's expiry warning banner calls this to push
active_games.expires_at out by one hour. Coverage:
  * happy path: bumps expires_at by exactly 1h from the old value and returns it
  * overdue-but-unswept game: the bump lands 1h from now(), not 1h from the
    stale expires_at (the GREATEST branch)
  * repeat calls stack
  * a 'waiting' (lobby) game is extendable -- the TTL runs from creation
  * token validation: wrong token, null token; a rejected call leaves
    expires_at untouched
  * game-state errors: game_not_found, game_ended
"""

from __future__ import annotations

import datetime
import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, fetch_manager_token

pytestmark = pytest.mark.needs_docker

ONE_HOUR = datetime.timedelta(hours=1)


async def _expires_at(conn: asyncpg.Connection, game_code: str) -> datetime.datetime:
    value = await conn.fetchval(
        "SELECT expires_at FROM active_games WHERE game_code = $1", game_code
    )
    assert value is not None
    return value


@pytest.mark.asyncio
async def test_extends_by_one_hour_and_returns_the_new_expiry(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, expires_in_hours=2)
    token = await fetch_manager_token(db, game_code)
    before = await _expires_at(db, game_code)

    returned = await db.fetchval("SELECT extend_game($1, $2)", game_code, token)

    after = await _expires_at(db, game_code)
    assert returned == after
    assert after - before == ONE_HOUR


@pytest.mark.asyncio
async def test_overdue_game_gets_a_full_hour_from_now(db: asyncpg.Connection) -> None:
    """A game past its expires_at but not yet swept (the pg_cron sweep is
    hourly) must be granted a real hour from now, not `stale expiry + 1h`
    (which could already be in the past)."""
    game_code = await create_test_game(db, expires_in_hours=-1)
    token = await fetch_manager_token(db, game_code)

    returned = await db.fetchval("SELECT extend_game($1, $2)", game_code, token)

    now = await db.fetchval("SELECT now()")
    drift = abs((returned - (now + ONE_HOUR)).total_seconds())
    assert drift < 5, f"expected ~now()+1h, got {returned} (drift {drift}s)"


@pytest.mark.asyncio
async def test_repeat_extensions_stack(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, expires_in_hours=2)
    token = await fetch_manager_token(db, game_code)
    before = await _expires_at(db, game_code)

    await db.fetchval("SELECT extend_game($1, $2)", game_code, token)
    await db.fetchval("SELECT extend_game($1, $2)", game_code, token)

    after = await _expires_at(db, game_code)
    assert after - before == 2 * ONE_HOUR


@pytest.mark.asyncio
async def test_waiting_game_is_extendable(db: asyncpg.Connection) -> None:
    """expires_at counts from creation, so a long lobby is exactly when the
    host needs the extension -- 'waiting' must not be rejected."""
    game_code = await create_test_game(db, status="waiting", expires_in_hours=1)
    token = await fetch_manager_token(db, game_code)
    before = await _expires_at(db, game_code)

    await db.fetchval("SELECT extend_game($1, $2)", game_code, token)

    assert await _expires_at(db, game_code) - before == ONE_HOUR


@pytest.mark.asyncio
async def test_wrong_token_is_rejected_and_nothing_changes(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db)
    before = await _expires_at(db, game_code)

    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetchval("SELECT extend_game($1, $2)", game_code, uuid.uuid4())
    assert exc.value.sqlstate == "28000"
    assert exc.value.message == "manager_token_required"

    assert await _expires_at(db, game_code) == before


@pytest.mark.asyncio
async def test_null_token_is_rejected(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db)

    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetchval("SELECT extend_game($1, NULL::uuid)", game_code)
    assert exc.value.sqlstate == "28000"


@pytest.mark.asyncio
async def test_game_not_found(db: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetchval("SELECT extend_game($1, $2)", "NOSUCH", uuid.uuid4())
    assert exc.value.sqlstate == "P0002"
    assert exc.value.message == "game_not_found"


@pytest.mark.asyncio
async def test_ended_game_is_rejected(db: asyncpg.Connection) -> None:
    """An ended game sits on its final scoreboard until the sweep; there is
    nothing to keep playing, so extending it is refused (same game_ended
    contract as the other token-gated RPCs)."""
    game_code = await create_test_game(db)
    token = await fetch_manager_token(db, game_code)
    await db.execute(
        "UPDATE active_games SET status = 'ended', ended_at = now() WHERE game_code = $1",
        game_code,
    )

    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetchval("SELECT extend_game($1, $2)", game_code, token)
    assert exc.value.sqlstate == "P0001"
    assert exc.value.message == "game_ended"
