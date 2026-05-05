"""DELETE /games/{code}/teams/{team_id} — manager kicks a team."""

from __future__ import annotations

import pytest

from ._helpers import insert_game, insert_team, manager_headers

pytestmark = pytest.mark.needs_docker


async def test_happy_path(client, db) -> None:
    code, token = await insert_game(db, status="playing")
    team_id = await insert_team(db, code, name="GoneSoon")
    resp = await client.delete(
        f"/games/{code}/teams/{team_id}", headers=manager_headers(token)
    )
    assert resp.status_code == 204
    row = await db.fetchrow(
        "SELECT 1 FROM game_teams WHERE id = $1", team_id
    )
    assert row is None


async def test_not_found_returns_404(client, db) -> None:
    code, token = await insert_game(db, status="playing")
    resp = await client.delete(
        f"/games/{code}/teams/00000000-0000-0000-0000-000000000000",
        headers=manager_headers(token),
    )
    assert resp.status_code == 404


async def test_manager_token_required(client, db) -> None:
    code, _ = await insert_game(db, status="playing")
    team_id = await insert_team(db, code, name="ProtectedByAuth")
    resp = await client.delete(f"/games/{code}/teams/{team_id}")
    assert resp.status_code == 401
