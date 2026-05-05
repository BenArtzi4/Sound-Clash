"""Public genre listing."""

from __future__ import annotations

import anyio
from fastapi import APIRouter, Response

from app.db.supabase_client import SupabaseClientLike, get_supabase_client
from app.models.genres import GenreOut

router = APIRouter(tags=["genres"])


def _list_blocking(client: SupabaseClientLike) -> list[dict[str, object]]:
    resp = client.table("genres").select("id,name,slug").order("name").execute()
    return list(resp.data or [])


@router.get("/genres", response_model=list[GenreOut])
async def list_genres(response: Response) -> list[dict[str, object]]:
    response.headers["Cache-Control"] = "public, max-age=600"
    rows = await anyio.to_thread.run_sync(_list_blocking, get_supabase_client())
    return rows
