"""POST /games; game creation and code generation."""

from __future__ import annotations

import re
import uuid

import pytest

from ._helpers import fetch_genre_ids

pytestmark = pytest.mark.needs_docker

GAME_CODE_RE = re.compile(r"^[A-HJ-NP-Z2-9]{6}$")


async def test_happy_path(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={"total_rounds": 5, "selected_genres": [str(genres[0])]},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert GAME_CODE_RE.match(body["game_code"]) is not None
    assert body["status"] == "waiting"
    assert body["total_rounds"] == 5
    assert "started_at" in body
    assert "expires_at" in body
    # The host's manager token is returned in the body so the browser can
    # store it and present it on subsequent manager-only endpoints.
    assert "manager_token" in body
    uuid.UUID(body["manager_token"])


async def test_validation_requires_genres(client) -> None:
    resp = await client.post(
        "/games", json={"total_rounds": 5, "selected_genres": []}
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "validation_error"


async def test_total_rounds_out_of_range(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={"total_rounds": 99, "selected_genres": [str(genres[0])]},
    )
    assert resp.status_code == 400


async def test_default_total_rounds(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games", json={"selected_genres": [str(genres[0])]}
    )
    assert resp.status_code == 201
    assert resp.json()["total_rounds"] == 10


async def test_unique_token_per_game(client, db) -> None:
    """Each game's manager_token is independently random."""
    genres = await fetch_genre_ids(db, slugs=["rock"])
    payload = {"total_rounds": 3, "selected_genres": [str(genres[0])]}
    r1 = await client.post("/games", json=payload)
    r2 = await client.post("/games", json=payload)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["manager_token"] != r2.json()["manager_token"]


async def test_collision_retry(client, db, monkeypatch) -> None:
    """Force the first three generated codes to collide; the fourth wins."""
    from app.services import codes as codes_module

    real_gen = codes_module.generate_code
    seen_first = {"count": 0}

    # Pre-seed an active_games row that will collide with our forced code.
    forced = "BENCHX"
    await db.execute(
        """
        INSERT INTO active_games (game_code, status, total_rounds, expires_at)
        VALUES ($1, 'waiting', 5, now() + interval '4 hours')
        """,
        forced,
    )

    def fake_gen() -> str:
        seen_first["count"] += 1
        if seen_first["count"] <= 2:
            return forced  # collision
        return real_gen()

    monkeypatch.setattr(codes_module, "generate_code", fake_gen)

    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={"total_rounds": 5, "selected_genres": [str(genres[0])]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["game_code"] != forced
    assert seen_first["count"] >= 3
