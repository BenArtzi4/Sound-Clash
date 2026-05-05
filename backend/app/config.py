"""Runtime configuration loaded from environment variables.

Settings are read once via lru_cache so the app behaves like a singleton.
Tests override by setting env vars before the first call to ``get_settings``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


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
    }
    if cors:
        kwargs["cors_origins"] = cors
    return Settings(**kwargs)  # type: ignore[arg-type]
