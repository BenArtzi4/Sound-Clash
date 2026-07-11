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


async def test_rate_limit_buckets_per_client_ip(client, db) -> None:
    """F-P2-5: two distinct client IPs get independent buckets.

    The limiter keys on ``CF-Connecting-IP`` (the header Render/Cloudflare set
    to the real client). Exhausting one IP's window must not spend another's.
    (In prod Cloudflare overwrites a client-supplied CF-Connecting-IP; here the
    ASGI transport has no edge, so the header stands in for two real clients.)
    """
    genres = await fetch_genre_ids(db, slugs=["rock"])
    payload = {"selected_genres": [str(genres[0])]}

    # IP A exhausts its 10/min window.
    a_statuses = []
    for _ in range(11):
        resp = await client.post(
            "/games", json=payload, headers={"CF-Connecting-IP": "198.51.100.1"}
        )
        a_statuses.append(resp.status_code)
    assert a_statuses.count(201) == 10
    assert a_statuses[-1] == 429

    # IP B still has a full budget — its bucket is independent.
    b = await client.post(
        "/games", json=payload, headers={"CF-Connecting-IP": "198.51.100.2"}
    )
    assert b.status_code == 201
