"""Admin-gated song CRUD + bulk CSV import."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status

from app.constants import SOUNDTRACK_GENRE_SLUGS
from app.db.errors import NotFoundError, PayloadTooLargeError, mapped_postgrest_errors
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

SONG_COLUMNS = "id,title,artist,youtube_id,start_time,release_year"


def _attach_genres(client: SupabaseClientLike, songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Mutate each song dict in place to add a `genres: list[dict]` field.

    Two extra round-trips instead of a PostgREST embed: keeps the admin list
    sane against the fake-supabase test harness (which lowers the select
    string straight into raw SQL and would choke on embed syntax). For an
    admin-only page that serves at most 50 rows per request, the extra
    latency is in the noise.
    """
    if not songs:
        return songs
    ids = [s["id"] for s in songs]
    sg_resp = client.table("song_genres").select("song_id,genre_id").in_("song_id", ids).execute()
    sg_rows = sg_resp.data or []
    gids = sorted({r["genre_id"] for r in sg_rows}, key=str)
    if gids:
        g_resp = client.table("genres").select("id,name,slug").in_("id", gids).execute()
        gmap = {row["id"]: row for row in (g_resp.data or [])}
    else:
        gmap = {}
    by_song: dict[Any, list[dict[str, Any]]] = {}
    for r in sg_rows:
        meta = gmap.get(r["genre_id"])
        if meta:
            by_song.setdefault(r["song_id"], []).append(meta)
    for s in songs:
        genres = by_song.get(s["id"], [])
        s["genres"] = genres
        # Soundtrack-ness is derived from genre membership (migration 028): a
        # song is a soundtrack iff it belongs to a soundtrack genre.
        s["is_soundtrack"] = any(g.get("slug") in SOUNDTRACK_GENRE_SLUGS for g in genres)
    return songs


def _list_blocking(
    client: SupabaseClientLike,
    *,
    page: int,
    per_page: int,
    search: str | None,
    genre: str | None,
) -> dict[str, Any]:
    start = max(0, (page - 1) * per_page)
    end = start + per_page - 1  # range() is inclusive on both ends
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
        query = client.table("songs").select(SONG_COLUMNS, count="exact").in_("id", ids)
    else:
        query = client.table("songs").select(SONG_COLUMNS, count="exact")

    if search:
        query = query.ilike("title", f"%{search}%")

    # Page in the database with range() and read the true total from the
    # exact-count header. The previous approach fetched every matching row and
    # counted/sliced in Python, which silently capped both the returned list
    # and `total` at PostgREST's default 1000-row ceiling once the catalog
    # passed 1000 songs (gameplay was unaffected — song selection runs inside
    # Postgres, not over PostgREST).
    resp = query.order("title").range(start, end).execute()
    rows = [dict(r) for r in (resp.data or [])]
    # count="exact" always populates resp.count (the Content-Range total).
    total = resp.count
    _attach_genres(client, rows)
    return {
        "items": rows,
        "page": page,
        "per_page": per_page,
        "total": total,
    }


def _fetch_song_blocking(client: SupabaseClientLike, song_id: str) -> dict[str, Any]:
    resp = client.table("songs").select(SONG_COLUMNS).eq("id", song_id).execute()
    rows = resp.data or []
    if not rows:
        raise NotFoundError(f"song {song_id} not found")
    row = dict(rows[0])
    _attach_genres(client, [row])
    return row


def _create_song_blocking(client: SupabaseClientLike, body: SongCreate) -> dict[str, Any]:
    payload = {
        "title": body.title,
        "artist": body.artist,
        "youtube_id": body.youtube_id,
        "start_time": body.start_time,
        "release_year": body.release_year,
    }
    with mapped_postgrest_errors():
        resp = client.table("songs").insert(payload).execute()
    rows = resp.data or []
    if not rows:
        raise NotFoundError("song insert returned no row")
    song_id = str(rows[0]["id"])

    joins = [{"song_id": song_id, "genre_id": str(g)} for g in body.genre_ids]
    if joins:
        with mapped_postgrest_errors():
            client.table("song_genres").insert(joins).execute()
    # Re-fetch via the embed so the response includes the genres just attached.
    return _fetch_song_blocking(client, song_id)


def _update_song_blocking(
    client: SupabaseClientLike, song_id: str, body: SongUpdate
) -> dict[str, Any]:
    _fetch_song_blocking(client, song_id)
    payload = {
        "title": body.title,
        "artist": body.artist,
        "youtube_id": body.youtube_id,
        "start_time": body.start_time,
        "release_year": body.release_year,
    }
    with mapped_postgrest_errors():
        client.table("songs").update(payload).eq("id", song_id).execute()

    client.table("song_genres").delete().eq("song_id", song_id).execute()
    joins = [{"song_id": song_id, "genre_id": str(g)} for g in body.genre_ids]
    if joins:
        with mapped_postgrest_errors():
            client.table("song_genres").insert(joins).execute()
    # Re-fetch via the embed so the response reflects the new genres.
    return _fetch_song_blocking(client, song_id)


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

# Hard cap on the multipart upload buffered into the single free-tier worker's
# RAM. The real catalog CSV is ~40 KB / ~1000 rows, so 5 MB is very generous
# while still bounding a runaway upload before it can OOM the worker.
MAX_IMPORT_BYTES = 5 * 1024 * 1024
_READ_CHUNK_BYTES = 64 * 1024


def _too_large() -> PayloadTooLargeError:
    return PayloadTooLargeError(
        f"upload exceeds the {MAX_IMPORT_BYTES}-byte limit",
        details={"limit_bytes": MAX_IMPORT_BYTES},
    )


async def _read_capped(file: UploadFile) -> bytes:
    """Buffer the upload, refusing to read past ``MAX_IMPORT_BYTES``.

    Reads in bounded chunks and stops the moment the cap is exceeded, so a
    missing or lying ``Content-Length`` can't push more than the cap into RAM.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_READ_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_IMPORT_BYTES:
            raise _too_large()
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/bulk-import", response_model=BulkImportSummary)
@limiter.limit("5/minute")
async def bulk_import(request: Request, file: UploadFile = _REQUIRED_FILE) -> BulkImportSummary:
    # Fast-path reject on a declared Content-Length before buffering anything;
    # the streamed read below is the real backstop for a missing/lying header.
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_IMPORT_BYTES:
                raise _too_large()
        except ValueError:
            pass
    raw = await _read_capped(file)
    rows = parse_csv(raw)
    summary = await apply_import(get_supabase_client(), rows)
    return BulkImportSummary(
        inserted=summary.inserted,
        updated=summary.updated,
        total=summary.total,
    )
