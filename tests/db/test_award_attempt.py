"""award_attempt() and end_round(): the multi-buzz round model.

Spec: docs/rpc-functions.md §3 and db/migrations/016_multi_buzz_rounds.sql.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import call_buzz_in, create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker


async def _start_round_and_buzz(
    conn: asyncpg.Connection,
    game_code: str,
    team_id: uuid.UUID,
) -> uuid.UUID:
    """Start a round and have one team buzz in. Returns the round id."""
    song_id = await create_test_song(conn, youtube_id=uuid.uuid4().hex[:11])
    round_id = await conn.fetchval("SELECT start_round($1, $2)", game_code, song_id)
    assert round_id is not None
    await call_buzz_in(conn, game_code, team_id)
    return round_id


async def _force_buzz(conn: asyncpg.Connection, game_code: str, round_id, team_id) -> None:
    """Re-arm the buzz lock onto a specific team without going through buzz_in."""
    await conn.execute(
        "UPDATE active_games SET buzzed_team_id = $1, locked_at = now() WHERE game_code = $2",
        team_id,
        game_code,
    )
    await conn.execute(
        "UPDATE game_rounds SET buzzed_team_id = $1 WHERE id = $2",
        team_id,
        round_id,
    )


@pytest.mark.asyncio
async def test_award_attempt_title_only(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    rows = await db.fetch(
        "SELECT team_id, points_delta, team_total_score, title_claimed_by, artist_claimed_by "
        "FROM award_attempt($1, $2, 10, 0, 0)",
        game_code,
        round_id,
    )
    assert len(rows) == 1
    assert rows[0]["team_id"] == team_id
    assert rows[0]["points_delta"] == 10
    assert rows[0]["team_total_score"] == 10
    assert rows[0]["title_claimed_by"] == team_id
    assert rows[0]["artist_claimed_by"] is None

    # Round stays open after a single attempt. Per migration 018 the buzz
    # lock is NOT cleared on the title-correct path -- the answering team
    # retains the floor for the artist token until the manager presses
    # Continue (release_buzz_lock) or Wrong.
    round_row = await db.fetchrow(
        "SELECT title_claimed_by, ended_at FROM game_rounds WHERE id = $1", round_id
    )
    assert round_row["title_claimed_by"] == team_id
    assert round_row["ended_at"] is None
    game = await db.fetchrow(
        "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", game_code
    )
    assert game["buzzed_team_id"] == team_id


@pytest.mark.asyncio
async def test_award_attempt_artist_only(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    rows = await db.fetch(
        "SELECT points_delta, team_total_score, artist_claimed_by "
        "FROM award_attempt($1, $2, 0, 5, 0)",
        game_code,
        round_id,
    )
    assert rows[0]["points_delta"] == 5
    assert rows[0]["team_total_score"] == 5
    assert rows[0]["artist_claimed_by"] == team_id


@pytest.mark.asyncio
async def test_award_attempt_both_tokens_atomic(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    rows = await db.fetch(
        "SELECT points_delta, title_claimed_by, artist_claimed_by "
        "FROM award_attempt($1, $2, 10, 5, 0)",
        game_code,
        round_id,
    )
    assert rows[0]["points_delta"] == 15
    assert rows[0]["title_claimed_by"] == team_id
    assert rows[0]["artist_claimed_by"] == team_id


@pytest.mark.asyncio
async def test_award_attempt_wrong_buzz_no_lockout(db: asyncpg.Connection) -> None:
    """A wrong buzz costs -3 but does not prevent the same team from buzzing again."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    await db.execute("UPDATE game_teams SET score = 10 WHERE id = $1", team_id)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    rows = await db.fetch(
        "SELECT team_id, points_delta, team_total_score "
        "FROM award_attempt($1, $2, 0, 0, 3)",
        game_code,
        round_id,
    )
    assert rows[0]["team_id"] == team_id
    assert rows[0]["points_delta"] == -3
    assert rows[0]["team_total_score"] == 7

    # An attempt row was logged; the round is still open.
    attempts = await db.fetch(
        "SELECT outcome, points_delta FROM game_round_attempts WHERE round_id = $1",
        round_id,
    )
    assert len(attempts) == 1
    assert attempts[0]["outcome"] == "wrong"
    assert attempts[0]["points_delta"] == -3

    # Same team can buzz and try again.
    await call_buzz_in(db, game_code, team_id)
    rows2 = await db.fetch(
        "SELECT points_delta FROM award_attempt($1, $2, 10, 0, 0)",
        game_code,
        round_id,
    )
    assert rows2[0]["points_delta"] == 10


