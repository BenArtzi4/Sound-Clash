"""RLS; anon EXECUTE grants on the RPC functions.

Spec: docs/security-rls.md §2.

Only buzz_in is callable by anon. award_attempt, end_round, award_bonus,
start_round, end_game, and cleanup_expired_games must reject anon.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_anon_can_execute_buzz_in(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)

    rows = await anon_conn.fetch(
        "SELECT locked, locked_team_id, locked_at FROM buzz_in($1, $2)",
        game_code,
        team_id,
    )
    assert len(rows) == 1
    assert rows[0]["locked"] is True


@pytest.mark.asyncio
async def test_anon_cannot_execute_start_round(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game_code = await create_test_game(db)
    song_id = await create_test_song(db)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute("SELECT start_round($1, $2)", game_code, song_id)


@pytest.mark.asyncio
async def test_anon_cannot_execute_award_attempt(
    anon_conn: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute(
            "SELECT award_attempt($1, $2, 0, 0, 0)",
            "ABCDEF",
            uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_anon_cannot_execute_end_round(
    anon_conn: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute(
            "SELECT end_round($1, $2)",
            "ABCDEF",
            uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_anon_cannot_execute_award_bonus(
    anon_conn: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute(
            "SELECT award_bonus($1, $2)",
            "ABCDEF",
            uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_anon_cannot_execute_end_game(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game_code = await create_test_game(db)
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute("SELECT end_game($1)", game_code)


@pytest.mark.asyncio
async def test_anon_cannot_execute_cleanup_expired_games(
    anon_conn: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.execute("SELECT cleanup_expired_games()")


# ----- migration 020: explicit grant state on the backend-only RPCs ----------
#
# On hosted Supabase a `REVOKE ... FROM PUBLIC` is not enough, because the
# project bootstrap grants EXECUTE on every public function directly to
# anon / authenticated / service_role. Migration 020 revokes from anon and
# authenticated explicitly and re-asserts the grant for service_role. These
# tests pin the resulting grant matrix (they run on the bare Postgres used by
# the DB suite, where 020's REVOKE-from-anon is a no-op but the GRANT-to-
# service_role is not).


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "proname",
    [
        "start_round",
        "end_round",
        "award_attempt",
        "award_bonus",
        "release_buzz_lock",
        "end_game",
        "cleanup_expired_games",
    ],
)
async def test_backend_rpc_grant_matrix(db: asyncpg.Connection, proname: str) -> None:
    rows = await db.fetch(
        """
        SELECT has_function_privilege('anon', p.oid, 'execute')          AS anon_exec,
               has_function_privilege('authenticated', p.oid, 'execute') AS auth_exec,
               has_function_privilege('service_role', p.oid, 'execute')  AS svc_exec
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = $1
        """,
        proname,
    )
    assert rows, f"function {proname} not found"
    for r in rows:
        assert r["anon_exec"] is False, f"{proname}: anon must not have EXECUTE"
        assert r["auth_exec"] is False, f"{proname}: authenticated must not have EXECUTE"
        assert r["svc_exec"] is True, f"{proname}: service_role must keep EXECUTE"


@pytest.mark.asyncio
async def test_buzz_in_remains_anon_executable(db: asyncpg.Connection) -> None:
    """The one RPC the browser calls directly stays anon-executable."""
    can = await db.fetchval(
        """
        SELECT bool_and(has_function_privilege('anon', p.oid, 'execute'))
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'buzz_in'
        """
    )
    assert can is True
