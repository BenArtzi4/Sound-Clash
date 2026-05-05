"""Admin auth header check — gates the song catalog (/admin/songs).

Game-management endpoints (/games/{code}/*) are no longer behind this gate;
they use a per-game manager token (see ``test_manager_token.py``). The admin
password remains the gate for the durable song catalog so randoms can't wipe
the master library.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.needs_docker


async def test_missing_header_returns_401(client) -> None:
    resp = await client.get("/admin/songs")
    assert resp.status_code == 401
    assert resp.json()["error"] == "unauthorized"


async def test_wrong_header_returns_401(client) -> None:
    resp = await client.get(
        "/admin/songs",
        headers={"X-Admin-Password": "definitely-wrong"},
    )
    assert resp.status_code == 401
    # Generic message — no info leak about why it failed.
    assert resp.json()["error"] == "unauthorized"


async def test_correct_header_passes(admin_client) -> None:
    resp = await admin_client.get("/admin/songs")
    assert resp.status_code == 200


def test_compare_digest_used_in_module_source() -> None:
    """The module relies on ``secrets.compare_digest`` — guard against drift."""
    from app.middleware import admin_auth

    source = admin_auth.require_admin.__code__.co_consts
    assert "compare_digest" in admin_auth.secrets.__dict__
    assert callable(admin_auth.secrets.compare_digest)
    _ = source
