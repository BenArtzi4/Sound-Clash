"""POST /games/{code}/attempt and /end-round (replaces award-points).

Multi-buzz round model: a single round can accept many ``award_attempt``
calls. Each one scores the buzzed team and clears the lock; the round
stays open until ``end_round`` is called (or until the next
``start_round`` defensively closes it).
"""

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
    await _force_buzz(db, code, round_id, team_id)
    return code, round_id, str(team_id), str(token)


async def _force_buzz(db, code: str, round_id: str, team_id) -> None:
    """Simulate a team holding the buzz lock without going through buzz_in."""
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


async def test_attempt_title_only_awards_10(client, db) -> None:
    code, round_id, team_id, token = await _start_round(client, db)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={
            "round_id": round_id,
            "title_correct": True,
            "artist_correct": False,
            "wrong_buzz": False,
        },
        headers=manager_headers(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["points_awarded"] == 10
    assert body["team_id"] == team_id
    assert body["team_total_score"] == 10
    assert body["title_claimed_by"] == team_id
    assert body["artist_claimed_by"] is None


async def test_attempt_artist_only_awards_5(client, db) -> None:
    code, round_id, team_id, token = await _start_round(client, db)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={
            "round_id": round_id,
            "title_correct": False,
            "artist_correct": True,
            "wrong_buzz": False,
        },
        headers=manager_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["points_awarded"] == 5
    assert body["team_total_score"] == 5
    assert body["title_claimed_by"] is None
    assert body["artist_claimed_by"] == team_id


async def test_attempt_both_awards_15(client, db) -> None:
    code, round_id, team_id, token = await _start_round(client, db)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={
            "round_id": round_id,
            "title_correct": True,
            "artist_correct": True,
            "wrong_buzz": False,
        },
        headers=manager_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["points_awarded"] == 15
    assert body["team_total_score"] == 15
    assert body["title_claimed_by"] == team_id
    assert body["artist_claimed_by"] == team_id


async def test_attempt_wrong_deducts_three(client, db) -> None:
    code, round_id, team_id, token = await _start_round(client, db)
    await db.execute("UPDATE game_teams SET score = 10 WHERE id = $1", team_id)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={
            "round_id": round_id,
            "title_correct": False,
            "artist_correct": False,
            "wrong_buzz": True,
        },
        headers=manager_headers(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["points_awarded"] == -3
    assert body["team_total_score"] == 7
    assert body["title_claimed_by"] is None
    assert body["artist_claimed_by"] is None


async def test_attempt_clears_buzz_lock(client, db) -> None:
    """After award_attempt, active_games.buzzed_team_id is cleared so another
    team can buzz again on the same song."""
    code, round_id, team_id, token = await _start_round(client, db)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "wrong_buzz": True},
        headers=manager_headers(token),
    )
    assert resp.status_code == 200
    locked = await db.fetchval(
        "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", code
    )
    assert locked is None


async def test_attempt_round_stays_open_after_score(client, db) -> None:
    """Multi-buzz: ended_at must remain NULL after award_attempt."""
    code, round_id, _, token = await _start_round(client, db)
    await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "title_correct": True},
        headers=manager_headers(token),
    )
    ended = await db.fetchval(
        "SELECT ended_at FROM game_rounds WHERE id = $1", round_id
    )
    assert ended is None


async def test_attempt_sequential_two_teams_split_tokens(client, db) -> None:
    """Scenario 3: T1 claims title, T2 claims artist on the same song."""
    rock = await fetch_genre_ids(db, slugs=["rock"])
    await insert_song(db, genre_slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    t1 = await insert_team(db, code, name="T1")
    t2 = await insert_team(db, code, name="T2")
    pick = await client.post(
        f"/games/{code}/select-song", json={}, headers=manager_headers(token)
    )
    round_id = pick.json()["round_id"]

    await _force_buzz(db, code, round_id, t1)
    r1 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "title_correct": True},
        headers=manager_headers(token),
    )
    assert r1.status_code == 200
    assert r1.json()["title_claimed_by"] == str(t1)

    await _force_buzz(db, code, round_id, t2)
    r2 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "artist_correct": True},
        headers=manager_headers(token),
    )
    assert r2.status_code == 200
    assert r2.json()["points_awarded"] == 5
    assert r2.json()["artist_claimed_by"] == str(t2)
    assert r2.json()["title_claimed_by"] == str(t1)


async def test_attempt_title_already_claimed_returns_409(client, db) -> None:
    code, round_id, t1, token = await _start_round(client, db)
    r1 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "title_correct": True},
        headers=manager_headers(token),
    )
    assert r1.status_code == 200

    t2 = await insert_team(db, code, name="T2")
    await _force_buzz(db, code, round_id, t2)
    r2 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "title_correct": True},
        headers=manager_headers(token),
    )
    assert r2.status_code == 409


async def test_attempt_artist_already_claimed_returns_409(client, db) -> None:
    code, round_id, _, token = await _start_round(client, db)
    r1 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "artist_correct": True},
        headers=manager_headers(token),
    )
    assert r1.status_code == 200

    t2 = await insert_team(db, code, name="T2")
    await _force_buzz(db, code, round_id, t2)
    r2 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "artist_correct": True},
        headers=manager_headers(token),
    )
    assert r2.status_code == 409


async def test_attempt_no_buzz_held_returns_409(client, db) -> None:
    """If no team currently holds the lock, award_attempt rejects."""
    code, round_id, _, token = await _start_round(client, db)
    await db.execute(
        "UPDATE active_games SET buzzed_team_id = NULL, locked_at = NULL WHERE game_code = $1",
        code,
    )
    resp = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "title_correct": True},
        headers=manager_headers(token),
    )
    assert resp.status_code == 409


