"""Admin-gated song CRUD + bulk CSV import."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status

from app.db.errors import NotFoundError, map_postgrest_error
from app.db.supabase_client import SupabaseClientLike, get_supabase_client
from app.middleware.admin_auth import require_admin
from app.middleware.rate_limit import limiter
from app.models.songs import (
    BulkImportSummary,
    SongCreate,
    SongList,
    SongPayload,
    SongUpdate,
)
from app.services.csv_import import apply_import, parse_csv

router = APIRouter(
    prefix="/admin/songs",
    tags=["admin-songs"],
    dependencies=[Depends(require_admin)],
)

SONG_COLUMNS = "id,title,artist,youtube_id,start_time,is_soundtrack,source"


def _list_blocking(
    client: SupabaseClientLike,
    *,
    page: int,
    per_page: int,
    search: str | None,
    genre: str | None,
) -> dict[str, Any]:
    if genre:
        gen_resp = client.table("genres").select("id").eq("slug", genre).execute()
        gen_rows = gen_resp.data or []
        if not gen_rows:
            return {"items": [], "page": page, "per_page": per_page, "total": 0}
        genre_id = gen_rows[0]["id"]
        sg_resp = client.table("song_genres").select("song_id").eq("genre_id", genre_id).execute()
        ids = [r["song_id"] for r in (sg_resp.data or [])]
        if not ids:
            return {"items": [], "page": page, "per_page": per_page, "total": 0}
        query = client.table("songs").select(SONG_COLUMNS).in_("id", ids)
    else:
        query = client.table("songs").select(SONG_COLUMNS)

    if search:
        query = query.ilike("title", f"%{search}%")

    resp = query.order("title").execute()
    rows = list(resp.data or [])
    total = len(rows)
    start = max(0, (page - 1) * per_page)
    end = start + per_page
    return {
        "items": rows[start:end],
        "page": page,
        "per_page": per_page,
        "total": total,
    }


def _fetch_song_blocking(client: SupabaseClientLike, song_id: str) -> dict[str, Any]:
    resp = client.table("songs").select(SONG_COLUMNS).eq("id", song_id).execute()
    rows = resp.data or []
    if not rows:
        raise NotFoundError(f"song {song_id} not found")
    return dict(rows[0])


def _create_song_blocking(client: SupabaseClientLike, body: SongCreate) -> dict[str, Any]:
    payload = {
        "title": body.title,
        "artist": body.artist,
        "youtube_id": body.youtube_id,
        "start_time": body.start_time,
        "is_soundtrack": body.is_soundtrack,
        "source": body.source,
    }
    try:
        resp = client.table("songs").insert(payload).execute()
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
    rows = resp.data or []
    if not rows:
        raise NotFoundError("song insert returned no row")
    song: dict[str, Any] = dict(rows[0])

    joins = [{"song_id": song["id"], "genre_id": str(g)} for g in body.genre_ids]
    if joins:
        try:
            client.table("song_genres").insert(joins).execute()
        except Exception as exc:
            raise map_postgrest_error(exc) from exc
    return song


def _update_song_blocking(
    client: SupabaseClientLike, song_id: str, body: SongUpdate
) -> dict[str, Any]:
    _fetch_song_blocking(client, song_id)
    payload = {
        "title": body.title,
        "artist": body.artist,
        "youtube_id": body.youtube_id,
        "start_time": body.start_time,
        "is_soundtrack": body.is_soundtrack,
        "source": body.source,
    }
    try:
        resp = client.table("songs").update(payload).eq("id", song_id).execute()
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
    rows = resp.data or []
    song = rows[0] if rows else _fetch_song_blocking(client, song_id)

    client.table("song_genres").delete().eq("song_id", song_id).execute()
    joins = [{"song_id": song_id, "genre_id": str(g)} for g in body.genre_ids]
    if joins:
        try:
            client.table("song_genres").insert(joins).execute()
        except Exception as exc:
            raise map_postgrest_error(exc) from exc
    return song


def _delete_song_blocking(client: SupabaseClientLike, song_id: str) -> None:
    resp = client.table("songs").delete().eq("id", song_id).execute()
    rows = resp.data or []
    if not rows:
        raise NotFoundError(f"song {song_id} not found")


@router.get("", response_model=SongList)
@limiter.limit("100/minute")
async def list_songs(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    genre: str | None = Query(None),
) -> SongList:
    client = get_supabase_client()
    result = await anyio.to_thread.run_sync(
        lambda: _list_blocking(client, page=page, per_page=per_page, search=search, genre=genre)
    )
    return SongList(
        items=[SongPayload.model_validate(item) for item in result["items"]],
        page=result["page"],
        per_page=result["per_page"],
        total=result["total"],
    )


@router.get("/{song_id}", response_model=SongPayload)
@limiter.limit("100/minute")
async def get_song(request: Request, song_id: UUID) -> SongPayload:
    client = get_supabase_client()
    row = await anyio.to_thread.run_sync(_fetch_song_blocking, client, str(song_id))
    return SongPayload.model_validate(row)


@router.post("", response_model=SongPayload, status_code=status.HTTP_201_CREATED)
@limiter.limit("100/minute")
async def create_song(request: Request, body: SongCreate) -> SongPayload:
    client = get_supabase_client()
    row = await anyio.to_thread.run_sync(_create_song_blocking, client, body)
    return SongPayload.model_validate(row)


@router.put("/{song_id}", response_model=SongPayload)
@limiter.limit("100/minute")
async def update_song(request: Request, song_id: UUID, body: SongUpdate) -> SongPayload:
    client = get_supabase_client()
    row = await anyio.to_thread.run_sync(_update_song_blocking, client, str(song_id), body)
    return SongPayload.model_validate(row)


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("100/minute")
async def delete_song(request: Request, song_id: UUID) -> None:
    client = get_supabase_client()
    await anyio.to_thread.run_sync(_delete_song_blocking, client, str(song_id))


_REQUIRED_FILE = File(...)


@router.post("/bulk-import", response_model=BulkImportSummary)
@limiter.limit("5/minute")
async def bulk_import(request: Request, file: UploadFile = _REQUIRED_FILE) -> BulkImportSummary:
    raw = await file.read()
    rows = parse_csv(raw)
    summary = await apply_import(get_supabase_client(), rows)
    return BulkImportSummary(
        inserted=summary.inserted,
        updated=summary.updated,
        total=summary.total,
    )
