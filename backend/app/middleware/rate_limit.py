"""slowapi rate limiter, configured to emit our error envelope on 429."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address


def client_ip(request: Request) -> str:
    """Rate-limit key: the real client IP, spoof-resistant behind Render.

    ``get_remote_address`` alone returns ``request.client.host``, which behind
    Render's proxy is the *proxy* IP — so every client collapses into one shared
    bucket (F-P2-5: a busy party could trip a per-IP limit on legitimate joins,
    and an abuser is indistinguishable from the crowd).

    Render fronts every service with Cloudflare, which sets ``CF-Connecting-IP``
    to the true client IP and **overwrites** any client-supplied value, so it
    cannot be forged. ``X-Forwarded-For`` is *not* trustworthy for this: Render
    only appends to it, so a client can prepend a fake leftmost entry. Prefer
    ``CF-Connecting-IP``; fall back to the **rightmost** XFF hop (the address the
    nearest trusted proxy appended) and finally the socket peer for local/dev
    where no edge is present.
    """
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return get_remote_address(request)


limiter = Limiter(
    key_func=client_ip,
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
