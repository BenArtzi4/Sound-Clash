"""FastAPI app entry point.

Wires middleware (CORS, security headers, rate limit, error handlers,
optional Sentry), then mounts the four routers per ``docs/api-contracts.md``.
"""

from __future__ import annotations

from fastapi import FastAPI

from app import __version__
from app.middleware import cors as cors_module
from app.middleware import error_handler, otel, sentry
from app.middleware import rate_limit as rate_limit_module
from app.routers import admin_songs, games, genres, health


def create_app() -> FastAPI:
    sentry.install()
    app = FastAPI(title="Sound Clash API", version=__version__)
    rate_limit_module.install(app)
    error_handler.install(app)
    cors_module.install(app)

    app.include_router(health.router)
    app.include_router(genres.router)
    app.include_router(games.router)
    app.include_router(admin_songs.router)

    # Opt-in OpenTelemetry tracing; no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is
    # set. Instrument after routers so all routes are wrapped.
    otel.install(app)
    return app


app = create_app()
