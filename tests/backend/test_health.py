"""GET /health; liveness + Supabase reachability."""

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
    """``SENTRY_DSN_BACKEND`` is unset in tests; no SDK init."""
    import sentry_sdk

    client_obj = getattr(sentry_sdk.Hub.current, "client", None)
    assert client_obj is None or getattr(client_obj, "dsn", None) is None


async def test_health_supabase_degraded_on_failure(client, monkeypatch) -> None:
    """If the probe raises, ``supabase`` flips to ``"degraded"`` (still 200)."""
    from app.db import supabase_client as supabase_module

    def raising_probe() -> None:
        raise RuntimeError("simulated supabase outage")

    monkeypatch.setattr(supabase_module, "_probe", raising_probe)
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["supabase"] == "degraded"


def test_sentry_install_calls_init_when_dsn_set(monkeypatch) -> None:
    """Verify the production install path actually calls sentry_sdk.init."""
    import sys

    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setenv("SENTRY_DSN_BACKEND", "https://example@sentry.test/1")

    from app import config as config_module

    config_module.get_settings.cache_clear()

    captured: dict[str, object] = {}

    def fake_init(**kwargs: object) -> None:
        captured.update(kwargs)

    fake_module = type(sys)("sentry_sdk")
    fake_module.init = fake_init  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake_module)

    from app.middleware import sentry as sentry_module

    sentry_module.install()
    assert captured.get("dsn") == "https://example@sentry.test/1"

    config_module.get_settings.cache_clear()
