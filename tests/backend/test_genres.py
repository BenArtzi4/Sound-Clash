"""GET /genres — public listing."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.needs_docker


async def test_returns_seeded_genres(client, db) -> None:
    resp = await client.get("/genres")
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list)
    assert len(rows) >= 5
    slugs = {row["slug"] for row in rows}
    assert "rock" in slugs


async def test_cache_control_header(client, db) -> None:
    resp = await client.get("/genres")
    assert resp.headers.get("cache-control") == "public, max-age=600"
