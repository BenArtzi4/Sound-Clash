"""POST /games/{code}/end — manager closes the game."""

from __future__ import annotations

import pytest

from ._helpers import insert_game, manager_headers

pytestmark = pytest.mark.needs_docker


async def test_happy_path(client, db) -> None:
    code, token = await insert_game(db, status="playing")
    resp = await client.post(f"/games/{code}/end", headers=manager_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ended"
    assert body["ended_at"]


async def test_already_ended_409(client, db) -> None:
    code, token = await insert_game(db, status="ended")
    resp = await client.post(f"/games/{code}/end", headers=manager_headers(token))
    # insert_game leaves ended_at NULL even when status='ended', so the
    # manager-token check passes and the RPC returns 409 from P0001.
    assert resp.status_code == 409


async def test_not_found_404(client) -> None:
    resp = await client.post(
        "/games/AAAAAA/end",
        headers=manager_headers("00000000-0000-0000-0000-000000000000"),
    )
    assert resp.status_code == 404


async def test_manager_token_required(client, db) -> None:
    code, _ = await insert_game(db, status="playing")
    resp = await client.post(f"/games/{code}/end")
    assert resp.status_code == 401
