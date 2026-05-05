"""slowapi rate limiter, configured to emit our error envelope on 429."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],
)


def _rate_limit_handler(request: Request, exc: Exception) -> JSONResponse:
    detail = getattr(exc, "detail", None) if isinstance(exc, RateLimitExceeded) else None
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limited",
            "message": "rate limit exceeded",
            "details": {"limit": detail} if detail else None,
        },
    )


def install(app: FastAPI) -> None:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)


def reset() -> None:
    """Clear the in-memory storage. Tests use this between cases."""
    limiter.reset()
