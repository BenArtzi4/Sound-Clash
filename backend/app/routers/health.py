"""Liveness probe."""

from __future__ import annotations

from fastapi import APIRouter

from app import __version__
from app.db.supabase_client import health_check_supabase

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    """Always 200; ``supabase`` is ``"degraded"`` if the probe fails."""
    return {
        "status": "ok",
        "version": __version__,
        "supabase": await health_check_supabase(),
    }
