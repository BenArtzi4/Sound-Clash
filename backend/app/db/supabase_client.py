"""Supabase client factory.

A thin wrapper around supabase-py. The real backend uses ``create_client``
with the service-role key; tests inject a fake via
``set_supabase_client_factory``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import lru_cache
from typing import Any, Literal, Protocol, runtime_checkable

import anyio
from supabase import Client, create_client

from app.config import get_settings

logger = logging.getLogger(__name__)


@runtime_checkable
class SupabaseClientLike(Protocol):
    """Minimum surface used by routers and services."""

    def table(self, name: str) -> Any: ...
    def rpc(self, name: str, params: dict[str, Any] | None = None) -> Any: ...


_factory: Callable[[], SupabaseClientLike] | None = None


def set_supabase_client_factory(factory: Callable[[], SupabaseClientLike] | None) -> None:
    """Override the client factory (used by tests). Pass ``None`` to reset."""
    global _factory
    _factory = factory
    _real_client.cache_clear()


@lru_cache(maxsize=1)
def _real_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_supabase_client() -> SupabaseClientLike:
    if _factory is not None:
        return _factory()
    return _real_client()


async def health_check_supabase() -> Literal["ok", "degraded"]:
    """Cheap probe for ``/health``.

    Times out at 1s so a slow Supabase doesn't make ``/health`` slow.
    """
    try:
        with anyio.fail_after(1.0):
            await anyio.to_thread.run_sync(_probe)
        return "ok"
    except Exception:
        logger.warning("supabase health probe failed", exc_info=True)
        return "degraded"


def _probe() -> None:
    client = get_supabase_client()
    client.table("genres").select("id").limit(1).execute()
