"""POST /games/{code}/rejoin + GET /games/{code}/teams/{id}/rejoin-token.

Issue #183: a team that lost its device rejoins the EXACT same game_teams row
(same id, preserved score) via a per-team rejoin token. The token is disclosed
only to the authenticated host (manager-token-gated), who shows it as a QR.
"""

from __future__ import annotations

from uuid import uuid4

import asyncpg
import pytest

from ._helpers import insert_game, insert_team, manager_headers

pytestmark = pytest.mark.needs_docker


async def _rejoin_token(db: asyncpg.Connection, team_id) -> str:
    token = await db.fetchval(
        "SELECT rejoin_token FROM team_secrets WHERE team_id = $1", team_id
    )
    assert token is not None, "trigger should have provisioned a team secret"
    return str(token)


async def test_join_provisions_a_team_secret(client, db) -> None:
    # The AFTER INSERT trigger (migration 046) mints a rejoin token for every
    # team the join endpoint creates.
    code, _ = await insert_game(db, status="waiting")
    resp = await client.post(f"/games/{code}/teams", json={"name": "Alpha"})
    assert resp.status_code == 201
    team_id = resp.json()["id"]
    count = await db.fetchval(
        "SELECT count(*) FROM team_secrets WHERE team_id = $1", team_id
    )
    assert count == 1


async def test_rejoin_by_token_resumes_team_with_score(client, db) -> None:
    code, _ = await insert_game(db, status="playing")
    team_id = await insert_team(db, code, name="Warriors")
    await db.execute("UPDATE game_teams SET score = 37 WHERE id = $1", team_id)
    token = await _rejoin_token(db, team_id)

    resp = await client.post(f"/games/{code}/rejoin", json={"token": token})
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(team_id)
    assert body["name"] == "Warriors"
    assert body["score"] == 37
    assert body["game_code"] == code


async def test_rejoin_unknown_token_404(client, db) -> None:
    code, _ = await insert_game(db, status="playing")
    resp = await client.post(f"/games/{code}/rejoin", json={"token": str(uuid4())})
    assert resp.status_code == 404
    assert resp.json()["error"] == "not_found"


async def test_rejoin_token_scoped_to_its_game(client, db) -> None:
    # A token from game A must not resolve a team in game B (defense-in-depth:
    # the lookup is scoped by game_code as well as token).
    code_a, _ = await insert_game(db, status="playing")
    team_a = await insert_team(db, code_a, name="Alpha")
    token_a = await _rejoin_token(db, team_a)
    code_b, _ = await insert_game(db, status="playing")

    resp = await client.post(f"/games/{code_b}/rejoin", json={"token": token_a})
    assert resp.status_code == 404


async def test_rejoin_game_not_found_404(client) -> None:
    resp = await client.post("/games/AAAAAA/rejoin", json={"token": str(uuid4())})
    assert resp.status_code == 404


async def test_rejoin_ended_game_410(client, db) -> None:
    code, _ = await insert_game(db, status="playing")
    team_id = await insert_team(db, code, name="Warriors")
    token = await _rejoin_token(db, team_id)
    await db.execute(
        "UPDATE active_games SET status = 'ended', ended_at = now() WHERE game_code = $1",
        code,
    )
    resp = await client.post(f"/games/{code}/rejoin", json={"token": token})
    assert resp.status_code == 410
    assert resp.json()["error"] == "gone"


async def test_rejoin_expired_game_410(client, db) -> None:
    code, _ = await insert_game(db, status="playing", expires_in_hours=-1)
    team_id = await insert_team(db, code, name="Warriors")
    token = await _rejoin_token(db, team_id)
    resp = await client.post(f"/games/{code}/rejoin", json={"token": token})
    assert resp.status_code == 410


async def test_rejoin_rejects_malformed_token(client, db) -> None:
    code, _ = await insert_game(db, status="playing")
    resp = await client.post(f"/games/{code}/rejoin", json={"token": "not-a-uuid"})
    assert resp.status_code == 400


async def test_rejoin_token_endpoint_requires_manager_token(client, db) -> None:
    code, manager_token = await insert_game(db, status="playing")
    team_id = await insert_team(db, code, name="Warriors")

    # No header -> 401.
    r_none = await client.get(f"/games/{code}/teams/{team_id}/rejoin-token")
    assert r_none.status_code == 401

    # Wrong token -> 401.
    r_wrong = await client.get(
        f"/games/{code}/teams/{team_id}/rejoin-token",
        headers=manager_headers(str(uuid4())),
    )
    assert r_wrong.status_code == 401

    # Correct token -> 200 with the rejoin token that matches the DB.
    r_ok = await client.get(
        f"/games/{code}/teams/{team_id}/rejoin-token",
        headers=manager_headers(manager_token),
    )
    assert r_ok.status_code == 200
    body = r_ok.json()
    assert body["team_id"] == str(team_id)
    assert body["rejoin_token"] == await _rejoin_token(db, team_id)


async def test_rejoin_token_endpoint_unknown_team_404(client, db) -> None:
    code, manager_token = await insert_game(db, status="playing")
    resp = await client.get(
        f"/games/{code}/teams/{uuid4()}/rejoin-token",
        headers=manager_headers(manager_token),
    )
    assert resp.status_code == 404


async def test_host_revealed_token_roundtrips_through_rejoin(client, db) -> None:
    # End-to-end: host reveals a team's token, a player uses it to rejoin.
    code, manager_token = await insert_game(db, status="playing")
    team_id = await insert_team(db, code, name="Warriors")
    await db.execute("UPDATE game_teams SET score = 12 WHERE id = $1", team_id)

    reveal = await client.get(
        f"/games/{code}/teams/{team_id}/rejoin-token",
        headers=manager_headers(manager_token),
    )
    assert reveal.status_code == 200
    token = reveal.json()["rejoin_token"]

    rejoin = await client.post(f"/games/{code}/rejoin", json={"token": token})
    assert rejoin.status_code == 200
    assert rejoin.json()["id"] == str(team_id)
    assert rejoin.json()["score"] == 12
