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
rejoin-team, team-rejoin-token, award-bonus, end-game, kick-team. They
dispatch the service-role-only RPCs ``end_game`` and ``award_bonus``.

Rejoin (issue #183): ``POST /games/{code}/rejoin`` resolves a per-team
rejoin token (from the anon-invisible ``team_secrets`` table, migration
046) back to the existing ``game_teams`` row so a lost/new device resumes
the exact team + score. The token is disclosed only to the authenticated
host via ``GET /games/{code}/teams/{id}/rejoin-token`` (manager-token
gated), never to players.

A game from a pasted list (custom setlists, migrations 060-061): create-game
repeats the check's match (``read_and_match``) before any row exists, inserts
the game with no genres and no decades, and saves the match as the game's song
pool with the service-role-only RPC ``save_game_setlist``; if that save fails,
the game row is deleted again. Then ``record_song_demand`` counts the lines
the catalog lacks, and a failure there is only logged. The backend touches
``game_setlists`` / ``game_song_pool`` only through these RPCs.
"""

from __future__ import annotations

import logging
import unicodedata
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import anyio
from fastapi import APIRouter, Depends, Request, status

from app.db.errors import (
    ConflictError,
    DomainError,
    GoneError,
    NotFoundError,
    SetlistError,
    mapped_postgrest_errors,
    sqlstate_and_message,
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
    RejoinTeamRequest,
    TeamRejoinTokenResponse,
)
from app.services.codes import generate_unique_code
from app.services.setlist_matcher import LineResult, SetlistMatch
from app.services.setlist_reader import read_and_match
from app.services.setlist_text import ListLine, clean_title, norm

router = APIRouter(tags=["games"])
logger = logging.getLogger(__name__)

SETLIST_EMPTY_MESSAGE = "None of the songs in your list can play."
# A demand key over this many UTF-8 bytes is skipped, not cut: song_demand's
# primary key is a btree, and one key past its row limit (about 2,700 bytes)
# fails the whole record_song_demand call.
MAX_DEMAND_KEY_BYTES = 1000
# One create records at most this many songs (different keys), the first ones
# in list order, so a long list of unknown lines stays one small write.
MAX_DEMAND_SONGS = 100
# raw_line is only shown to whoever reads the demand queue, so a long one is
# cut to this many characters. The key is never cut.
MAX_DEMAND_LINE_CHARS = 300


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def is_test_request(request: Request) -> bool:
    """True when a game is being created by a test, not a real host.

    Real hosts always use a browser, whose User-Agent starts with "Mozilla/".
    Harnesses are headless browsers ("HeadlessChrome") or plain HTTP clients
    (Node fetch, curl, httpx). A real browser running a check sends
    ``X-Sound-Clash-Test: 1`` (the create page does this for ``?test=1``).
    """
    if request.headers.get("x-sound-clash-test") == "1":
        return True
    agent = request.headers.get("user-agent", "")
    return "Headless" in agent or not agent.startswith("Mozilla/")


def _insert_game_blocking(
    client: SupabaseClientLike,
    code: str,
    genre_ids: list[str],
    decades: list[int],
    is_test: bool = False,
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
    if is_test:
        # Migration 051: archive_game copies this into game_history.is_test, so
        # test runs never count as real games.
        with mapped_postgrest_errors():
            client.table("game_secrets").update({"is_test": True}).eq("game_code", code).execute()
    return game


async def _insert_new_game(
    client: SupabaseClientLike, genre_ids: list[str], decades: list[int], is_test: bool
) -> dict[str, Any]:
    """Insert a game under a fresh code, retrying on a code collision."""
    inserted: dict[str, Any] = {}

    async def insert(code: str) -> None:
        nonlocal inserted
        inserted = await anyio.to_thread.run_sync(
            _insert_game_blocking, client, code, genre_ids, decades, is_test
        )

    await generate_unique_code(insert)
    return inserted


def _delete_game_quietly(client: SupabaseClientLike, code: str) -> None:
    """Delete a game whose song pool did not save. Its game_secrets,
    game_setlists and pool rows go with it (ON DELETE CASCADE).

    Best effort: a failure is logged and the caller raises the save's own
    error. A row left behind has no pool and no genres, so it can never start
    a round (select_next_song refuses with no_genres_selected), and the
    4-hour sweep removes it.
    """
    try:
        client.table("active_games").delete().eq("game_code", code).execute()
    except Exception as exc:
        logger.warning(
            "could not delete game %s after its song pool failed to save: %s",
            code,
            _error_reason(exc),
        )


def _save_pool_blocking(
    client: SupabaseClientLike, code: str, match: SetlistMatch, list_total: int
) -> None:
    """Save the match as the game's song pool, or delete the game and raise.

    ``save_game_setlist`` writes the ready ``game_setlists`` row and the pool
    rows in one call. It skips a song deleted or flagged since the catalog
    snapshot was cached, and raises ``setlist_empty`` (22023) when no song is
    left: that is the same 400 as an empty match. Any other failure is mapped
    as every database error is (usually a 500).
    """
    params = {
        "p_game_code": code,
        "p_list_song_ids": list(match.list_song_ids),
        "p_fill_song_ids": list(match.fill_song_ids),
        "p_list_total": list_total,
    }
    try:
        with mapped_postgrest_errors():
            client.rpc("save_game_setlist", params).execute()
    except DomainError as err:
        _delete_game_quietly(client, code)
        if sqlstate_and_message(err.__cause__) == ("22023", "setlist_empty"):
            raise SetlistError("setlist_empty", SETLIST_EMPTY_MESSAGE) from err
        raise


def _error_reason(exc: Exception) -> str:
    """An error's SQLSTATE (or type) and message, for a log line. Never the
    host's list: no log line here holds list text."""
    sqlstate, message = sqlstate_and_message(exc)
    return f"{sqlstate or type(exc).__name__} {message or ''}".rstrip()


def _demand_key(line: ListLine) -> str:
    """The ``song_demand`` key of a list line: one key per song (spec §13.5).

    Built from the sides the matcher compares, not from the raw line: each
    side cleaned as a title (``clean_title``, then ``norm``), empty pieces
    dropped, the rest sorted and joined with one space. So numbering, a
    duration, a recording note, a CSV row's other cells and the order of
    artist and title never change the key: ``1. Nobody - Not A Real Song
    (3:51)`` and ``Not A Real Song - Nobody`` are both ``nobody not a real song``.
    """
    sides = (line.left,) if line.right is None else (line.left, line.right)
    pieces = (norm(clean_title(side)) for side in sides)
    return " ".join(sorted(piece for piece in pieces if piece))


def _demand_entry(result: LineResult) -> tuple[str, str] | None:
    """(line_key, raw_line) for a line the catalog lacks; None to skip it.

    Only ``not_in_catalog`` lines count: a song name several songs share is in
    the catalog. A key that is empty or over ``MAX_DEMAND_KEY_BYTES``, and a
    line with a NUL character (Postgres text cannot hold one), are skipped.
    ``raw_line`` is the line as the host wrote it, cut to
    ``MAX_DEMAND_LINE_CHARS`` characters.
    """
    if result.reason != "not_in_catalog":
        return None
    raw = result.line.raw
    key = _demand_key(result.line)
    if not key or "\x00" in key or "\x00" in raw:
        return None
    if len(key.encode("utf-8")) > MAX_DEMAND_KEY_BYTES:
        return None
    return key, raw[:MAX_DEMAND_LINE_CHARS]


def _demand_entries(results: Sequence[LineResult]) -> dict[str, str]:
    """{line_key: raw_line} of the first ``MAX_DEMAND_SONGS`` songs the
    catalog lacks, in list order; a key named again keeps its first line (as
    ``record_song_demand`` does) and takes no second place."""
    entries: dict[str, str] = {}
    for entry in map(_demand_entry, results):
        if entry is None or entry[0] in entries:
            continue
        entries[entry[0]] = entry[1]
        if len(entries) == MAX_DEMAND_SONGS:
            break
    return entries


def _record_demand_blocking(
    client: SupabaseClientLike, code: str, results: Sequence[LineResult]
) -> None:
    """Count the lines the catalog lacks in ``song_demand``.

    Never raises: demand must never fail a create. A failure is logged with
    its error only, never with the host's list.
    """
    try:
        entries = _demand_entries(results)
        if not entries:
            return
        client.rpc(
            "record_song_demand",
            {"p_keys": list(entries), "p_lines": list(entries.values())},
        ).execute()
    except Exception as exc:
        logger.warning("song demand not recorded for game %s: %s", code, _error_reason(exc))


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


def _team_name_key(name: str) -> str:
    """Comparison key for team-name uniqueness within a game: NFKC-folded (so
    full-width letters match their ASCII forms), whitespace runs collapsed, and
    case-folded."""
    return " ".join(unicodedata.normalize("NFKC", name).split()).casefold()


def _join_team_blocking(client: SupabaseClientLike, code: str, name: str) -> dict[str, Any]:
    game = _fetch_game_blocking(client, code)
    if game["status"] == "ended" or game.get("ended_at"):
        raise GoneError(f"game {code} has ended")
    if _is_expired(game):
        raise GoneError(f"game {code} has expired")

    # A taken name is a 409, never a hand-back of the existing team. Joining
    # used to "reclaim" a same-name row (T5.7), which in game XSU8WK silently
    # put a second team on the first team's row. Returning teams use their own
    # browser's stored identity or the host's rescue QR (POST .../rejoin).
    # Names compare by _team_name_key so "Ofra Fans" and "ofra  fans", which
    # look like one team on the projector, can't both join. The exact-match
    # UNIQUE (game_code, name) from migration 003 still closes the
    # select-then-insert race for identical names (→ 409 via the mapper).
    with mapped_postgrest_errors():
        existing = client.table("game_teams").select("name").eq("game_code", code).execute()
    key = _team_name_key(name)
    if any(_team_name_key(str(row["name"])) == key for row in existing.data or []):
        raise ConflictError(f"a team named {name!r} is already in game {code}")

    with mapped_postgrest_errors():
        resp = client.table("game_teams").insert({"game_code": code, "name": name}).execute()
    rows = resp.data or []
    if not rows:
        raise NotFoundError("team insert returned no row")
    return dict(rows[0])


def _rejoin_team_blocking(client: SupabaseClientLike, code: str, token: str) -> dict[str, Any]:
    """Resolve a per-team rejoin token back to its existing game_teams row
    (issue #183). The token is looked up in the anon-invisible team_secrets
    table with the service-role key; a match returns the SAME team row (same id,
    same accumulated score) so a rescued device resumes the exact team rather
    than a fresh 0-point one. Off the buzzer hot path (rejoin happens once when
    a device is lost), so it rides FastAPI like create-game/join."""
    game = _fetch_game_blocking(client, code)
    if game["status"] == "ended" or game.get("ended_at"):
        raise GoneError(f"game {code} has ended")
    if _is_expired(game):
        raise GoneError(f"game {code} has expired")

    # team_secrets is scoped by (game_code, rejoin_token); an unknown/foreign
    # token matches nothing -> a generic 404 that doesn't distinguish "no such
    # token" from "wrong game". The uuid `=` is a fixed 16-byte compare, not a
    # timing oracle (see migration 021), so no constant-time compare is needed.
    with mapped_postgrest_errors():
        secret = (
            client.table("team_secrets")
            .select("team_id")
            .eq("game_code", code)
            .eq("rejoin_token", token)
            .limit(1)
            .execute()
        )
    secret_rows = secret.data or []
    if not secret_rows:
        raise NotFoundError("no team matches that rejoin link")

    team_id = secret_rows[0]["team_id"]
    with mapped_postgrest_errors():
        team = (
            client.table("game_teams")
            .select("*")
            .eq("id", team_id)
            .eq("game_code", code)
            .limit(1)
            .execute()
        )
    team_rows = team.data or []
    if not team_rows:
        raise NotFoundError("no team matches that rejoin link")
    return dict(team_rows[0])


def _rejoin_token_blocking(client: SupabaseClientLike, code: str, team_id: str) -> dict[str, Any]:
    """Read a team's rejoin token so the host can build a rescue QR. Called only
    behind require_manager_token, so the token is revealed exclusively to the
    authenticated host, never to players."""
    with mapped_postgrest_errors():
        resp = (
            client.table("team_secrets")
            .select("team_id,rejoin_token")
            .eq("game_code", code)
            .eq("team_id", team_id)
            .limit(1)
            .execute()
        )
    rows = resp.data or []
    if not rows:
        raise NotFoundError(f"team {team_id} not found in game {code}")
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
    is_test = is_test_request(request)
    if body.setlist is not None:
        return await _create_list_game(client, body.setlist.text, is_test)

    genre_ids = [str(g) for g in body.selected_genres]
    decades = list(body.selected_decades)
    inserted = await _insert_new_game(client, genre_ids, decades, is_test)
    return CreateGameResponse.model_validate(inserted)


async def _create_list_game(
    client: SupabaseClientLike, text: str, is_test: bool
) -> CreateGameResponse:
    """Create a game from the host's pasted list (design spec §8).

    The list is read and matched before any row exists, so a refused or
    empty list writes nothing. The answer counts the songs as the matcher
    did, and holds no song id, YouTube id or start time.
    """
    matched = await read_and_match(text)
    match = matched.match
    if not match.list_song_ids and not match.fill_song_ids:
        raise SetlistError("setlist_empty", SETLIST_EMPTY_MESSAGE)

    inserted = await _insert_new_game(client, [], [], is_test)
    code = inserted["game_code"]
    # list_total counts every song line, found or not: the check's lines_total.
    await anyio.to_thread.run_sync(_save_pool_blocking, client, code, match, len(matched.lines))
    await anyio.to_thread.run_sync(_record_demand_blocking, client, code, match.results)

    summary = {
        "list_songs": len(match.list_song_ids),
        "same_artist_songs": len(match.fill_song_ids),
    }
    return CreateGameResponse.model_validate({**inserted, "setlist": summary})


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
    "/games/{game_code}/rejoin",
    response_model=JoinTeamResponse,
    status_code=status.HTTP_200_OK,
)
@limiter.limit("30/minute")
async def rejoin_team(
    request: Request, game_code: str, body: RejoinTeamRequest
) -> JoinTeamResponse:
    """Reconnect a device to an existing team via its per-team rejoin token
    (issue #183). Resolves to the SAME game_teams row with its preserved score.
    The token reaches here from a host-shown QR (…/join/<CODE>#rt=<token>);
    it is never returned to players by any other endpoint. 200 (no creation)."""
    client = get_supabase_client()
    row = await anyio.to_thread.run_sync(_rejoin_team_blocking, client, game_code, str(body.token))
    return JoinTeamResponse.model_validate(row)


@router.get(
    "/games/{game_code}/teams/{team_id}/rejoin-token",
    response_model=TeamRejoinTokenResponse,
    dependencies=[Depends(require_manager_token)],
)
@limiter.limit("100/minute")
async def team_rejoin_token(
    request: Request, game_code: str, team_id: UUID
) -> TeamRejoinTokenResponse:
    """Reveal a team's rejoin token to the authenticated host so the console can
    render a rescue QR. Manager-token-gated: this is the ONLY way a rejoin token
    is ever disclosed."""
    client = get_supabase_client()
    row = await anyio.to_thread.run_sync(_rejoin_token_blocking, client, game_code, str(team_id))
    return TeamRejoinTokenResponse.model_validate(row)


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
