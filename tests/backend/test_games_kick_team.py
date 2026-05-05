"""DELETE /games/{code}/teams/{team_id} — manager kicks a team."""

from __future__ import annotations

import pytest

from ._helpers import insert_game, insert_team

pytestmark = pytest.mark.needs_docker


async def test_happy_path(admin_client, db) -> None:
    code = await insert_game(db, status="playing")
    team_id = await insert_team(db, code, name="GoneSoon")
    resp = await admin_client.delete(f"/games/{code}/teams/{team_id}")
    assert resp.status_code == 204
    row = await db.fetchrow(
        "SELECT 1 FROM game_teams WHERE id = $1", team_id
    )
    assert row is None


async def test_not_found_returns_404(admin_client, db) -> None:
    code = await insert_game(db, status="playing")
    resp = await admin_client.delete(
        f"/games/{code}/teams/00000000-0000-0000-0000-000000000000"
    )
    assert resp.status_code == 404


async def test_admin_required(client, db) -> None:
    code = await insert_game(db, status="playing")
    team_id = await insert_team(db, code, name="ProtectedByAuth")
    resp = await client.delete(f"/games/{code}/teams/{team_id}")
    assert resp.status_code == 401
