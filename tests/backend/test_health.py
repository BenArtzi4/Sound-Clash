"""GET /health — liveness + Supabase reachability."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.needs_docker


async def test_health_ok(client) -> None:
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert body["supabase"] in {"ok", "degraded"}


async def test_health_supabase_ok_against_fake(client) -> None:
    """The fake supabase client serves the genres probe successfully."""
    resp = await client.get("/health")
    assert resp.json()["supabase"] == "ok"


async def test_sentry_not_initialised_in_tests() -> None:
    """``SENTRY_DSN_BACKEND`` is unset in tests — no SDK init."""
    import sentry_sdk

    client_obj = getattr(sentry_sdk.Hub.current, "client", None)
    assert client_obj is None or getattr(client_obj, "dsn", None) is None
