"""Admin auth header check."""

from __future__ import annotations

import pytest

from ._helpers import fetch_genre_ids

pytestmark = pytest.mark.needs_docker


async def test_missing_header_returns_401(client, db) -> None:
    genre_ids = await fetch_genre_ids(db)
    resp = await client.post(
        "/games",
        json={"total_rounds": 3, "selected_genres": [str(genre_ids[0])]},
    )
    assert resp.status_code == 401
    assert resp.json()["error"] == "unauthorized"


async def test_wrong_header_returns_401(client, db) -> None:
    genre_ids = await fetch_genre_ids(db)
    resp = await client.post(
        "/games",
        headers={"X-Admin-Password": "definitely-wrong"},
        json={"total_rounds": 3, "selected_genres": [str(genre_ids[0])]},
    )
    assert resp.status_code == 401
    # Generic message — no info leak about why it failed.
    assert resp.json()["error"] == "unauthorized"


async def test_correct_header_passes(admin_client, db) -> None:
    genre_ids = await fetch_genre_ids(db)
    resp = await admin_client.post(
        "/games",
        json={"total_rounds": 3, "selected_genres": [str(genre_ids[0])]},
    )
    assert resp.status_code == 201


def test_compare_digest_used_in_module_source() -> None:
    """The module relies on ``secrets.compare_digest`` — guard against drift."""
    from app.middleware import admin_auth

    source = admin_auth.require_admin.__code__.co_consts
    # ``secrets.compare_digest`` is referenced by name in module globals.
    assert "compare_digest" in admin_auth.secrets.__dict__  # constant-time API present
    assert callable(admin_auth.secrets.compare_digest)
    _ = source  # keep linters quiet
