"""slowapi rate limits; exceed window → 429."""

from __future__ import annotations

import pytest

from ._helpers import fetch_genre_ids

pytestmark = pytest.mark.needs_docker


async def test_create_game_limit_10_per_minute(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    payload = {"selected_genres": [str(genres[0])]}

    statuses: list[int] = []
    for _ in range(11):
        resp = await client.post("/games", json=payload)
        statuses.append(resp.status_code)

    # Exactly 10 successes, one 429.
    assert statuses.count(201) == 10
    assert statuses.count(429) == 1
    last = statuses[-1]
    assert last == 429


async def test_429_envelope_shape(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    payload = {"selected_genres": [str(genres[0])]}
    last_resp = None
    for _ in range(11):
        last_resp = await client.post("/games", json=payload)
    assert last_resp is not None
    assert last_resp.status_code == 429
    body = last_resp.json()
    assert body["error"] == "rate_limited"
    assert "message" in body