@pytest.mark.asyncio
async def test_award_attempt_two_teams_split_tokens(db: asyncpg.Connection) -> None:
    """T1 claims TITLE, T2 claims ARTIST on the same round."""
    game_code = await create_test_game(db, status="playing")
    t1 = await create_test_team(db, game_code, name="T1")
    t2 = await create_test_team(db, game_code, name="T2")

    round_id = await _start_round_and_buzz(db, game_code, t1)
    await db.execute("SELECT award_attempt($1, $2, 10, 0, 0)", game_code, round_id)

    await _force_buzz(db, game_code, round_id, t2)
    await db.execute("SELECT award_attempt($1, $2, 0, 5, 0)", game_code, round_id)

    row = await db.fetchrow(
        "SELECT title_claimed_by, artist_claimed_by FROM game_rounds WHERE id = $1",
        round_id,
    )
    assert row["title_claimed_by"] == t1
    assert row["artist_claimed_by"] == t2

    t1_score = await db.fetchval("SELECT score FROM game_teams WHERE id = $1", t1)
    t2_score = await db.fetchval("SELECT score FROM game_teams WHERE id = $1", t2)
    assert t1_score == 10
    assert t2_score == 5


@pytest.mark.asyncio
async def test_award_attempt_title_already_claimed_raises(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    t1 = await create_test_team(db, game_code, name="T1")
    t2 = await create_test_team(db, game_code, name="T2")
    round_id = await _start_round_and_buzz(db, game_code, t1)

    await db.execute("SELECT award_attempt($1, $2, 10, 0, 0)", game_code, round_id)
    await _force_buzz(db, game_code, round_id, t2)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT award_attempt($1, $2, 10, 0, 0)", game_code, round_id)
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_attempt_wrong_with_correct_raises(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute(
            "SELECT award_attempt($1, $2, 10, 0, 3)", game_code, round_id
        )
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_attempt_no_buzz_held_raises(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    await create_test_team(db, game_code)
    song_id = await create_test_song(db)
    round_id = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)

    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT award_attempt($1, $2, 10, 0, 0)", game_code, round_id)
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_attempt_round_not_found_raises(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute(
            "SELECT award_attempt($1, $2, 10, 0, 0)",
            game_code,
            uuid.uuid4(),
        )
    assert exc.value.sqlstate == "P0002"


@pytest.mark.asyncio
async def test_end_round_closes_open_round(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    await create_test_team(db, game_code)
    song_id = await create_test_song(db)
    round_id = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)

    ended_at = await db.fetchval(
        "SELECT end_round($1, $2)", game_code, round_id
    )
    assert ended_at is not None

    row = await db.fetchrow(
        "SELECT ended_at FROM game_rounds WHERE id = $1", round_id
    )
    assert row["ended_at"] == ended_at


@pytest.mark.asyncio
async def test_end_round_idempotent(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    await create_test_team(db, game_code)
    song_id = await create_test_song(db)
    round_id = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)

    first = await db.fetchval("SELECT end_round($1, $2)", game_code, round_id)
    second = await db.fetchval("SELECT end_round($1, $2)", game_code, round_id)
    assert first == second


@pytest.mark.asyncio
async def test_award_attempt_after_end_round_raises(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    await db.execute("SELECT end_round($1, $2)", game_code, round_id)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT award_attempt($1, $2, 10, 0, 0)", game_code, round_id)
    assert exc.value.sqlstate == "P0001"


# ----- free-guess sweetener (migration 017) ----------------------------------


@pytest.mark.asyncio
async def test_award_attempt_wrong_before_correct_penalizes(
    db: asyncpg.Connection,
) -> None:
    """A wrong buzz with no prior correct in the round costs the full -3."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    rows = await db.fetch(
        "SELECT points_delta FROM award_attempt($1, $2, 0, 0, 3)",
        game_code,
        round_id,
    )
    assert rows[0]["points_delta"] == -3


@pytest.mark.asyncio
async def test_award_attempt_wrong_after_correct_no_penalty(
    db: asyncpg.Connection,
) -> None:
    """After any correct attempt, the next wrong waives the -3 penalty."""
    game_code = await create_test_game(db, status="playing")
    t1 = await create_test_team(db, game_code, name="T1")
    t2 = await create_test_team(db, game_code, name="T2")
    round_id = await _start_round_and_buzz(db, game_code, t1)

    # T1 scores title correct -> activates free_guess flag for the round.
    await db.execute("SELECT award_attempt($1, $2, 10, 0, 0)", game_code, round_id)

    # T2 buzzes wrong on artist -> free, delta = 0.
    await _force_buzz(db, game_code, round_id, t2)
    rows = await db.fetch(
        "SELECT points_delta FROM award_attempt($1, $2, 0, 0, 3)",
        game_code,
        round_id,
    )
    assert rows[0]["points_delta"] == 0
    # Score did not move.
    t2_score = await db.fetchval("SELECT score FROM game_teams WHERE id = $1", t2)
    assert t2_score == 0


@pytest.mark.asyncio
async def test_award_attempt_free_guess_clears_after_one_attempt(
    db: asyncpg.Connection,
) -> None:
    """Flag is consumed by the next attempt regardless of outcome."""
    game_code = await create_test_game(db, status="playing")
    t1 = await create_test_team(db, game_code, name="T1")
    t2 = await create_test_team(db, game_code, name="T2")
    t3 = await create_test_team(db, game_code, name="T3")
    round_id = await _start_round_and_buzz(db, game_code, t1)

    # T1 title -> flag on
    await db.execute("SELECT award_attempt($1, $2, 10, 0, 0)", game_code, round_id)

    # T2 wrong -> 0 (free), flag off
    await _force_buzz(db, game_code, round_id, t2)
    await db.execute("SELECT award_attempt($1, $2, 0, 0, 3)", game_code, round_id)

    # T3 wrong -> -3 (flag was consumed)
    await _force_buzz(db, game_code, round_id, t3)
    rows = await db.fetch(
        "SELECT points_delta FROM award_attempt($1, $2, 0, 0, 3)",
        game_code,
        round_id,
    )
    assert rows[0]["points_delta"] == -3


@pytest.mark.asyncio
async def test_award_attempt_free_guess_reactivates_on_subsequent_correct(
    db: asyncpg.Connection,
) -> None:
    """Wrong consumes the flag; a later correct re-activates it for the next attempt."""
    game_code = await create_test_game(db, status="playing")
    t1 = await create_test_team(db, game_code, name="T1")
    t2 = await create_test_team(db, game_code, name="T2")
    round_id = await _start_round_and_buzz(db, game_code, t1)

    # T1 title -> flag on. T2 wrong -> free, flag off.
    await db.execute("SELECT award_attempt($1, $2, 10, 0, 0)", game_code, round_id)
    await _force_buzz(db, game_code, round_id, t2)
    await db.execute("SELECT award_attempt($1, $2, 0, 0, 3)", game_code, round_id)

    # T2 artist correct -> flag re-activates.
    await _force_buzz(db, game_code, round_id, t2)
    await db.execute("SELECT award_attempt($1, $2, 0, 5, 0)", game_code, round_id)

    # T1 wrong on the (now exhausted) round? Both tokens claimed, so wrong is the only valid call.
    await _force_buzz(db, game_code, round_id, t1)
    rows = await db.fetch(
        "SELECT points_delta FROM award_attempt($1, $2, 0, 0, 3)",
        game_code,
        round_id,
    )
    assert rows[0]["points_delta"] == 0  # free again, the just-correct attempt re-armed it


# ----- migration 018: split scoring from buzz-lock release ------------------


@pytest.mark.asyncio
async def test_award_attempt_artist_correct_keeps_lock(db: asyncpg.Connection) -> None:
    """Per migration 018, an artist-correct attempt also keeps the lock held."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    await db.execute("SELECT award_attempt($1, $2, 0, 5, 0)", game_code, round_id)

    locked = await db.fetchval(
        "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", game_code
    )
    assert locked == team_id


@pytest.mark.asyncio
async def test_award_attempt_wrong_clears_lock(db: asyncpg.Connection) -> None:
    """Wrong is still the re-arm path: it clears active_games.buzzed_team_id."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    await db.execute("SELECT award_attempt($1, $2, 0, 0, 3)", game_code, round_id)

    locked = await db.fetchval(
        "SELECT buzzed_team_id, locked_at FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert locked is None


@pytest.mark.asyncio
async def test_release_buzz_lock_clears_held_buzz(db: asyncpg.Connection) -> None:
    """release_buzz_lock is the explicit unlock path used by POST /continue."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    # Sanity: lock is held after buzz_in.
    assert (
        await db.fetchval(
            "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", game_code
        )
        == team_id
    )

    await db.execute("SELECT release_buzz_lock($1)", game_code)

    row = await db.fetchrow(
        "SELECT buzzed_team_id, locked_at FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert row["buzzed_team_id"] is None
    assert row["locked_at"] is None
    # Round is untouched.
    round_row = await db.fetchrow(
        "SELECT ended_at FROM game_rounds WHERE id = $1", round_id
    )
    assert round_row["ended_at"] is None


@pytest.mark.asyncio
async def test_release_buzz_lock_idempotent(db: asyncpg.Connection) -> None:
    """release_buzz_lock is a no-op when no buzz is held; safe to call repeatedly."""
    game_code = await create_test_game(db, status="playing")
    await create_test_team(db, game_code)

    # Called with no buzz held: no-op, no exception.
    await db.execute("SELECT release_buzz_lock($1)", game_code)
    await db.execute("SELECT release_buzz_lock($1)", game_code)


@pytest.mark.asyncio
async def test_start_round_closes_prior_open_round(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    song_id = await create_test_song(db)
    first_round = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)
    song_id2 = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])
    await db.fetchval("SELECT start_round($1, $2)", game_code, song_id2)

    row = await db.fetchrow(
        "SELECT ended_at FROM game_rounds WHERE id = $1", first_round
    )
    assert row["ended_at"] is not None
