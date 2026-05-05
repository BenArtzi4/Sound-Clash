"""POST /games/{code}/award-points — boolean translation + RPC dispatch."""

from __future__ import annotations

import pytest

from ._helpers import (
    fetch_genre_ids,
    insert_game,
    insert_song,
    insert_team,
    manager_headers,
)

pytestmark = pytest.mark.needs_docker


async def _start_round(
    client,
    db,
    *,
    is_soundtrack: bool = False,
    source: str | None = None,
) -> tuple[str, str, str, str]:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    await insert_song(
        db, genre_slugs=["rock"], is_soundtrack=is_soundtrack, source=source
    )
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    team_id = await insert_team(db, code, name="Solo")
    pick = await client.post(
        f"/games/{code}/select-song", json={}, headers=manager_headers(token)
    )
    assert pick.status_code == 200, pick.text
    round_id = pick.json()["round_id"]
    # Simulate the team buzzing via direct DB so we can score them.
    await db.execute(
        "UPDATE active_games SET buzzed_team_id = $1, locked_at = now() WHERE game_code = $2",
        team_id,
        code,
    )
    await db.execute(
        "UPDATE game_rounds SET buzzed_team_id = $1 WHERE id = $2",
        team_id,
        round_id,
    )
    return code, round_id, str(team_id), str(token)


async def test_happy_path_awards_15_for_title_artist(client, db) -> None:
    code, round_id, team_id, token = await _start_round(client, db)
    resp = await client.post(
        f"/games/{code}/award-points",
        json={
            "round_id": round_id,
            "title_correct": True,
            "artist_correct": True,
            "source_correct": False,
            "timeout": False,
        },
        headers=manager_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["points_awarded"] == 15
    assert body["team_id"] == team_id
    assert body["team_total_score"] == 15


async def test_idempotency_second_call_409(client, db) -> None:
    code, round_id, _, token = await _start_round(client, db)
    headers = manager_headers(token)
    payload = {
        "round_id": round_id,
        "title_correct": True,
        "artist_correct": False,
        "source_correct": False,
        "timeout": False,
    }
    r1 = await client.post(f"/games/{code}/award-points", json=payload, headers=headers)
    assert r1.status_code == 200
    r2 = await client.post(f"/games/{code}/award-points", json=payload, headers=headers)
    assert r2.status_code == 409


async def test_source_on_non_soundtrack_400(client, db) -> None:
    code, round_id, _, token = await _start_round(client, db, is_soundtrack=False)
    resp = await client.post(
        f"/games/{code}/award-points",
        json={
            "round_id": round_id,
            "title_correct": False,
            "artist_correct": False,
            "source_correct": True,
            "timeout": False,
        },
        headers=manager_headers(token),
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "validation_error"


async def test_timeout_penalty_applies(client, db) -> None:
    """timeout=True applies -2 penalty; other booleans ignored."""
    code, round_id, _, token = await _start_round(client, db)
    # Clear the buzz so the round is a "no buzz" timeout.
    await db.execute(
        "UPDATE active_games SET buzzed_team_id = NULL, locked_at = NULL WHERE game_code = $1",
        code,
    )
    await db.execute(
        "UPDATE game_rounds SET buzzed_team_id = NULL WHERE id = $1",
        round_id,
    )
    resp = await client.post(
        f"/games/{code}/award-points",
        json={
            "round_id": round_id,
            "title_correct": True,  # ignored due to timeout=True
            "artist_correct": True,
            "source_correct": False,
            "timeout": True,
        },
        headers=manager_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["team_id"] is None  # nobody buzzed
    # team score is 0 since no team to credit
    assert body["team_total_score"] == 0


async def test_manager_token_required(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, _ = await insert_game(db, status="playing", selected_genres=rock)
    resp = await client.post(
        f"/games/{code}/award-points",
        json={
            "round_id": "00000000-0000-0000-0000-000000000000",
            "title_correct": False,
            "artist_correct": False,
            "source_correct": False,
            "timeout": False,
        },
    )
    assert resp.status_code == 401
