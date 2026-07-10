"""Bulk-import upload size cap (F-P2-6).

Over-cap uploads must be refused with HTTP 413 *before* the CSV is parsed or
any DB call is made. These tests run without Docker: the app is built with a
stub supabase client whose ``table()`` raises, so a request that reaches the
DB fails loudly — proving the 413 short-circuit happens first.
"""

from __future__ import annotations

import importlib
import io
import os
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
import pytest_asyncio

ADMIN_PASSWORD = "test-admin-pw"


class _NoDBClient:
    """Supabase-shaped stub that refuses any DB access."""

    def table(self, name: str) -> Any:  # pragma: no cover - must never be hit
        raise AssertionError(f"DB was touched (table={name!r}); 413 should short-circuit first")

    def rpc(self, name: str, params: dict[str, Any] | None = None) -> Any:  # pragma: no cover
        raise AssertionError(f"DB was touched (rpc={name!r}); 413 should short-circuit first")


@pytest.fixture
def _env() -> Iterator[None]:
    previous = {
        key: os.environ.get(key)
        for key in ("ADMIN_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CORS_ORIGINS")
    }
    os.environ["ADMIN_PASSWORD"] = ADMIN_PASSWORD
    os.environ["SUPABASE_URL"] = "http://stub-supabase.test"
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "stub-key"
    os.environ["CORS_ORIGINS"] = "http://test"
    yield
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


@pytest.fixture
def nodb_app(_env: None) -> Iterator[Any]:
    """Build the app wired to a no-DB stub client.

    Uses distinct fixture names (``nodb_app`` / ``nodb_admin_client``) so this
    module never shadows the DB-backed fixtures in ``conftest.py``, and it
    saves/restores the prior client factory so running this module before a
    DB-backed module can't leak the stub into it.
    """
    from app import config as config_module
    from app.db import supabase_client as supabase_module

    previous_factory = supabase_module._factory
    config_module.get_settings.cache_clear()
    supabase_module.set_supabase_client_factory(_NoDBClient)

    import app.main as main_module

    main_module = importlib.reload(main_module)
    try:
        yield main_module.app
    finally:
        supabase_module.set_supabase_client_factory(previous_factory)


@pytest_asyncio.fixture
async def nodb_admin_client(nodb_app: Any) -> AsyncIterator[Any]:
    from httpx import ASGITransport, AsyncClient

    from app.middleware import rate_limit

    rate_limit.reset()
    transport = ASGITransport(app=nodb_app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"X-Admin-Password": ADMIN_PASSWORD},
    ) as c:
        yield c
    rate_limit.reset()


def _oversized_csv() -> bytes:
    from app.routers.admin_songs import MAX_IMPORT_BYTES

    header = b"title,artist,youtube_id,start_time,genres\n"
    filler = b"x" * (MAX_IMPORT_BYTES + 1024)
    return header + filler


async def test_over_cap_returns_413_and_skips_db(nodb_admin_client) -> None:
    resp = await nodb_admin_client.post(
        "/admin/songs/bulk-import",
        files={"file": ("big.csv", io.BytesIO(_oversized_csv()), "text/csv")},
    )
    assert resp.status_code == 413, resp.text
    body = resp.json()
    assert body["error"] == "payload_too_large"
    # _NoDBClient.table would have raised (→ 500) if the DB were reached.


async def test_lying_content_length_still_capped(nodb_admin_client) -> None:
    """A too-small declared Content-Length can't smuggle an oversized body past
    the streamed read backstop."""
    payload = _oversized_csv()
    resp = await nodb_admin_client.post(
        "/admin/songs/bulk-import",
        files={"file": ("big.csv", io.BytesIO(payload), "text/csv")},
        headers={"Content-Length": "10"},
    )
    assert resp.status_code == 413, resp.text
    assert resp.json()["error"] == "payload_too_large"
