"""Security headers stamped on every API response (``cors._security_headers``).

Middleware-level: a bare FastAPI app with only ``cors.install`` on it, driven
through httpx. No DB, no routers, so it runs without Docker.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI, Response

from app.middleware import cors as cors_module


def _build_app() -> FastAPI:
    app = FastAPI()
    cors_module.install(app)

    @app.get("/probe")
    async def probe() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/indexable")
    async def indexable() -> Response:
        # A route that sets its own value must keep it (setdefault).
        return Response("ok", headers={"X-Robots-Tag": "all"})

    return app


async def _get(path: str) -> httpx.Response:
    transport = httpx.ASGITransport(app=_build_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        return await c.get(path)


@pytest.mark.asyncio
async def test_security_headers_on_a_normal_response() -> None:
    resp = await _get("/probe")

    assert resp.status_code == 200
    assert resp.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"
    assert resp.headers["x-content-type-options"] == "nosniff"
    # The API (and its /docs page) must stay out of search results.
    assert resp.headers["x-robots-tag"] == "noindex"


@pytest.mark.asyncio
async def test_noindex_does_not_override_a_route_value() -> None:
    resp = await _get("/indexable")

    assert resp.headers["x-robots-tag"] == "all"
