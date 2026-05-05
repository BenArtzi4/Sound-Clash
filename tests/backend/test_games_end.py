"""POST /games/{code}/end — manager closes the game."""

from __future__ import annotations

import pytest

from ._helpers import insert_game

pytestmark = pytest.mark.needs_docker


async def test_happy_path(admin_client, db) -> None:
    code = await insert_game(db, status="playing")
    resp = await admin_client.post(f"/games/{code}/end")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ended"
    assert body["ended_at"]


async def test_already_ended_409(admin_client, db) -> None:
    code = await insert_game(db, status="ended")
    resp = await admin_client.post(f"/games/{code}/end")
    assert resp.status_code == 409


async def test_not_found_404(admin_client) -> None:
    resp = await admin_client.post("/games/AAAAAA/end")
    assert resp.status_code == 404


async def test_admin_required(client, db) -> None:
    code = await insert_game(db, status="playing")
    resp = await client.post(f"/games/{code}/end")
    assert resp.status_code == 401
