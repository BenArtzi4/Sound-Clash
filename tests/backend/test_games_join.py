"""POST /games/{code}/teams; public team join."""

from __future__ import annotations

import pytest

from ._helpers import fetch_genre_ids, insert_game

pytestmark = pytest.mark.needs_docker


async def test_happy_path(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    code, _ = await insert_game(db, status="waiting", selected_genres=genres)
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


async def test_same_name_reclaims_existing_team(client, db) -> None:
    # T5.7 / F-P2-1: rejoining a game with the same team name returns the
    # existing team (same id, preserved score) instead of a 409 or a duplicate
    # row. This is the "player refreshed / lost their tab" recovery path.
    code, _ = await insert_game(db, status="waiting")
    r1 = await client.post(f"/games/{code}/teams", json={"name": "Alpha"})
    assert r1.status_code == 201
    first = r1.json()

    # Simulate the team having accumulated a score before the rejoin.
    await db.execute(
        "UPDATE game_teams SET score = 42 WHERE id = $1", first["id"]
    )

    r2 = await client.post(f"/games/{code}/teams", json={"name": "Alpha"})
    assert r2.status_code == 201
    second = r2.json()

    # Same team reclaimed: identical id, the accumulated score preserved.
    assert second["id"] == first["id"]
    assert second["score"] == 42

    # No duplicate row was created.
    count = await db.fetchval(
        "SELECT count(*) FROM game_teams WHERE game_code = $1 AND name = $2",
        code,
        "Alpha",
    )
    assert count == 1


async def test_different_name_still_creates_new_team(client, db) -> None:
    code, _ = await insert_game(db, status="waiting")
    r1 = await client.post(f"/games/{code}/teams", json={"name": "Alpha"})
    assert r1.status_code == 201
    r2 = await client.post(f"/games/{code}/teams", json={"name": "Bravo"})
    assert r2.status_code == 201
    assert r2.json()["id"] != r1.json()["id"]

    count = await db.fetchval(
        "SELECT count(*) FROM game_teams WHERE game_code = $1", code
    )
    assert count == 2


async def test_ended_game_returns_410(client, db) -> None:
    code, _ = await insert_game(db, status="ended")
    resp = await client.post(f"/games/{code}/teams", json={"name": "TooLate"})
    assert resp.status_code == 410
    assert resp.json()["error"] == "gone"


async def test_expired_but_unswept_game_returns_410(client, db) -> None:
    # cleanup_expired_games sweeps only hourly, so a game can be past its 4h TTL
    # while its row still exists with status!='ended'. Joining must still 410.
    code, _ = await insert_game(db, status="playing", expires_in_hours=-1)
    resp = await client.post(f"/games/{code}/teams", json={"name": "TooLate"})
    assert resp.status_code == 410
    assert resp.json()["error"] == "gone"


async def test_team_name_trimmed_and_validated(client, db) -> None:
    code, _ = await insert_game(db, status="waiting")
    too_long = "A" * 31
    resp = await client.post(f"/games/{code}/teams", json={"name": too_long})
    assert resp.status_code == 400
