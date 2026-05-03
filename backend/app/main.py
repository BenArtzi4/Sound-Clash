"""FastAPI app entry point.

Phase 1 placeholder: only /health is implemented.
Routers, middleware, and Sentry integration are added in Phase 4.
See docs/api-contracts.md.
"""

from __future__ import annotations

from fastapi import FastAPI

from app import __version__

app = FastAPI(title="Sound Clash API", version=__version__)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe."""
    return {"status": "ok", "version": __version__}
