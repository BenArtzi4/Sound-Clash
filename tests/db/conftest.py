"""Pytest fixtures for database tests.

Spins up a Postgres instance and applies db/migrations/*.sql in numeric order.
Uses an external $DATABASE_URL when set (CI postgres service container, or a
local Supabase started via `supabase start`); otherwise launches a
testcontainers postgres:15 container.

Migrations are idempotent so re-applying them on a persistent DB is safe.

WARNING: the function-scoped fixtures TRUNCATE songs/genres/song_genres (see
ALL_TABLES) and reseed genres before every test. Pointing $DATABASE_URL at a
Supabase/dev database whose catalog you care about will WIPE it as the suite
runs -- use a throwaway DB, or leave $DATABASE_URL unset to fall back to a
testcontainer.

See docs/testing-strategy.md §4.1 for the test inventory.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import asyncpg
import pytest
import pytest_asyncio

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"

# A dedicated LOGIN role the RLS tests connect *as* directly (its own DSN),
# instead of doing `SET ROLE anon` on the superuser connection. `SET ROLE` on a
# superuser session leaks superuser/role state across the reused testcontainer
# and was the root cause of the recurring `test_rls_anon` flake (spurious "DID
# NOT RAISE InsufficientPrivilegeError" when the file ran after the rest of the
# suite). Postgres's `anon` role is NOLOGIN (see migration 006), so it can't be
# connected to directly; this role is LOGIN + INHERIT and is GRANTed membership
# in `anon`, so every policy/GRANT targeting `anon` applies to it -- while it is
# genuinely NOT a superuser and does NOT bypass RLS. Test-only: created in the
# `_migrated` setup fixture, never in a migration file (so it never reaches prod).
ANON_LOGIN_ROLE = "anon_login_test"
ANON_LOGIN_PASSWORD = "anon_login_test_pw"  # noqa: S105 - throwaway local test role

# Truncated between tests so each function starts clean. Durable tables
# (songs/genres/song_genres) are included so tests populate exactly what they need.
# The game_history* tables are durable and have NO FK to active_games, so the
# CASCADE that clears the ephemeral tables does not reach them -- list them
# explicitly or archived rows leak across tests.
ALL_TABLES = (
    "game_history_songs",
    "game_history_teams",
    "game_history",
    "game_rounds",
    "game_teams",
    "active_games",
    "song_genres",
    "songs",
    "genres",
)


def _read_migrations() -> list[tuple[str, str]]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    return [(f.name, f.read_text(encoding="utf-8")) for f in files]


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """DSN to connect to. Either externally provided or a testcontainer."""
    url = os.environ.get("DATABASE_URL")
    if url:
        url = url.replace("postgresql+psycopg2://", "postgresql://")
        url = url.replace("postgres+psycopg2://", "postgres://")
        yield url
        return

    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError as e:  # pragma: no cover - dev-deps install guard
        pytest.skip(f"testcontainers not available and DATABASE_URL not set: {e}")

    container = PostgresContainer("postgres:15")
    container.start()
    try:
        yield container.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")
    finally:
        container.stop()


def _anon_login_dsn(migrated_url: str) -> str:
    """Derive the anon-login DSN from the migrated (superuser) DSN.

    Same host/port/dbname/query; only the user+password change to the dedicated
    non-superuser login role. Keeps the tests pointed at the identical database
    the migrations were applied to, just with anon's effective privileges.
    """
    parts = urlsplit(migrated_url)
    host = parts.hostname or "localhost"
    netloc = f"{quote(ANON_LOGIN_ROLE)}:{quote(ANON_LOGIN_PASSWORD)}@{host}"
    if parts.port is not None:
        netloc += f":{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _migrated(database_url: str) -> AsyncIterator[str]:
    """Apply every migration once per session, then provision the anon-login role.

    `loop_scope="session"` is required because pytest-asyncio defaults to a
    function-scoped event loop; without this, the session-scoped fixture
    can't bind to the per-test loops that consume it.
    """
    conn = await asyncpg.connect(database_url)
    try:
        for name, sql in _read_migrations():
            try:
                await conn.execute(sql)
            except Exception as e:
                raise RuntimeError(f"Migration {name} failed: {e}") from e
        # Provision the dedicated non-superuser LOGIN role the RLS tests connect
        # as (see ANON_LOGIN_ROLE). Idempotent: created only if missing, then its
        # attributes + `anon` membership are re-asserted so a reused container
        # (external $DATABASE_URL / testcontainer reuse) converges to the same
        # state. NOSUPERUSER + NOBYPASSRLS + INHERIT make it a true anon stand-in.
        # The interpolated values are hardcoded module constants, not user input.
        provision_role_sql = f"""
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{ANON_LOGIN_ROLE}') THEN
                CREATE ROLE {ANON_LOGIN_ROLE} LOGIN PASSWORD '{ANON_LOGIN_PASSWORD}';
              END IF;
            END $$;
            ALTER ROLE {ANON_LOGIN_ROLE}
              LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT
              PASSWORD '{ANON_LOGIN_PASSWORD}';
            GRANT anon TO {ANON_LOGIN_ROLE};
            """  # noqa: S608 - constants, not user input
        await conn.execute(provision_role_sql)
    finally:
        await conn.close()
    yield database_url


@pytest_asyncio.fixture
async def db(_migrated: str) -> AsyncIterator[asyncpg.Connection]:
    """Function-scoped connection on a freshly-truncated DB.

    Re-seeds the canonical genre list so tests that filter by genre have a
    stable starting point.
    """
    conn = await asyncpg.connect(_migrated)
    try:
        await conn.execute("TRUNCATE " + ", ".join(ALL_TABLES) + " RESTART IDENTITY CASCADE")
        seed = (MIGRATIONS_DIR / "008_seed_genres.sql").read_text(encoding="utf-8")
        await conn.execute(seed)
        yield conn
    finally:
        await conn.close()


@pytest_asyncio.fixture
async def anon_conn(db: asyncpg.Connection, _migrated: str) -> AsyncIterator[asyncpg.Connection]:
    """A fresh connection authenticated *as* the dedicated non-superuser login
    role (ANON_LOGIN_ROLE), for RLS tests.

    This connects with the login role's own DSN rather than doing `SET ROLE anon`
    on a superuser connection -- the latter leaked superuser/role state across
    the reused testcontainer and caused the recurring `test_rls_anon` flake. The
    login role inherits `anon`'s privileges via role membership, so RLS policies
    and GRANTs that target `anon` apply, while it is genuinely not a superuser and
    does not bypass RLS.

    The `db` fixture is requested only to ensure truncation happens first; the
    anon connection itself is separate.
    """
    conn = await asyncpg.connect(_anon_login_dsn(_migrated))
    try:
        # Prove we're really testing anon-level privileges: a non-superuser
        # login role, not superuser-with-SET-ROLE. If this ever regressed to a
        # superuser session the RLS denial assertions would silently pass for
        # the wrong reason (superuser bypasses every check).
        ident = await conn.fetchrow(
            "SELECT session_user, current_user, "
            "(SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super, "
            "(SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls"
        )
        assert ident is not None
        assert ident["session_user"] == ANON_LOGIN_ROLE, (
            f"anon_conn must authenticate as {ANON_LOGIN_ROLE}, got {ident['session_user']}"
        )
        assert ident["current_user"] == ANON_LOGIN_ROLE
        assert ident["is_super"] is False, "anon_conn must NOT be a superuser"
        assert ident["bypass_rls"] is False, "anon_conn must NOT bypass RLS"
        yield conn
    finally:
        await conn.close()


@pytest_asyncio.fixture
async def pool(_migrated: str) -> AsyncIterator[asyncpg.Pool]:
    """Connection pool for concurrent-call tests (e.g. the buzz_in race)."""
    pool = await asyncpg.create_pool(_migrated, min_size=10, max_size=20)
    try:
        yield pool
    finally:
        await pool.close()
