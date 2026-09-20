"""CORS_ORIGIN_REGEX: allow per-PR Cloudflare Pages preview origins.

The exact-match ``cors_origins`` allowlist can't cover preview deployments,
whose hostname carries the PR number (``pr-317.sound-clash.pages.dev``). An
optional regex closes that gap without widening anything by default: unset,
``allow_origin_regex`` is ``None`` and the middleware behaves exactly as it
did before.

These are middleware-level tests — a bare FastAPI app with only
``cors.install`` on it, driven through httpx. No DB, no routers.
"""

from __future__ import annotations

import importlib
import os
from collections.abc import AsyncIterator, Iterator

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app import config as config_module
from app.middleware import cors as cors_module

# The value intended for the Render env var. Anchored at both ends so a
# lookalike host (…pages.dev.evil.com) cannot match.
PREVIEW_REGEX = r"^https://[a-z0-9][a-z0-9-]*\.sound-clash\.pages\.dev$"

PREVIEW_ORIGIN = "https://pr-317.sound-clash.pages.dev"
PROD_ORIGIN = "https://soundclash.org"


@pytest.fixture
def _clean_settings() -> Iterator[None]:
    """Let a test set CORS_ORIGIN_REGEX and see it honoured."""
    previous = os.environ.get("CORS_ORIGIN_REGEX")
    config_module.get_settings.cache_clear()
    yield
    if previous is None:
        os.environ.pop("CORS_ORIGIN_REGEX", None)
    else:
        os.environ["CORS_ORIGIN_REGEX"] = previous
    config_module.get_settings.cache_clear()


def _build_app() -> FastAPI:
    """A minimal app carrying only the CORS middleware under test."""
    app = FastAPI()
    cors_module.install(app)

    @app.get("/probe")
    async def probe() -> dict[str, bool]:
        return {"ok": True}

    return app


@pytest_asyncio.fixture
async def cors_client() -> AsyncIterator[AsyncClient]:
    importlib.reload(cors_module)
    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# --------------------------------------------------------------------------
# Settings parsing
# --------------------------------------------------------------------------


def test_regex_unset_is_none(_clean_settings: None) -> None:
    os.environ.pop("CORS_ORIGIN_REGEX", None)
    config_module.get_settings.cache_clear()
    assert config_module.get_settings().cors_origin_regex is None


def test_regex_blank_is_none(_clean_settings: None) -> None:
    os.environ["CORS_ORIGIN_REGEX"] = "   "
    config_module.get_settings.cache_clear()
    assert config_module.get_settings().cors_origin_regex is None


def test_regex_read_from_env(_clean_settings: None) -> None:
    os.environ["CORS_ORIGIN_REGEX"] = PREVIEW_REGEX
    config_module.get_settings.cache_clear()
    assert config_module.get_settings().cors_origin_regex == PREVIEW_REGEX


# --------------------------------------------------------------------------
# Middleware behaviour
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_origin_rejected_when_regex_unset(
    _clean_settings: None,
) -> None:
    """Default posture is unchanged: a preview origin gets no CORS grant."""
    os.environ.pop("CORS_ORIGIN_REGEX", None)
    config_module.get_settings.cache_clear()

    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/probe", headers={"Origin": PREVIEW_ORIGIN})

    assert "access-control-allow-origin" not in resp.headers


@pytest.mark.asyncio
async def test_preview_origin_allowed_when_regex_set(_clean_settings: None) -> None:
    os.environ["CORS_ORIGIN_REGEX"] = PREVIEW_REGEX
    config_module.get_settings.cache_clear()

    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/probe", headers={"Origin": PREVIEW_ORIGIN})

    assert resp.headers["access-control-allow-origin"] == PREVIEW_ORIGIN


@pytest.mark.asyncio
async def test_preview_preflight_allows_manager_token(_clean_settings: None) -> None:
    """The host-only endpoints send X-Manager-Token, so preflight must pass."""
    os.environ["CORS_ORIGIN_REGEX"] = PREVIEW_REGEX
    config_module.get_settings.cache_clear()

    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.options(
            "/probe",
            headers={
                "Origin": PREVIEW_ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "X-Manager-Token",
            },
        )

    assert resp.status_code == 200
    assert resp.headers["access-control-allow-origin"] == PREVIEW_ORIGIN
    assert "x-manager-token" in resp.headers["access-control-allow-headers"].lower()


@pytest.mark.asyncio
async def test_listed_origin_still_allowed_with_regex_set(
    _clean_settings: None,
) -> None:
    """Adding the regex must not disturb the exact-match allowlist."""
    os.environ["CORS_ORIGIN_REGEX"] = PREVIEW_REGEX
    config_module.get_settings.cache_clear()

    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/probe", headers={"Origin": PROD_ORIGIN})

    assert resp.headers["access-control-allow-origin"] == PROD_ORIGIN


@pytest.mark.parametrize(
    "origin",
    [
        # Suffix attack: the anchor is what stops this.
        "https://pr-1.sound-clash.pages.dev.evil.example",
        # Prefix attack.
        "https://evil.example/pr-1.sound-clash.pages.dev",
        # A different Pages project on the same shared domain.
        "https://pr-1.someone-elses-project.pages.dev",
        # Plaintext.
        "http://pr-1.sound-clash.pages.dev",
        # Nested subdomain.
        "https://a.b.sound-clash.pages.dev",
        # Unrelated origin.
        "https://evil.example",
    ],
)
@pytest.mark.asyncio
async def test_lookalike_origins_rejected(_clean_settings: None, origin: str) -> None:
    os.environ["CORS_ORIGIN_REGEX"] = PREVIEW_REGEX
    config_module.get_settings.cache_clear()

    transport = ASGITransport(app=_build_app())
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/probe", headers={"Origin": origin})

    assert "access-control-allow-origin" not in resp.headers
