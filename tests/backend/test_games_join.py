"""POST /games/{code}/teams — public team join."""

from __future__ import annotations

import pytest

from ._helpers import fetch_genre_ids, insert_game

pytestmark = pytest.mark.needs_docker


async def test_happy_path(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    code = await insert_game(db, status="waiting", selected_genres=genres)
    resp = await client.post(f"/games/{code}/teams", json={"name": "Avengers"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "Avengers"
    assert body["score"] == 0
    assert body["game_code"] == code


async def test_not_found(client) -> None:
    resp = await client.post("/games/AAAAAA/teams", json={"name": "Ghosts"})
    assert resp.status_code == 404
    assert resp.json()["error"] == "not_found"


async def test_duplicate_name_is_conflict(client, db) -> None:
    code = await insert_game(db, status="waiting")
    r1 = await client.post(f"/games/{code}/teams", json={"name": "Same"})
    assert r1.status_code == 201
    r2 = await client.post(f"/games/{code}/teams", json={"name": "Same"})
    assert r2.status_code == 409
    assert r2.json()["error"] == "conflict"


async def test_ended_game_returns_410(client, db) -> None:
    code = await insert_game(db, status="ended")
    resp = await client.post(f"/games/{code}/teams", json={"name": "TooLate"})
    assert resp.status_code == 410
    assert resp.json()["error"] == "gone"


async def test_team_name_trimmed_and_validated(client, db) -> None:
    code = await insert_game(db, status="waiting")
    too_long = "A" * 31
    resp = await client.post(f"/games/{code}/teams", json={"name": too_long})
    assert resp.status_code == 400