async def test_attempt_wrong_with_correct_returns_400(client, db) -> None:
    code, round_id, _, token = await _start_round(client, db)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={
            "round_id": round_id,
            "title_correct": True,
            "wrong_buzz": True,
        },
        headers=manager_headers(token),
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "validation_error"


async def test_attempt_no_flags_returns_400(client, db) -> None:
    code, round_id, _, token = await _start_round(client, db)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id},
        headers=manager_headers(token),
    )
    assert resp.status_code == 400


async def test_attempt_after_round_ended_returns_409(client, db) -> None:
    code, round_id, _, token = await _start_round(client, db)
    end = await client.post(
        f"/games/{code}/end-round",
        json={"round_id": round_id},
        headers=manager_headers(token),
    )
    assert end.status_code == 200
    resp = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "title_correct": True},
        headers=manager_headers(token),
    )
    assert resp.status_code == 409


async def test_attempt_manager_token_required(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, _ = await insert_game(db, status="playing", selected_genres=rock)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={
            "round_id": "00000000-0000-0000-0000-000000000000",
            "title_correct": True,
        },
    )
    assert resp.status_code == 401


async def test_end_round_idempotent(client, db) -> None:
    code, round_id, _, token = await _start_round(client, db)
    h = manager_headers(token)
    r1 = await client.post(f"/games/{code}/end-round", json={"round_id": round_id}, headers=h)
    assert r1.status_code == 200
    first_ended_at = r1.json()["ended_at"]

    r2 = await client.post(f"/games/{code}/end-round", json={"round_id": round_id}, headers=h)
    assert r2.status_code == 200
    assert r2.json()["ended_at"] == first_ended_at


async def test_end_round_unknown_round_returns_404(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    resp = await client.post(
        f"/games/{code}/end-round",
        json={"round_id": "00000000-0000-0000-0000-000000000001"},
        headers=manager_headers(token),
    )
    assert resp.status_code == 404


async def test_end_round_clears_buzz_lock(client, db) -> None:
    code, round_id, _, token = await _start_round(client, db)
    await client.post(
        f"/games/{code}/end-round",
        json={"round_id": round_id},
        headers=manager_headers(token),
    )
    locked = await db.fetchval(
        "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", code
    )
    assert locked is None


# ----- free-guess sweetener (migration 017) ----------------------------------


async def test_attempt_wrong_after_correct_no_penalty(client, db) -> None:
    """After any correct attempt, the next wrong returns 0 (free guess)."""
    rock = await fetch_genre_ids(db, slugs=["rock"])
    await insert_song(db, genre_slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    t1 = await insert_team(db, code, name="T1")
    t2 = await insert_team(db, code, name="T2")
    pick = await client.post(
        f"/games/{code}/select-song", json={}, headers=manager_headers(token)
    )
    round_id = pick.json()["round_id"]

    # T1 buzzes title correct -> activates the free-guess flag.
    await _force_buzz(db, code, round_id, t1)
    r1 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "title_correct": True},
        headers=manager_headers(token),
    )
    assert r1.status_code == 200
    assert r1.json()["points_awarded"] == 10

    # T2 buzzes wrong on artist -> 0 (free).
    await _force_buzz(db, code, round_id, t2)
    r2 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "wrong_buzz": True},
        headers=manager_headers(token),
    )
    assert r2.status_code == 200
    assert r2.json()["points_awarded"] == 0
    assert r2.json()["team_total_score"] == 0


async def test_attempt_wrong_before_any_correct_penalizes(client, db) -> None:
    """Wrong as the first attempt of the round still costs -3."""
    code, round_id, team_id, token = await _start_round(client, db)
    resp = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "wrong_buzz": True},
        headers=manager_headers(token),
    )
    assert resp.status_code == 200
    assert resp.json()["points_awarded"] == -3


async def test_attempt_free_guess_consumed_after_one_attempt(client, db) -> None:
    """The flag is consumed by the next attempt (whether correct or wrong)."""
    rock = await fetch_genre_ids(db, slugs=["rock"])
    await insert_song(db, genre_slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    t1 = await insert_team(db, code, name="T1")
    t2 = await insert_team(db, code, name="T2")
    t3 = await insert_team(db, code, name="T3")
    pick = await client.post(
        f"/games/{code}/select-song", json={}, headers=manager_headers(token)
    )
    round_id = pick.json()["round_id"]

    # T1 title -> flag on
    await _force_buzz(db, code, round_id, t1)
    await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "title_correct": True},
        headers=manager_headers(token),
    )
    # T2 wrong -> 0 (free), flag off
    await _force_buzz(db, code, round_id, t2)
    await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "wrong_buzz": True},
        headers=manager_headers(token),
    )
    # T3 wrong -> -3 (flag was consumed)
    await _force_buzz(db, code, round_id, t3)
    r3 = await client.post(
        f"/games/{code}/attempt",
        json={"round_id": round_id, "wrong_buzz": True},
        headers=manager_headers(token),
    )
    assert r3.status_code == 200
    assert r3.json()["points_awarded"] == -3


async def test_start_round_closes_prior_open_round(client, db) -> None:
    """If the manager advances without explicit end_round, the prior
    round's ended_at gets stamped by start_round automatically."""
    code, round_id, _, token = await _start_round(client, db)
    await insert_song(db, genre_slugs=["rock"])
    pick2 = await client.post(
        f"/games/{code}/select-song", json={}, headers=manager_headers(token)
    )
    assert pick2.status_code == 200
    prior = await db.fetchval(
        "SELECT ended_at FROM game_rounds WHERE id = $1", round_id
    )
    assert prior is not None
