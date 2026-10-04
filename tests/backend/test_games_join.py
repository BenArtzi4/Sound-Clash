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


async def test_same_name_is_rejected_not_merged(client, db) -> None:
    # Game XSU8WK (2026-10-02): a second team typed a name that was already
    # playing and was silently handed the first team's row, so two teams shared
    # one score. A taken name is now a 409; it never returns the existing team.
    # A team that really lost its device rejoins via the host's rescue QR
    # (POST /games/{code}/rejoin) or its own browser's stored identity.
    code, _ = await insert_game(db, status="waiting")
    r1 = await client.post(f"/games/{code}/teams", json={"name": "Alpha"})
    assert r1.status_code == 201
    first = r1.json()
    await db.execute("UPDATE game_teams SET score = 42 WHERE id = $1", first["id"])

    r2 = await client.post(f"/games/{code}/teams", json={"name": "Alpha"})
    assert r2.status_code == 409
    assert r2.json()["error"] == "conflict"
    assert "id" not in r2.json()

    rows = await db.fetch("SELECT id, score FROM game_teams WHERE game_code = $1", code)
    assert [(str(r["id"]), r["score"]) for r in rows] == [(first["id"], 42)]


@pytest.mark.parametrize(
    ("taken", "attempt"),
    [
        ("Ofra Fans", "ofra fans"),
        ("Ofra Fans", "OFRA FANS"),
        ("Ofra Fans", "Ofra   Fans"),
        ("Ofra Fans", "  ofra fans  "),
        ("מעריצי ירדנה", "מעריצי  ירדנה"),
        ("Ｂｅａｔｌｅｓ", "beatles"),
    ],
)
async def test_name_match_ignores_case_and_spacing(client, db, taken, attempt) -> None:
    # Names that differ only in letter case, runs of spaces, or full-width
    # forms read as the same team on the projector, so they count as taken.
    code, _ = await insert_game(db, status="waiting")
    assert (await client.post(f"/games/{code}/teams", json={"name": taken})).status_code == 201

    resp = await client.post(f"/games/{code}/teams", json={"name": attempt})
    assert resp.status_code == 409
    assert await db.fetchval("SELECT count(*) FROM game_teams WHERE game_code = $1", code) == 1


async def test_same_name_in_another_game_is_fine(client, db) -> None:
    code_a, _ = await insert_game(db, status="waiting")
    code_b, _ = await insert_game(db, status="waiting")
    ra = await client.post(f"/games/{code_a}/teams", json={"name": "Alpha"})
    rb = await client.post(f"/games/{code_b}/teams", json={"name": "Alpha"})
    assert ra.status_code == 201
    assert rb.status_code == 201
    assert ra.json()["id"] != rb.json()["id"]


async def test_name_is_free_again_after_its_team_is_kicked(client, db) -> None:
    code, _ = await insert_game(db, status="waiting")
    first = (await client.post(f"/games/{code}/teams", json={"name": "Alpha"})).json()
    await db.execute("DELETE FROM game_teams WHERE id = $1", first["id"])

    resp = await client.post(f"/games/{code}/teams", json={"name": "alpha"})
    assert resp.status_code == 201
    assert resp.json()["id"] != first["id"]


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
