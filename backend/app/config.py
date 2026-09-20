"""Runtime configuration loaded from environment variables.

Settings are read once via lru_cache so the app behaves like a singleton.
Tests override by setting env vars before the first call to ``get_settings``.

For local dev we also pick up ``backend/.env`` via python-dotenv. On Render,
env vars come from the platform and the .env load is a harmless no-op.
``override=False`` ensures values already set by the OS or test fixtures win.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_FILE, override=False)


@dataclass(frozen=True)
class Settings:
    admin_password: str
    supabase_url: str
    supabase_service_role_key: str
    sentry_dsn_backend: str | None = None
    log_level: str = "INFO"
    cors_origins: list[str] = field(
        default_factory=lambda: [
            "https://soundclash.org",
            "https://www.soundclash.org",
            "http://localhost:5173",
        ]
    )
    # Optional regex allowing origins the exact-match list above can't name,
    # because the hostname varies per deployment. Set on Render to admit the
    # per-PR Cloudflare Pages previews:
    #   ^https://[a-z0-9][a-z0-9-]*\.sound-clash\.pages\.dev$
    # Left unset (the default) the middleware gets allow_origin_regex=None and
    # behaves exactly as it did before this field existed. Anchor both ends of
    # any value you set; an unanchored pattern would match a lookalike host.
    cors_origin_regex: str | None = None


def _split_csv(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [item.strip() for item in value.split(",") if item.strip()]


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Required environment variable {name} is not set")
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    cors = _split_csv(os.environ.get("CORS_ORIGINS"))
    kwargs: dict[str, object] = {
        "admin_password": _required("ADMIN_PASSWORD"),
        "supabase_url": _required("SUPABASE_URL"),
        "supabase_service_role_key": _required("SUPABASE_SERVICE_ROLE_KEY"),
        "sentry_dsn_backend": os.environ.get("SENTRY_DSN_BACKEND") or None,
        "log_level": os.environ.get("LOG_LEVEL", "INFO"),
        "cors_origin_regex": (os.environ.get("CORS_ORIGIN_REGEX") or "").strip() or None,
    }
    if cors:
        kwargs["cors_origins"] = cors
    # reason: kwargs is dict[str, object] because cors_origins is conditionally
    # added as list[str]; mypy can't narrow the union per-key for **kwargs.
    return Settings(**kwargs)  # type: ignore[arg-type]
