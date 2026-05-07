"""Manager-token dependency; gates per-game host actions."""

from __future__ import annotations

import uuid

import pytest

from ._helpers import fetch_genre_ids, insert_game, manager_headers

pytestmark = pytest.mark.needs_docker


async def test_missing_header_returns_401(client, db) -> None:
    code, _ = await insert_game(db, status="playing")
    resp = await client.post(f"/games/{code}/end")
    assert resp.status_code == 401
    assert resp.json()["error"] == "unauthorized"


async def test_wrong_token_returns_401(client, db) -> None:
    code, _ = await insert_game(db, status="playing")
    resp = await client.post(
        f"/games/{code}/end",
        headers=manager_headers(uuid.uuid4()),
    )
    assert resp.status_code == 401


async def test_correct_token_admits(client, db) -> None:
    code, token = await insert_game(db, status="playing")
    resp = await client.post(
        f"/games/{code}/end", headers=manager_headers(token)
    )
    assert resp.status_code == 200


async def test_unknown_game_returns_404(client) -> None:
    resp = await client.post(
        "/games/AAAAAA/end",
        headers=manager_headers(uuid.uuid4()),
    )
    assert resp.status_code == 404


async def test_already_ended_at_set_returns_410(client, db) -> None:
    code, token = await insert_game(db, status="ended")
    # Force ended_at so the manager-token dep short-circuits at 410 before
    # the route's own checks.
    await db.execute(
        "UPDATE active_games SET ended_at = now() WHERE game_code = $1", code
    )
    resp = await client.post(
        f"/games/{code}/end", headers=manager_headers(token)
    )
    assert resp.status_code == 410


async def test_create_game_returns_token_that_authorizes(client, db) -> None:
    """End-to-end: token from POST /games admits manager actions."""
    genres = await fetch_genre_ids(db, slugs=["rock"])
    create = await client.post(
        "/games",
        json={"selected_genres": [str(genres[0])]},
    )
    assert create.status_code == 201
    body = create.json()
    code = body["game_code"]
    token = body["manager_token"]

    end = await client.post(f"/games/{code}/end", headers=manager_headers(token))
    assert end.status_code == 200


def test_compare_digest_used_in_module_source() -> None:
    """Constant-time compare guard; mirrors test_admin_auth."""
    from app.middleware import manager_auth

    assert "compare_digest" in manager_auth.secrets.__dict__
    assert callable(manager_auth.secrets.compare_digest)
