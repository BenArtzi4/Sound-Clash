"""Game lifecycle endpoints; see ``docs/api-contracts.md §2``.

The router never calls ``buzz_in``, ``award_attempt``, ``release_buzz_lock``,
``select_next_song``, ``start_round``, or ``end_round``; those stay browser-
direct via PostgREST to keep Python out of the host's hot path. Migrations
021 and 022 moved each function's manager-token check into the PL/pgSQL
body so the browser can pass the token as an RPC argument; migration 022
also collapsed the picker + start_round composition into a single
``select_next_song`` call.

The remaining FastAPI endpoints here are cold-start-tolerant operations
that happen at most once or twice per game: create-game, join-team,
award-bonus, end-game, kick-team. They dispatch the service-role-only
RPCs ``end_game`` and ``award_bonus``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, Request, status

from app.db.errors import (
    GoneError,
    NotFoundError,
    mapped_postgrest_errors,
)
from app.db.supabase_client import SupabaseClientLike, get_supabase_client
from app.middleware.manager_auth import require_manager_token
from app.middleware.rate_limit import limiter
from app.models.games import (
    AwardBonusRequest,
    AwardBonusResponse,
    CreateGameRequest,
    CreateGameResponse,
    EndGameResponse,
    JoinTeamRequest,
    JoinTeamResponse,
)
from app.services.codes import generate_unique_code

router = APIRouter(tags=["games"])


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _insert_game_blocking(
    client: SupabaseClientLike, code: str, genre_ids: list[str], decades: list[int]
) -> dict[str, Any]:
    payload = {
        "game_code": code,
        "status": "waiting",
        "selected_genres": genre_ids,
        "selected_decades": decades,
    }
    with mapped_postgrest_errors():
        resp = client.table("active_games").insert(payload).execute()
    rows = resp.data or []
    if not rows:
        raise NotFoundError("game insert returned no row")
    game = dict(rows[0])
    # Migration 034 moved manager_token off active_games into the anon-invisible
    # game_secrets table; the AFTER INSERT trigger provisioned the secret in the
    # same transaction. Read it back to return to the host.
    secret = client.table("game_secrets").select("manager_token").eq("game_code", code).execute()
    srows = secret.data or []
    if not srows:
        raise NotFoundError("manager secret was not provisioned")
    game["manager_token"] = srows[0]["manager_token"]
    return game


def _fetch_game_blocking(client: SupabaseClientLike, code: str) -> dict[str, Any]:
    resp = (
        client.table("active_games")
        .select(
            "game_code,status,selected_genres,selected_decades,"
            "started_at,expires_at,ended_at,round_number"
        )
        .eq("game_code", code)
        .execute()
    )
    rows = resp.data or []
    if not rows:
        raise NotFoundError(f"game {code} not found")
    return dict(rows[0])


def _is_expired(game: dict[str, Any]) -> bool:
    """True when the game's 4h TTL has lapsed. cleanup_expired_games sweeps only
    hourly, so an expired row can still exist between expiry and the next sweep."""
    raw = game.get("expires_at")
    if not raw:
        return False
    if isinstance(raw, datetime):
        expires = raw
    else:
        try:
            expires = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            return False
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    return expires < datetime.now(UTC)


def _join_team_blocking(client: SupabaseClientLike, code: str, name: str) -> dict[str, Any]:
    game = _fetch_game_blocking(client, code)
    if game["status"] == "ended" or game.get("ended_at"):
        raise GoneError(f"game {code} has ended")
    if _is_expired(game):
        raise GoneError(f"game {code} has expired")

    with mapped_postgrest_errors():
        resp = client.table("game_teams").insert({"game_code": code, "name": name}).execute()
    rows = resp.data or []
    if not rows:
        raise NotFoundError("team insert returned no row")
    return dict(rows[0])


def _bonus_blocking(
    client: SupabaseClientLike,
    code: str,
    body: AwardBonusRequest,
) -> dict[str, Any]:
    with mapped_postgrest_errors():
        rpc_resp = client.rpc(
            "award_bonus",
            {
                "p_game_code": code,
                "p_team_id": str(body.team_id),
                "p_points": body.points,
            },
        ).execute()
    # award_bonus returns RETURNS integer: a single scalar new total.
    return {
        "team_id": str(body.team_id),
        "points_awarded": body.points,
        "team_total_score": int(rpc_resp.data or 0),
    }


def _end_game_blocking(client: SupabaseClientLike, code: str) -> dict[str, Any]:
    with mapped_postgrest_errors():
        client.rpc("end_game", {"p_game_code": code}).execute()
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
    decades = list(body.selected_decades)

    inserted: dict[str, Any] = {}

    async def insert(code: str) -> None:
        nonlocal inserted
        inserted = await anyio.to_thread.run_sync(
            _insert_game_blocking, client, code, genre_ids, decades
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
