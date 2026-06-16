"""RLS; anon EXECUTE grants on the RPC functions.

Spec: docs/security-rls.md §2.

Five RPCs are callable by anon -- ``buzz_in`` (since migration 006),
``award_attempt`` and ``release_buzz_lock`` (as of migration 021, with the
legacy un-tokenised overloads retired by migration 023), ``select_next_song``
(as of migration 022), and ``peek_next_song`` (the read-only prebuffer probe,
as of migration 029). Each does its own in-function manager-token check before
performing any work, so the function-level EXECUTE grant is safe. The remaining
backend-only RPCs -- ``start_round``, ``end_round``, ``award_bonus``,
``end_game``, ``cleanup_expired_games`` -- must still reject anon.
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
async def test_anon_can_execute_award_attempt_but_token_check_runs(
    anon_conn: asyncpg.Connection,
) -> None:
    """Migration 021: anon CAN call award_attempt, but the function body's
    manager_token check rejects forged calls. The error must be
    'manager_token_required' (sqlstate 28000), not 'insufficient privilege'."""
    with pytest.raises(asyncpg.PostgresError) as exc:
        await anon_conn.execute(
            "SELECT award_attempt($1, $2, 0, 0, 0, $3)",
            "ABCDEF",
            uuid.uuid4(),
            uuid.uuid4(),
        )
    # We don't get InsufficientPrivilegeError -- anon does have EXECUTE.
    assert not isinstance(exc.value, asyncpg.InsufficientPrivilegeError)
    # Either game_not_found (P0002) or manager_token_required (28000),
    # depending on whether the game-code lookup hits first; both prove the
    # function ran and refused, not that anon was denied at the grant gate.
    assert exc.value.sqlstate in ("P0002", "28000")


@pytest.mark.asyncio
async def test_anon_can_execute_release_buzz_lock_but_token_check_runs(
    anon_conn: asyncpg.Connection,
) -> None:
    with pytest.raises(asyncpg.PostgresError) as exc:
        await anon_conn.execute(
            "SELECT release_buzz_lock($1, $2)", "ABCDEF", uuid.uuid4()
        )
    assert not isinstance(exc.value, asyncpg.InsufficientPrivilegeError)
    assert exc.value.sqlstate in ("P0002", "28000")


@pytest.mark.asyncio
async def test_anon_can_execute_select_next_song_but_token_check_runs(
    anon_conn: asyncpg.Connection,
) -> None:
    """Migration 022: anon CAN call select_next_song, but the in-function
    manager_token check rejects forged calls. The error must be
    ``manager_token_required`` (sqlstate 28000) or, if the game-code lookup
    fires first, ``game_not_found`` (P0002). Either way the function ran --
    it wasn't blocked at the grant gate."""
    with pytest.raises(asyncpg.PostgresError) as exc:
        await anon_conn.execute(
            "SELECT select_next_song($1, $2, NULL::uuid)",
            "ABCDEF",
            uuid.uuid4(),
        )
    assert not isinstance(exc.value, asyncpg.InsufficientPrivilegeError)
    assert exc.value.sqlstate in ("P0002", "28000")


@pytest.mark.asyncio
async def test_anon_can_execute_peek_next_song_but_token_check_runs(
    anon_conn: asyncpg.Connection,
) -> None:
    """Migration 029: anon CAN call peek_next_song (the read-only prebuffer
    probe), but the in-function manager_token check rejects forged calls. The
    error must be ``manager_token_required`` (sqlstate 28000) or, if the
    game-code lookup fires first, ``game_not_found`` (P0002) -- either way the
    function ran, it wasn't blocked at the grant gate."""
    with pytest.raises(asyncpg.PostgresError) as exc:
        await anon_conn.execute(
            "SELECT peek_next_song($1, $2)",
            "ABCDEF",
            uuid.uuid4(),
        )
    assert not isinstance(exc.value, asyncpg.InsufficientPrivilegeError)
    assert exc.value.sqlstate in ("P0002", "28000")


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
        "award_bonus",
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
@pytest.mark.parametrize(
    "proname, args",
    [
        # Legacy un-tokenised overloads of award_attempt + release_buzz_lock,
        # retired by migration 023 once the new direct-RPC path had soaked on
        # prod. They must no longer exist; if they reappear it means a stale
        # migration replayed and left orphan plumbing behind.
        (
            "award_attempt",
            "p_game_code text, p_round_id uuid, p_title integer, "
            "p_artist integer, p_wrong_buzz integer",
        ),
        ("release_buzz_lock", "p_game_code text"),
    ],
)
async def test_legacy_overloads_were_dropped(
    db: asyncpg.Connection, proname: str, args: str
) -> None:
    """Migration 023 dropped the pre-021 5-arg / 1-arg overloads of
    ``award_attempt`` and ``release_buzz_lock``. If they exist, it means
    something resurrected them -- a partial migration replay, a manual
    CREATE, or a hand-applied SQL fix -- and PostgREST overload resolution
    is back to the ambiguous state migration 021 was careful to avoid."""
    row = await db.fetchrow(
        """
        SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = $1
           AND pg_get_function_identity_arguments(p.oid) = $2
        """,
        proname,
        args,
    )
    assert row is None, (
        f"legacy overload {proname}({args}) is back -- migration 023 should have dropped it"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "proname, args",
    [
        # Format matches pg_get_function_identity_arguments() output:
        # "<param_name> <type>, ..." -- type names use Postgres canonical
        # spelling ("character" for char(N), "integer" for int, etc.).
        # buzz_in: single signature; entire function is anon-callable.
        ("buzz_in", "p_game_code character, p_team_id uuid"),
        # award_attempt and release_buzz_lock: the tokenised overloads added in
        # migration 021 are now the only overloads (migration 023 dropped the
        # legacy un-tokenised ones once the new direct-RPC path was stable).
        (
            "award_attempt",
            "p_game_code text, p_round_id uuid, p_title integer, "
            "p_artist integer, p_wrong_buzz integer, p_manager_token uuid",
        ),
        ("release_buzz_lock", "p_game_code text, p_manager_token uuid"),
        # select_next_song: single tokenised signature added in migration 022.
        # Migration 020's REVOKE loop pre-dates this function and doesn't
        # touch it; the explicit GRANT in migration 022 is what makes anon
        # EXECUTE land. The in-function token check provides the actual gate.
        (
            "select_next_song",
            "p_game_code text, p_manager_token uuid, p_song_id uuid",
        ),
        # peek_next_song: read-only prebuffer probe added in migration 029.
        # Same anon-grant + in-function token-check model as select_next_song.
        (
            "peek_next_song",
            "p_game_code text, p_manager_token uuid",
        ),
    ],
)
async def test_anon_executable_rpc_grant_matrix(
    db: asyncpg.Connection, proname: str, args: str
) -> None:
    """The three RPCs the browser calls direct must keep anon EXECUTE on the
    exact overload signature the browser sends."""
    anon_exec = await db.fetchval(
        """
        SELECT has_function_privilege('anon', p.oid, 'execute')
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = $1
           AND pg_get_function_identity_arguments(p.oid) = $2
        """,
        proname,
        args,
    )
    assert anon_exec is True, (
        f"{proname}({args}): anon must have EXECUTE so the browser can call it direct"
    )
