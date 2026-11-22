"""Automatic round advances may consume a candidate from one round only."""

from __future__ import annotations

import asyncio
import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, fetch_manager_token

pytestmark = [pytest.mark.needs_docker, pytest.mark.asyncio]

PICK = "SELECT song_id, expected_round FROM peek_next_song($1, $2)"
ADVANCE = "SELECT song_id FROM select_next_song($1, $2, $3, $4)"
LEGACY = "SELECT song_id FROM select_next_song($1, $2, $3)"


async def _game(db: asyncpg.Connection) -> tuple[str, uuid.UUID, uuid.UUID]:
    rock = await db.fetchval("SELECT id FROM genres WHERE slug = 'rock'")
    game = await create_test_game(db, status="waiting")
    await db.execute(
        "UPDATE active_games SET selected_genres = ARRAY[$1]::uuid[], "
        "selected_decades = '{1990}' WHERE game_code = $2",
        rock,
        game,
    )
    return game, await fetch_manager_token(db, game), rock


async def _song(db: asyncpg.Connection, genre: uuid.UUID, *, year: int = 1995) -> uuid.UUID:
    song = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11], release_year=year)
    await db.execute("INSERT INTO song_genres VALUES ($1, $2)", song, genre)
    return song


async def test_peek_commits_the_exact_song_for_its_round(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game, token, genre = await _game(db)
    first = await _song(db, genre)
    second = await _song(db, genre)

    peek = await anon_conn.fetchrow(PICK, game, token)
    assert peek is not None and peek["expected_round"] == 0
    assert await anon_conn.fetchval(ADVANCE, game, token, peek["song_id"], 0) == peek["song_id"]
    assert await anon_conn.fetchval(ADVANCE, game, token, None, 1) == (
        second if peek["song_id"] == first else first
    )
    with pytest.raises(asyncpg.PostgresError, match="no_more_songs"):
        await anon_conn.fetchval(ADVANCE, game, token, None, 2)

    with pytest.raises(asyncpg.PostgresError, match="stale_round"):
        await anon_conn.fetchval(ADVANCE, game, token, peek["song_id"], 0)
    assert await db.fetchval("SELECT round_number FROM active_games WHERE game_code=$1", game) == 2


async def test_simultaneous_advances_can_only_commit_one_round(
    db: asyncpg.Connection, pool: asyncpg.Pool
) -> None:
    game, token, genre = await _game(db)
    song = await _song(db, genre)
    await _song(db, genre)
    results = await asyncio.gather(
        pool.fetchval(ADVANCE, game, token, song, 0),
        pool.fetchval(ADVANCE, game, token, None, 0),
        return_exceptions=True,
    )

    assert len([result for result in results if isinstance(result, uuid.UUID)]) == 1
    failures = [result for result in results if isinstance(result, asyncpg.PostgresError)]
    assert [str(failure) for failure in failures] == ["stale_round"]
    assert await db.fetchval("SELECT count(*) FROM game_rounds WHERE game_code=$1", game) == 1


async def test_guarded_candidate_must_still_be_eligible(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    game, token, rock = await _game(db)
    pop = await db.fetchval("SELECT id FROM genres WHERE slug = 'pop'")
    played = await _song(db, rock)
    unavailable = await _song(db, rock)
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id=$1", unavailable)
    wrong_decade = await _song(db, rock, year=1982)
    wrong_genre = await _song(db, pop)

    await anon_conn.fetchval(ADVANCE, game, token, played, 0)
    for candidate in (played, unavailable, wrong_decade, wrong_genre, uuid.uuid4()):
        with pytest.raises(asyncpg.PostgresError, match="song_no_longer_eligible"):
            await anon_conn.fetchval(ADVANCE, game, token, candidate, 1)
    with pytest.raises(asyncpg.PostgresError, match="manager_token_required"):
        await anon_conn.fetchval(ADVANCE, game, uuid.uuid4(), None, 1)
    assert await db.fetchval("SELECT round_number FROM active_games WHERE game_code=$1", game) == 1

    assert await anon_conn.fetchval(LEGACY, game, token, unavailable) == unavailable
