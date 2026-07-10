"""award_attempt() and end_round(): the multi-buzz round model.

Spec: docs/rpc-functions.md §3 and db/migrations/016_multi_buzz_rounds.sql.
Migration 021 added the ``p_manager_token`` argument so the browser can call
``award_attempt`` / ``release_buzz_lock`` directly without going through
FastAPI; the function validates the token internally. Every call in this
file passes the per-game token via ``fetch_manager_token``.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import (
    call_buzz_in,
    create_test_game,
    create_test_song,
    create_test_team,
    fetch_manager_token,
)

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


async def _attempt(
    conn: asyncpg.Connection,
    game_code: str,
    round_id,
    title: bool,
    artist: bool,
    wrong: bool,
) -> list[asyncpg.Record]:
    """Convenience: call ``award_attempt`` with the game's own manager_token.

    Migration 043 made the DB the authority for the point magnitudes: the
    boolean overload ``award_attempt(text, uuid, boolean, boolean, boolean,
    uuid)`` takes flags and derives 10 / 5 / 3 server-side, and migration 044
    dropped the old integer overload so the boolean signature is now the only
    one (the full migration set — including 044 — is applied before any test
    runs). The ``::boolean`` casts are retained to document intent; before
    mig 044 they were needed to disambiguate the two overloads, and they still
    route to the sole boolean overload. Tests that exercise *token validation*
    call the RPC directly with the explicit 6th arg instead of using this helper.
    """
    token = await fetch_manager_token(conn, game_code)
    return await conn.fetch(
        "SELECT team_id, points_delta, team_total_score, title_claimed_by, "
        "artist_claimed_by FROM award_attempt($1, $2, $3::boolean, $4::boolean, "
        "$5::boolean, $6)",
        game_code,
        round_id,
        title,
        artist,
        wrong,
        token,
    )


async def _release(conn: asyncpg.Connection, game_code: str) -> None:
    token = await fetch_manager_token(conn, game_code)
    await conn.execute("SELECT release_buzz_lock($1, $2)", game_code, token)


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

    rows = await _attempt(db, game_code, round_id, True, False, False)
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

    rows = await _attempt(db, game_code, round_id, False, True, False)
    assert rows[0]["points_delta"] == 5
    assert rows[0]["team_total_score"] == 5
    assert rows[0]["artist_claimed_by"] == team_id


@pytest.mark.asyncio
async def test_award_attempt_both_tokens_atomic(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    rows = await _attempt(db, game_code, round_id, True, True, False)
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

    rows = await _attempt(db, game_code, round_id, False, False, True)
    assert rows[0]["team_id"] == team_id
    assert rows[0]["points_delta"] == -3
    assert rows[0]["team_total_score"] == 7

    attempts = await db.fetch(
        "SELECT outcome, points_delta FROM game_round_attempts WHERE round_id = $1",
        round_id,
    )
    assert len(attempts) == 1
    assert attempts[0]["outcome"] == "wrong"
    assert attempts[0]["points_delta"] == -3

    # Same team can buzz and try again.
    await call_buzz_in(db, game_code, team_id)
    rows2 = await _attempt(db, game_code, round_id, True, False, False)
    assert rows2[0]["points_delta"] == 10


@pytest.mark.asyncio
async def test_award_attempt_two_teams_split_tokens(db: asyncpg.Connection) -> None:
    """T1 claims TITLE, T2 claims ARTIST on the same round."""
    game_code = await create_test_game(db, status="playing")
    t1 = await create_test_team(db, game_code, name="T1")
    t2 = await create_test_team(db, game_code, name="T2")

    round_id = await _start_round_and_buzz(db, game_code, t1)
    await _attempt(db, game_code, round_id, True, False, False)

    await _force_buzz(db, game_code, round_id, t2)
    await _attempt(db, game_code, round_id, False, True, False)

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

    await _attempt(db, game_code, round_id, True, False, False)
    await _force_buzz(db, game_code, round_id, t2)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _attempt(db, game_code, round_id, True, False, False)
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_attempt_wrong_with_correct_raises(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    with pytest.raises(asyncpg.PostgresError) as exc:
        await _attempt(db, game_code, round_id, True, False, True)
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_attempt_no_buzz_held_raises(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    await create_test_team(db, game_code)
    song_id = await create_test_song(db)
    round_id = await db.fetchval("SELECT start_round($1, $2)", game_code, song_id)

    with pytest.raises(asyncpg.PostgresError) as exc:
        await _attempt(db, game_code, round_id, True, False, False)
    assert exc.value.sqlstate == "P0001"


@pytest.mark.asyncio
async def test_award_attempt_round_not_found_raises(
    db: asyncpg.Connection,
) -> None:
    game_code = await create_test_game(db, status="playing")
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _attempt(db, game_code, uuid.uuid4(), True, False, False)
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
        await _attempt(db, game_code, round_id, True, False, False)
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

    rows = await _attempt(db, game_code, round_id, False, False, True)
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
    await _attempt(db, game_code, round_id, True, False, False)

    # T2 buzzes wrong on artist -> free, delta = 0.
    await _force_buzz(db, game_code, round_id, t2)
    rows = await _attempt(db, game_code, round_id, False, False, True)
    assert rows[0]["points_delta"] == 0
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
    await _attempt(db, game_code, round_id, True, False, False)

    # T2 wrong -> 0 (free), flag off
    await _force_buzz(db, game_code, round_id, t2)
    await _attempt(db, game_code, round_id, False, False, True)

    # T3 wrong -> -3 (flag was consumed)
    await _force_buzz(db, game_code, round_id, t3)
    rows = await _attempt(db, game_code, round_id, False, False, True)
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
    await _attempt(db, game_code, round_id, True, False, False)
    await _force_buzz(db, game_code, round_id, t2)
    await _attempt(db, game_code, round_id, False, False, True)

    # T2 artist correct -> flag re-activates.
    await _force_buzz(db, game_code, round_id, t2)
    await _attempt(db, game_code, round_id, False, True, False)

    # T1 wrong on the (now exhausted) round? Both tokens claimed, so wrong is the only valid call.
    await _force_buzz(db, game_code, round_id, t1)
    rows = await _attempt(db, game_code, round_id, False, False, True)
    assert rows[0]["points_delta"] == 0


# ----- migration 036: collapse writes into one combined UPDATE ---------------


@pytest.mark.asyncio
async def test_award_attempt_combined_update_preserves_unset_columns(
    db: asyncpg.Connection,
) -> None:
    """Migration 036 folds the per-token writes into one CASE-based UPDATE. A
    title-only attempt must set title_claimed_by/title_points + free_guess_active
    while leaving the artist columns and wrong_buzz_penalty untouched; a later
    wrong on the same round must flip free_guess_active off and stamp the penalty
    while KEEPING the earlier title claim."""
    game_code = await create_test_game(db, status="playing")
    t1 = await create_test_team(db, game_code, name="T1")
    t2 = await create_test_team(db, game_code, name="T2")
    round_id = await _start_round_and_buzz(db, game_code, t1)

    await _attempt(db, game_code, round_id, True, False, False)
    row = await db.fetchrow(
        "SELECT title_claimed_by, title_points, artist_claimed_by, artist_points, "
        "wrong_buzz_penalty, free_guess_active FROM game_rounds WHERE id = $1",
        round_id,
    )
    assert row["title_claimed_by"] == t1
    assert row["title_points"] == 10
    assert row["artist_claimed_by"] is None      # untouched by a title-only attempt
    assert row["artist_points"] == 0
    assert row["wrong_buzz_penalty"] == 0
    assert row["free_guess_active"] is True       # armed by the correct attempt

    # A wrong on the same round: penalty is waived (free-guess), free_guess flips
    # off, and the earlier title claim is preserved (CASE ELSE keeps it).
    await _force_buzz(db, game_code, round_id, t2)
    await _attempt(db, game_code, round_id, False, False, True)
    row2 = await db.fetchrow(
        "SELECT title_claimed_by, wrong_buzz_penalty, free_guess_active "
        "FROM game_rounds WHERE id = $1",
        round_id,
    )
    assert row2["title_claimed_by"] == t1         # unchanged
    assert row2["wrong_buzz_penalty"] == 3
    assert row2["free_guess_active"] is False


@pytest.mark.asyncio
async def test_award_attempt_noop_continue_writes_nothing_to_round(
    db: asyncpg.Connection,
) -> None:
    """A no-toggle, no-wrong call with free_guess already false must not write
    game_rounds at all (mig 036): the round row is byte-identical afterwards, so
    no redundant ROUND_CHANGE is fanned out."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    before = await db.fetchrow(
        "SELECT title_claimed_by, artist_claimed_by, title_points, artist_points, "
        "wrong_buzz_penalty, free_guess_active FROM game_rounds WHERE id = $1",
        round_id,
    )
    await _attempt(db, game_code, round_id, False, False, False)
    after = await db.fetchrow(
        "SELECT title_claimed_by, artist_claimed_by, title_points, artist_points, "
        "wrong_buzz_penalty, free_guess_active FROM game_rounds WHERE id = $1",
        round_id,
    )
    assert dict(before) == dict(after)


