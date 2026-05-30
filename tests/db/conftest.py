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

import asyncpg
import pytest
import pytest_asyncio

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"

# Truncated between tests so each function starts clean. Durable tables
# (songs/genres/song_genres) are included so tests populate exactly what they need.
ALL_TABLES = (
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


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _migrated(database_url: str) -> AsyncIterator[str]:
    """Apply every migration once per session.

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
    """A fresh connection with `SET ROLE anon`, for RLS tests.

    The `db` fixture is requested only to ensure truncation happens first; the
    anon connection itself is separate.
    """
    conn = await asyncpg.connect(_migrated)
    try:
        await conn.execute("SET ROLE anon")
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
