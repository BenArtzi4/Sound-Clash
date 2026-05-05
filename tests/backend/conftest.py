"""Pytest fixtures for FastAPI/router tests.

Spins up the same testcontainer Postgres pattern as ``tests/db/conftest.py``
(re-implemented here since ``tests/`` is not a package and we can't import
the sibling conftest). Migrations are applied once per session, and each
test gets a freshly truncated DB plus a fake supabase client backed by
direct asyncpg.

Each test sees:
- ``db`` — fresh connection on a truncated DB (durable tables re-seeded).
- ``fake_supabase`` — supabase-py-shaped client backed by the same DSN.
- ``client`` — ``httpx.AsyncClient`` against the FastAPI app.
- ``admin_client`` — same, but with the admin password header baked in.
"""

from __future__ import annotations

import importlib
import os
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import asyncpg
import pytest
import pytest_asyncio

ADMIN_PASSWORD = "test-admin-pw"

ALL_TABLES = (
    "game_rounds",
    "game_teams",
    "active_games",
    "song_genres",
    "songs",
    "genres",
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
SEED_GENRES = MIGRATIONS_DIR / "008_seed_genres.sql"


def _read_migrations() -> list[tuple[str, str]]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    return [(f.name, f.read_text(encoding="utf-8")) for f in files]


@pytest.fixture(scope="session", autouse=True)
def _env_setup() -> Iterator[None]:
    """Set the env vars the FastAPI app reads at import time."""
    previous = {
        key: os.environ.get(key)
        for key in (
            "ADMIN_PASSWORD",
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "SENTRY_DSN_BACKEND",
            "CORS_ORIGINS",
        )
    }
    os.environ["ADMIN_PASSWORD"] = ADMIN_PASSWORD
    os.environ["SUPABASE_URL"] = "http://stub-supabase.test"
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "stub-key"
    os.environ.pop("SENTRY_DSN_BACKEND", None)
    os.environ["CORS_ORIGINS"] = "https://soundclash.org,http://localhost:5173,http://test"
    yield
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


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
    except ImportError as e:
        pytest.skip(f"testcontainers not available and DATABASE_URL not set: {e}")

    container = PostgresContainer("postgres:15")
    container.start()
    try:
        yield container.get_connection_url().replace(
            "postgresql+psycopg2://", "postgresql://"
        )
    finally:
        container.stop()


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _migrated(database_url: str) -> AsyncIterator[str]:
    """Apply every migration once per session."""
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
    """Function-scoped connection on a freshly-truncated DB."""
    conn = await asyncpg.connect(_migrated)
    try:
        await conn.execute(
            "TRUNCATE " + ", ".join(ALL_TABLES) + " RESTART IDENTITY CASCADE"
        )
        seed = SEED_GENRES.read_text(encoding="utf-8")
        await conn.execute(seed)
        yield conn
    finally:
        await conn.close()


@pytest.fixture
def fake_supabase(_migrated: str, db: asyncpg.Connection) -> Iterator[Any]:
    """Sync supabase-py-shaped client backed by the same testcontainer DSN."""
    from ._fake_supabase import FakeSupabaseClient

    fake = FakeSupabaseClient(_migrated)
    try:
        yield fake
    finally:
        fake.close()


@pytest.fixture
def app(fake_supabase: Any) -> Iterator[Any]:
    """Reload the FastAPI app with the fake client wired in."""
    from app import config as config_module
    from app.db import supabase_client as supabase_module

    config_module.get_settings.cache_clear()
    supabase_module.set_supabase_client_factory(lambda: fake_supabase)

    import app.main as main_module

    main_module = importlib.reload(main_module)

    yield main_module.app

    supabase_module.set_supabase_client_factory(None)


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncIterator[Any]:
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def admin_client(app: Any) -> AsyncIterator[Any]:
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"X-Admin-Password": ADMIN_PASSWORD},
    ) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> Iterator[None]:
    """Make rate-limit state independent across tests."""
    from app.middleware import rate_limit

    rate_limit.reset()
    yield
    rate_limit.reset()