# ----- migration 018: split scoring from buzz-lock release ------------------


@pytest.mark.asyncio
async def test_award_attempt_artist_correct_keeps_lock(db: asyncpg.Connection) -> None:
    """Per migration 018, an artist-correct attempt also keeps the lock held."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    await _attempt(db, game_code, round_id, False, True, False)

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

    await _attempt(db, game_code, round_id, False, False, True)

    locked = await db.fetchval(
        "SELECT buzzed_team_id, locked_at FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert locked is None


# ----- migration 019: refresh locked_at on a correct attempt -----------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "title_correct, artist_correct",
    [(True, False), (False, True), (True, True)],
    ids=["title", "artist", "both"],
)
async def test_award_attempt_correct_refreshes_locked_at(
    db: asyncpg.Connection, title_correct: bool, artist_correct: bool
) -> None:
    """A correct attempt keeps the buzzing team on the floor but bumps
    locked_at so the clients' answer countdown restarts for the other token."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    # Make locked_at stale so the refresh is observable.
    await db.execute(
        "UPDATE active_games SET locked_at = now() - interval '30 seconds' "
        "WHERE game_code = $1",
        game_code,
    )

    await _attempt(db, game_code, round_id, title_correct, artist_correct, False)

    row = await db.fetchrow(
        "SELECT buzzed_team_id, locked_at, "
        "locked_at >= now() - interval '5 seconds' AS fresh "
        "FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert row["buzzed_team_id"] == team_id  # same team keeps the floor
    assert row["locked_at"] is not None
    assert row["fresh"] is True              # locked_at was refreshed to ~now()


@pytest.mark.asyncio
async def test_award_attempt_noop_continue_leaves_lock_untouched(
    db: asyncpg.Connection,
) -> None:
    """A no-toggle, no-wrong call neither clears nor refreshes the lock."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    await db.execute(
        "UPDATE active_games SET locked_at = now() - interval '30 seconds' "
        "WHERE game_code = $1",
        game_code,
    )
    await _attempt(db, game_code, round_id, False, False, False)

    row = await db.fetchrow(
        "SELECT buzzed_team_id, "
        "locked_at < now() - interval '20 seconds' AS still_stale "
        "FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert row["buzzed_team_id"] == team_id
    assert row["still_stale"] is True


@pytest.mark.asyncio
async def test_release_buzz_lock_clears_held_buzz(db: asyncpg.Connection) -> None:
    """release_buzz_lock is the explicit unlock path used by the manager's Continue button."""
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

    await _release(db, game_code)

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
    await _release(db, game_code)
    await _release(db, game_code)


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


# ----- migration 021: manager-token check inside the RPC --------------------


@pytest.mark.asyncio
async def test_award_attempt_wrong_token_raises(db: asyncpg.Connection) -> None:
    """The browser calls award_attempt directly with an X-Manager-Token-like
    arg; a forged/mismatched token must be rejected before any side effect."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    bogus = uuid.uuid4()
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetch(
            "SELECT points_delta FROM award_attempt($1, $2, true, false, false, $3)",
            game_code,
            round_id,
            bogus,
        )
    # SQLSTATE '28000' is invalid_authorization_specification.
    assert exc.value.sqlstate == "28000"
    # Side effects must not have happened: the team's score is still 0.
    score = await db.fetchval("SELECT score FROM game_teams WHERE id = $1", team_id)
    assert score == 0


@pytest.mark.asyncio
async def test_award_attempt_null_token_raises(db: asyncpg.Connection) -> None:
    """Passing NULL for the token must be rejected, not treated as 'skip the check'."""
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    round_id = await _start_round_and_buzz(db, game_code, team_id)

    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetch(
            "SELECT points_delta FROM award_attempt($1, $2, true, false, false, $3)",
            game_code,
            round_id,
            None,
        )
    assert exc.value.sqlstate == "28000"


@pytest.mark.asyncio
async def test_award_attempt_unknown_game_raises(db: asyncpg.Connection) -> None:
    """Token check fires before round lookup; the error is 'game_not_found', not
    'manager_token_required', when no row exists for the code at all."""
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.fetch(
            "SELECT points_delta FROM award_attempt($1, $2, true, false, false, $3)",
            "ZZZZZZ",
            uuid.uuid4(),
            uuid.uuid4(),
        )
    assert exc.value.sqlstate == "P0002"


@pytest.mark.asyncio
async def test_release_buzz_lock_wrong_token_raises(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, game_code)
    await _start_round_and_buzz(db, game_code, team_id)

    bogus = uuid.uuid4()
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT release_buzz_lock($1, $2)", game_code, bogus)
    assert exc.value.sqlstate == "28000"
    # Lock is still held; the rejected call must not have unlocked the room.
    locked = await db.fetchval(
        "SELECT buzzed_team_id FROM active_games WHERE game_code = $1", game_code
    )
    assert locked == team_id
