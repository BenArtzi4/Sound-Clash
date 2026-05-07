"""Game lifecycle endpoints — see ``docs/api-contracts.md §2``.

The router never calls ``buzz_in``; that stays browser-direct via PostgREST
to keep Python out of the buzzer hot path. Service-role-only RPCs
(``start_round``, ``award_points``, ``end_game``) are dispatched here.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, Request, status

from app.db.errors import (
    ConflictError,
    DomainError,
    GoneError,
    NotFoundError,
    map_postgrest_error,
)
from app.db.supabase_client import SupabaseClientLike, get_supabase_client
from app.middleware.manager_auth import require_manager_token
from app.middleware.rate_limit import limiter
from app.models.games import (
    AwardBonusRequest,
    AwardBonusResponse,
    AwardPointsRequest,
    AwardPointsResponse,
    CreateGameRequest,
    CreateGameResponse,
    EndGameResponse,
    JoinTeamRequest,
    JoinTeamResponse,
    SelectSongRequest,
    SelectSongResponse,
)
from app.models.songs import SongPayload
from app.services.codes import generate_unique_code
from app.services.scoring import to_rpc_points
from app.services.song_picker import pick_random_song

router = APIRouter(tags=["games"])


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _insert_game_blocking(
    client: SupabaseClientLike, code: str, total_rounds: int, genre_ids: list[str]
) -> dict[str, Any]:
    payload = {
        "game_code": code,
        "status": "waiting",
        "total_rounds": total_rounds,
        "selected_genres": genre_ids,
    }
    try:
        resp = client.table("active_games").insert(payload).execute()
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
    rows = resp.data or []
    if not rows:
        raise NotFoundError("game insert returned no row")
    return dict(rows[0])


def _fetch_game_blocking(client: SupabaseClientLike, code: str) -> dict[str, Any]:
    resp = (
        client.table("active_games")
        .select(
            "game_code,status,total_rounds,selected_genres,started_at,expires_at,ended_at,round_number"
        )
        .eq("game_code", code)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise NotFoundError(f"game {code} not found")
    return dict(rows[0])


def _join_team_blocking(client: SupabaseClientLike, code: str, name: str) -> dict[str, Any]:
    game = _fetch_game_blocking(client, code)
    if game["status"] == "ended" or game.get("ended_at"):
        raise GoneError(f"game {code} has ended")

    try:
        resp = client.table("game_teams").insert({"game_code": code, "name": name}).execute()
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
    rows = resp.data or []
    if not rows:
        raise NotFoundError("team insert returned no row")
    return dict(rows[0])


def _start_round_blocking(
    client: SupabaseClientLike, code: str, song: dict[str, Any]
) -> tuple[str, int]:
    try:
        rpc_resp = client.rpc(
            "start_round", {"p_game_code": code, "p_song_id": song["id"]}
        ).execute()
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
    round_id = rpc_resp.data
    if isinstance(round_id, list) and round_id:
        round_id = round_id[0]

    game_resp = client.table("active_games").select("round_number").eq("game_code", code).execute()
    rows = game_resp.data or []
    if not rows:
        raise NotFoundError(f"game {code} not found")
    return str(round_id), int(rows[0]["round_number"])


def _award_blocking(
    client: SupabaseClientLike,
    code: str,
    body: AwardPointsRequest,
) -> dict[str, Any]:
    title, artist, wrong_buzz, timeout = to_rpc_points(
        title_correct=body.title_correct,
        artist_correct=body.artist_correct,
        wrong_buzz=body.wrong_buzz,
        timeout=body.timeout,
    )

    try:
        rpc_resp = client.rpc(
            "award_points",
            {
                "p_game_code": code,
                "p_round_id": str(body.round_id),
                "p_title": title,
                "p_artist": artist,
                "p_wrong_buzz": wrong_buzz,
                "p_timeout": timeout,
            },
        ).execute()
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
    # award_points returns exactly one row (or raises P0001/P0002 which the
    # except above maps to a DomainError), so .data is always a single dict.
    return dict(rpc_resp.data)


def _bonus_blocking(
    client: SupabaseClientLike,
    code: str,
    body: AwardBonusRequest,
) -> dict[str, Any]:
    try:
        rpc_resp = client.rpc(
            "award_bonus",
            {
                "p_game_code": code,
                "p_team_id": str(body.team_id),
                "p_points": body.points,
            },
        ).execute()
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
    # award_bonus returns RETURNS integer — a single scalar new total.
    return {
        "team_id": str(body.team_id),
        "points_awarded": body.points,
        "team_total_score": int(rpc_resp.data or 0),
    }


def _end_game_blocking(client: SupabaseClientLike, code: str) -> dict[str, Any]:
    try:
        client.rpc("end_game", {"p_game_code": code}).execute()
    except Exception as exc:
        raise map_postgrest_error(exc) from exc
    return _fetch_game_blocking(client, code)


def _kick_blocking(client: SupabaseClientLike, code: str, team_id: str) -> None:
    resp = client.table("game_teams").delete().eq("id", team_id).eq("game_code", code).execute()
    rows = resp.data or []
    if not rows:
        raise NotFoundError(f"team {team_id} not found in game {code}")


# ---------------------------------------------------------------------------
# endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/games",
    response_model=CreateGameResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("10/minute")
async def create_game(request: Request, body: CreateGameRequest) -> CreateGameResponse:
    client = get_supabase_client()
    genre_ids = [str(g) for g in body.selected_genres]

    inserted: dict[str, Any] = {}

    async def insert(code: str) -> None:
        nonlocal inserted
        inserted = await anyio.to_thread.run_sync(
            _insert_game_blocking, client, code, body.total_rounds, genre_ids
        )

    await generate_unique_code(insert)
    return CreateGameResponse.model_validate(inserted)


@router.post(
    "/games/{game_code}/teams",
    response_model=JoinTeamResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("30/minute")
async def join_team(request: Request, game_code: str, body: JoinTeamRequest) -> JoinTeamResponse:
    client = get_supabase_client()
    row = await anyio.to_thread.run_sync(_join_team_blocking, client, game_code, body.name)
    return JoinTeamResponse.model_validate(row)


def _fetch_song_blocking(client: SupabaseClientLike, song_id: str) -> dict[str, Any]:
    resp = (
        client.table("songs")
        .select("id,title,artist,youtube_id,start_time,is_soundtrack,source")
        .eq("id", song_id)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise NotFoundError(f"song {song_id} not found")
    return dict(rows[0])


@router.post(
    "/games/{game_code}/select-song",
    response_model=SelectSongResponse,
    dependencies=[Depends(require_manager_token)],
)
@limiter.limit("100/minute")
async def select_song(
    request: Request, game_code: str, body: SelectSongRequest | None = None
) -> SelectSongResponse:
    client = get_supabase_client()
    game = await anyio.to_thread.run_sync(_fetch_game_blocking, client, game_code)
    if game["status"] == "ended" or game.get("ended_at"):
        raise GoneError(f"game {game_code} has ended")

    genre_ids = list(game.get("selected_genres") or [])
    if not genre_ids:
        raise ConflictError("game has no selected genres")

    if body is not None and body.song_id is not None:
        # Manual pick — bypass the picker and start the round with this exact
        # song. The "no repeats" check is intentionally skipped: the docs spec
        # the Restart-song flow as "old round row remains as a no-points
        # artifact." See docs/game-rules.md §11.
        song = await anyio.to_thread.run_sync(_fetch_song_blocking, client, str(body.song_id))
    else:
        song = await pick_random_song(client, game_code, genre_ids)

    round_id, round_number = await anyio.to_thread.run_sync(
        _start_round_blocking, client, game_code, song
    )
    return SelectSongResponse(
        round_id=UUID(str(round_id)),
        round_number=round_number,
        song=SongPayload.model_validate(song),
    )


@router.post(
    "/games/{game_code}/award-points",
    response_model=AwardPointsResponse,
    dependencies=[Depends(require_manager_token)],
)
@limiter.limit("100/minute")
async def award_points(
    request: Request, game_code: str, body: AwardPointsRequest
) -> AwardPointsResponse:
    client = get_supabase_client()
    try:
        result = await anyio.to_thread.run_sync(_award_blocking, client, game_code, body)
    except DomainError:
        raise
    except Exception as exc:
        raise map_postgrest_error(exc) from exc

    return AwardPointsResponse(
        round_id=body.round_id,
        team_id=result.get("team_id"),
        points_awarded=int(result.get("points_awarded", 0)),
        team_total_score=int(result.get("team_total_score", 0)),
    )


@router.post(
    "/games/{game_code}/bonus",
    response_model=AwardBonusResponse,
    dependencies=[Depends(require_manager_token)],
)
@limiter.limit("100/minute")
async def award_bonus(
    request: Request, game_code: str, body: AwardBonusRequest
) -> AwardBonusResponse:
    client = get_supabase_client()
    # _bonus_blocking already maps every Postgres/RPC exception via
    # map_postgrest_error, so any error reaching here is already a DomainError.
    result = await anyio.to_thread.run_sync(_bonus_blocking, client, game_code, body)
    return AwardBonusResponse.model_validate(result)


@router.post(
    "/games/{game_code}/end",
    response_model=EndGameResponse,
    dependencies=[Depends(require_manager_token)],
)
@limiter.limit("100/minute")
async def end_game(request: Request, game_code: str) -> EndGameResponse:
    client = get_supabase_client()
    game = await anyio.to_thread.run_sync(_end_game_blocking, client, game_code)
    return EndGameResponse.model_validate(game)


@router.delete(
    "/games/{game_code}/teams/{team_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_manager_token)],
)
@limiter.limit("100/minute")
async def kick_team(request: Request, game_code: str, team_id: UUID) -> None:
    client = get_supabase_client()
    await anyio.to_thread.run_sync(_kick_blocking, client, game_code, str(team_id))
