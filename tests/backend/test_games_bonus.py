"""POST /games/{code}/bonus; host-discretion bonus to a chosen team."""

from __future__ import annotations

import pytest

from ._helpers import (
    fetch_genre_ids,
    insert_game,
    insert_team,
    manager_headers,
)

pytestmark = pytest.mark.needs_docker


async def test_bonus_default_4_points(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    team_id = await insert_team(db, code, name="Alice")

    resp = await client.post(
        f"/games/{code}/bonus",
        json={"team_id": str(team_id)},
        headers=manager_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["team_id"] == str(team_id)
    assert body["points_awarded"] == 4
    assert body["team_total_score"] == 4


async def test_bonus_accepts_custom_points(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    team_id = await insert_team(db, code, name="Alice")

    resp = await client.post(
        f"/games/{code}/bonus",
        json={"team_id": str(team_id), "points": 7},
        headers=manager_headers(token),
    )
    assert resp.status_code == 200
    assert resp.json()["points_awarded"] == 7
    assert resp.json()["team_total_score"] == 7


async def test_bonus_accumulates_across_calls(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    team_id = await insert_team(db, code, name="Alice")
    headers = manager_headers(token)

    for _ in range(3):
        resp = await client.post(
            f"/games/{code}/bonus",
            json={"team_id": str(team_id)},
            headers=headers,
        )
        assert resp.status_code == 200
    final = await client.post(
        f"/games/{code}/bonus", json={"team_id": str(team_id)}, headers=headers
    )
    assert final.json()["team_total_score"] == 16  # 4 * 4


async def test_bonus_rejects_zero_points(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    team_id = await insert_team(db, code, name="Alice")
    resp = await client.post(
        f"/games/{code}/bonus",
        json={"team_id": str(team_id), "points": 0},
        headers=manager_headers(token),
    )
    assert resp.status_code == 400  # request_validation_error_handler maps to 400
    assert resp.json()["error"] == "validation_error"


async def test_bonus_team_must_be_in_game(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code_a, token_a = await insert_game(db, status="playing", selected_genres=rock)
    code_b, _ = await insert_game(db, status="playing", selected_genres=rock)
    team_in_b = await insert_team(db, code_b, name="Bob")
    resp = await client.post(
        f"/games/{code_a}/bonus",
        json={"team_id": str(team_in_b)},
        headers=manager_headers(token_a),
    )
    assert resp.status_code == 404


async def test_bonus_requires_manager_token(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, _ = await insert_game(db, status="playing", selected_genres=rock)
    team_id = await insert_team(db, code, name="Alice")
    resp = await client.post(
        f"/games/{code}/bonus",
        json={"team_id": str(team_id)},
    )
    assert resp.status_code == 401
