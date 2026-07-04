"""game_secrets: the per-game manager token, moved off the anon-readable,
Realtime-published active_games row into a table anon can never see (migration
034, the D-1 fix).

Spec: docs/security-rls.md §2, docs/data-model.md.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game, fetch_manager_token

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_creating_a_game_provisions_exactly_one_secret(db: asyncpg.Connection) -> None:
    """The AFTER INSERT trigger on active_games mints one manager token."""
    game_code = await create_test_game(db)
    rows = await db.fetch("SELECT manager_token FROM game_secrets WHERE game_code = $1", game_code)
    assert len(rows) == 1
    assert rows[0]["manager_token"] is not None


@pytest.mark.asyncio
async def test_each_game_gets_an_independent_token(db: asyncpg.Connection) -> None:
    a = await fetch_manager_token(db, await create_test_game(db))
    b = await fetch_manager_token(db, await create_test_game(db))
    assert a != b


@pytest.mark.asyncio
async def test_anon_cannot_read_game_secrets(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    """The whole point of D-1: a player (anon) can never read the host credential.
    game_secrets has no anon read policy and no base SELECT grant, so the read is
    rejected at the privilege check (not merely filtered to zero rows)."""
    await create_test_game(db)  # a secret now exists
    with pytest.raises(
        (asyncpg.InsufficientPrivilegeError, asyncpg.exceptions.InsufficientPrivilegeError)
    ):
        await anon_conn.execute("SELECT * FROM game_secrets")


@pytest.mark.asyncio
async def test_anon_cannot_write_game_secrets(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game_code = await create_test_game(db)
    with pytest.raises(
        (asyncpg.InsufficientPrivilegeError, asyncpg.exceptions.InsufficientPrivilegeError)
    ):
        await anon_conn.execute(
            "UPDATE game_secrets SET manager_token = gen_random_uuid() WHERE game_code = $1",
            game_code,
        )


@pytest.mark.asyncio
async def test_active_games_no_longer_carries_the_token(db: asyncpg.Connection) -> None:
    """The leak is closed: the token column is gone from the anon-readable,
    Realtime-published active_games table."""
    exists = await db.fetchval(
        """
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'active_games'
             AND column_name = 'manager_token'
        )
        """
    )
    assert exists is False


@pytest.mark.asyncio
async def test_game_secrets_not_in_realtime_publication(db: asyncpg.Connection) -> None:
    """game_secrets must never be fanned out over Realtime."""
    in_pub = await db.fetchval(
        """
        SELECT EXISTS (
          SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'game_secrets'
        )
        """
    )
    assert in_pub is False


@pytest.mark.asyncio
async def test_deleting_a_game_cascades_the_secret(db: asyncpg.Connection) -> None:
    """Same 4-hour ephemerality: removing the game removes its secret (FK cascade),
    so cleanup_expired_games leaves no orphan tokens behind."""
    game_code = await create_test_game(db)
    await db.execute("DELETE FROM active_games WHERE game_code = $1", game_code)
    remaining = await db.fetchval(
        "SELECT count(*) FROM game_secrets WHERE game_code = $1", game_code
    )
    assert remaining == 0
