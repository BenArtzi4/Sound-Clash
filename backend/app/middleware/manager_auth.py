"""Per-game manager-token check.

Hosting a game does not require the global ADMIN_PASSWORD: the host's browser
receives a ``manager_token`` (uuid) from ``POST /games`` and presents it as
``X-Manager-Token`` on every manager-only endpoint. We compare it
constant-time against the row in ``game_secrets`` (migration 034 moved the
token off ``active_games``, which anon can read, into a table anon cannot).
Players who happen to know the game code still cannot manage the game.

The 4xx response message is intentionally generic so a caller cannot
distinguish "no token" from "wrong token". 404/410 are pre-checks: we want
the host to learn the game is gone before guessing the token, and there is
no security value in hiding the existence of a game whose code the caller
already has.
"""

from __future__ import annotations

import secrets
from typing import Annotated, Any

import anyio
from fastapi import Header

from app.db.errors import GoneError, NotFoundError, UnauthorizedError
from app.db.supabase_client import SupabaseClientLike, get_supabase_client


def _fetch_token_blocking(client: SupabaseClientLike, code: str) -> dict[str, Any]:
    game = client.table("active_games").select("ended_at").eq("game_code", code).execute()
    rows = game.data or []
    if not rows:
        raise NotFoundError(f"game {code} not found")
    # The manager token lives in game_secrets (migration 034), a table anon
    # cannot read; the service-role client used here can. A missing secret row
    # leaves the token None, which fails the constant-time compare below closed.
    secret = client.table("game_secrets").select("manager_token").eq("game_code", code).execute()
    srows = secret.data or []
    token = srows[0].get("manager_token") if srows else None
    return {"manager_token": token, "ended_at": rows[0].get("ended_at")}


async def require_manager_token(
    game_code: str,
    x_manager_token: Annotated[str | None, Header(alias="X-Manager-Token")] = None,
) -> None:
    client = get_supabase_client()
    row = await anyio.to_thread.run_sync(_fetch_token_blocking, client, game_code)
    if row.get("ended_at"):
        raise GoneError(f"game {game_code} has ended")

    expected = str(row.get("manager_token") or "")
    provided = x_manager_token or ""
    if not secrets.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise UnauthorizedError("manager token required")
