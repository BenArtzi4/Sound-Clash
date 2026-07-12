"""team_secrets: the per-team rejoin token (issue #183, migration 046).

Modelled on game_secrets (migration 034): the token lives in a table anon can
never read and that is never fanned out over Realtime, so a player can't lift
another team's rejoin token off the wire. The host reveals it only via the
manager-token-gated REST endpoint.

Spec: docs/security-rls.md §2, docs/data-model.md.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_team

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_creating_a_team_provisions_exactly_one_secret(db: asyncpg.Connection) -> None:
    """The AFTER INSERT trigger on game_teams mints one rejoin token per team."""
    code = await create_test_game(db)
    team_id = await create_test_team(db, code)
    rows = await db.fetch("SELECT rejoin_token FROM team_secrets WHERE team_id = $1", team_id)
    assert len(rows) == 1
    assert rows[0]["rejoin_token"] is not None


@pytest.mark.asyncio
async def test_each_team_gets_an_independent_token(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    a = await create_test_team(db, code, name="Alpha")
    b = await create_test_team(db, code, name="Bravo")
    token_a = await db.fetchval("SELECT rejoin_token FROM team_secrets WHERE team_id = $1", a)
    token_b = await db.fetchval("SELECT rejoin_token FROM team_secrets WHERE team_id = $1", b)
    assert token_a is not None and token_b is not None
    assert token_a != token_b


@pytest.mark.asyncio
async def test_anon_cannot_read_team_secrets(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    """A player (anon) must never be able to read a team's rejoin token, or they
    could hijack that team from another device. No anon read policy and no base
    SELECT grant, so the read is rejected at the privilege check."""
    code = await create_test_game(db)
    await create_test_team(db, code)  # a secret now exists
    with pytest.raises(
        (asyncpg.InsufficientPrivilegeError, asyncpg.exceptions.InsufficientPrivilegeError)
    ):
        await anon_conn.execute("SELECT * FROM team_secrets")


@pytest.mark.asyncio
async def test_anon_cannot_write_team_secrets(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    code = await create_test_game(db)
    team_id = await create_test_team(db, code)
    with pytest.raises(
        (asyncpg.InsufficientPrivilegeError, asyncpg.exceptions.InsufficientPrivilegeError)
    ):
        await anon_conn.execute(
            "UPDATE team_secrets SET rejoin_token = gen_random_uuid() WHERE team_id = $1",
            team_id,
        )


@pytest.mark.asyncio
async def test_team_secrets_not_in_realtime_publication(db: asyncpg.Connection) -> None:
    """team_secrets must never be fanned out over Realtime."""
    in_pub = await db.fetchval(
        """
        SELECT EXISTS (
          SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'team_secrets'
        )
        """
    )
    assert in_pub is False


@pytest.mark.asyncio
async def test_deleting_a_team_cascades_the_secret(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    team_id = await create_test_team(db, code)
    await db.execute("DELETE FROM game_teams WHERE id = $1", team_id)
    remaining = await db.fetchval(
        "SELECT count(*) FROM team_secrets WHERE team_id = $1", team_id
    )
    assert remaining == 0


@pytest.mark.asyncio
async def test_deleting_a_game_cascades_team_secrets(db: asyncpg.Connection) -> None:
    """Same 4-hour ephemerality as the team: removing the game cascades to the
    teams and their secrets, so cleanup_expired_games leaves no orphan tokens."""
    code = await create_test_game(db)
    team_id = await create_test_team(db, code)
    await db.execute("DELETE FROM active_games WHERE game_code = $1", code)
    remaining = await db.fetchval(
        "SELECT count(*) FROM team_secrets WHERE team_id = $1", team_id
    )
    assert remaining == 0
