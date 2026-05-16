"""select_next_song(): direct-RPC "Next round" / "Start game" path.

Spec: docs/rpc-functions.md (§3b after this PR) and
db/migrations/022_select_next_song_rpc.sql.

The function takes (p_game_code text, p_manager_token uuid, p_song_id uuid)
and returns one row describing the new round + song. p_song_id has a
DEFAULT NULL; passing NULL means "pick a random unplayed song from the
selected genres", passing a value means "use this exact song".

Coverage:
  * happy paths: random pick, manual pick
  * token validation: right token, wrong token, null token
  * game-state errors: game_not_found, game_ended, no_genres_selected
  * song-pool errors: no_more_songs (random), song_not_found (manual)
  * delegation behavior: closes any still-open prior round (start_round
    already does this; we just confirm select_next_song composes correctly)
  * genre filter: random pick never returns a song outside selected_genres
    nor a song already played in this game
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import (
    create_test_game,
    create_test_song,
    fetch_manager_token,
)

pytestmark = pytest.mark.needs_docker


async def _genre_ids(conn: asyncpg.Connection, *slugs: str) -> list[uuid.UUID]:
    rows = await conn.fetch(
        "SELECT id FROM genres WHERE slug = ANY($1::text[]) ORDER BY slug", list(slugs)
    )
    return [r["id"] for r in rows]


async def _attach_song_to_genre(
    conn: asyncpg.Connection, song_id: uuid.UUID, genre_id: uuid.UUID
) -> None:
    await conn.execute(
        "INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2) "
        "ON CONFLICT (song_id, genre_id) DO NOTHING",
        song_id,
        genre_id,
    )


async def _set_selected_genres(
    conn: asyncpg.Connection, game_code: str, genre_ids: list[uuid.UUID]
) -> None:
    await conn.execute(
        "UPDATE active_games SET selected_genres = $1::uuid[] WHERE game_code = $2",
        genre_ids,
        game_code,
    )


async def _seed_game_with_one_song(
    conn: asyncpg.Connection,
    *,
    status: str = "waiting",
    extra_songs: int = 0,
) -> tuple[str, list[uuid.UUID]]:
    """Set up an active_games row + one genre + N+1 songs all in that genre.

    Returns (game_code, [song_ids]). The conftest re-seeds genres on every
    function-scoped fixture, so the canonical 'rock' slug is always present.
    """
    game_code = await create_test_game(conn, status=status)
    rock = (await _genre_ids(conn, "rock"))[0]
    await _set_selected_genres(conn, game_code, [rock])
    songs: list[uuid.UUID] = []
    for i in range(extra_songs + 1):
        sid = await create_test_song(conn, youtube_id=uuid.uuid4().hex[:11])
        await _attach_song_to_genre(conn, sid, rock)
        songs.append(sid)
    return game_code, songs


async def _call(
    conn: asyncpg.Connection,
    game_code: str,
    token: uuid.UUID,
    song_id: uuid.UUID | None = None,
) -> list[asyncpg.Record]:
    return await conn.fetch(
        "SELECT round_id, round_number, song_id, song_title, song_artist, "
        "youtube_id, start_time, is_soundtrack, source "
        "FROM select_next_song($1, $2, $3)",
        game_code,
        token,
        song_id,
    )


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_random_pick_returns_a_song_in_selected_genres(db: asyncpg.Connection) -> None:
    game_code, songs = await _seed_game_with_one_song(db, extra_songs=2)
    token = await fetch_manager_token(db, game_code)

    rows = await _call(db, game_code, token)
    assert len(rows) == 1
    row = rows[0]
    assert row["song_id"] in songs
    assert row["round_number"] == 1
    assert row["round_id"] is not None

    # active_games was advanced as a side effect (via start_round).
    game = await db.fetchrow(
        "SELECT status, round_number, current_round_id, current_song_id, "
        "buzzed_team_id, locked_at FROM active_games WHERE game_code = $1",
        game_code,
    )
    assert game["status"] == "playing"
    assert game["round_number"] == 1
    assert game["current_round_id"] == row["round_id"]
    assert game["current_song_id"] == row["song_id"]
    assert game["buzzed_team_id"] is None
    assert game["locked_at"] is None


@pytest.mark.asyncio
async def test_random_pick_excludes_already_played_songs(db: asyncpg.Connection) -> None:
    """A song that was used in a prior round of this game must not be picked
    again. Verified by seeding 2 songs, playing one, then asserting the next
    random pick lands on the other."""
    game_code, songs = await _seed_game_with_one_song(db, extra_songs=1)
    token = await fetch_manager_token(db, game_code)
    assert len(songs) == 2
    first, second = songs

    # Manually pick the first song.
    rows = await _call(db, game_code, token, song_id=first)
    assert rows[0]["song_id"] == first

    # Random pick must now choose the only remaining unplayed song.
    rows = await _call(db, game_code, token)
    assert rows[0]["song_id"] == second
    assert rows[0]["round_number"] == 2


@pytest.mark.asyncio
async def test_manual_pick_uses_supplied_song(db: asyncpg.Connection) -> None:
    """Passing p_song_id forces that exact song, even if it's outside the
    selected genres -- mirrors the legacy REST manual-pick semantics."""
    game_code, _ = await _seed_game_with_one_song(db)
    token = await fetch_manager_token(db, game_code)
    # Create a song deliberately NOT attached to the rock genre.
    detached = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])

    rows = await _call(db, game_code, token, song_id=detached)
    assert rows[0]["song_id"] == detached


@pytest.mark.asyncio
async def test_random_pick_advances_round_number(db: asyncpg.Connection) -> None:
    game_code, _ = await _seed_game_with_one_song(db, extra_songs=2)
    token = await fetch_manager_token(db, game_code)

    rows1 = await _call(db, game_code, token)
    rows2 = await _call(db, game_code, token)
    rows3 = await _call(db, game_code, token)
    assert rows1[0]["round_number"] == 1
    assert rows2[0]["round_number"] == 2
    assert rows3[0]["round_number"] == 3
    # Round ids are distinct.
    assert len({r[0]["round_id"] for r in (rows1, rows2, rows3)}) == 3


# ---------------------------------------------------------------------------
# Composition with start_round: prior open round is closed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_closes_prior_open_round(db: asyncpg.Connection) -> None:
    """start_round (called inside select_next_song) closes any still-open
    prior round defensively. We assert that observed behavior to lock the
    composition contract."""
    game_code, _ = await _seed_game_with_one_song(db, extra_songs=2)
    token = await fetch_manager_token(db, game_code)

    rows1 = await _call(db, game_code, token)
    prior_round = rows1[0]["round_id"]

    # Advance without explicit end_round.
    await _call(db, game_code, token)

    ended_at = await db.fetchval("SELECT ended_at FROM game_rounds WHERE id = $1", prior_round)
    assert ended_at is not None


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wrong_token_raises_manager_token_required(db: asyncpg.Connection) -> None:
    game_code, _ = await _seed_game_with_one_song(db)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _call(db, game_code, uuid.uuid4())
    assert exc.value.sqlstate == "28000"
    assert "manager_token_required" in str(exc.value)


@pytest.mark.asyncio
async def test_null_token_raises_manager_token_required(db: asyncpg.Connection) -> None:
    game_code, _ = await _seed_game_with_one_song(db)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute(
            "SELECT select_next_song($1, NULL::uuid, NULL::uuid)",
            game_code,
        )
    assert exc.value.sqlstate == "28000"


# ---------------------------------------------------------------------------
# Game-state errors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_game_raises_game_not_found(db: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _call(db, "ZZZZZZ", uuid.uuid4())
    assert exc.value.sqlstate == "P0002"


@pytest.mark.asyncio
async def test_game_ended_raises_game_ended(db: asyncpg.Connection) -> None:
    game_code, _ = await _seed_game_with_one_song(db)
    await db.execute(
        "UPDATE active_games SET ended_at = now(), status = 'ended' WHERE game_code = $1",
        game_code,
    )
    token = await fetch_manager_token(db, game_code)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _call(db, game_code, token)
    assert exc.value.sqlstate == "P0001"
    assert "game_ended" in str(exc.value)


@pytest.mark.asyncio
async def test_no_genres_selected_raises(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db)
    # Default selected_genres is empty/null; do not set it.
    token = await fetch_manager_token(db, game_code)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _call(db, game_code, token)
    assert exc.value.sqlstate == "22023"
    assert "no_genres_selected" in str(exc.value)


# ---------------------------------------------------------------------------
# Song-pool errors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_more_songs_raises_when_pool_exhausted(db: asyncpg.Connection) -> None:
    """Seed exactly one song in the selected genre, play it, then the next
    random pick must raise no_more_songs."""
    game_code, songs = await _seed_game_with_one_song(db)
    token = await fetch_manager_token(db, game_code)
    assert len(songs) == 1

    await _call(db, game_code, token)  # consumes the only song

    with pytest.raises(asyncpg.PostgresError) as exc:
        await _call(db, game_code, token)
    assert exc.value.sqlstate == "22023"
    assert "no_more_songs" in str(exc.value)


@pytest.mark.asyncio
async def test_manual_pick_with_unknown_song_raises(db: asyncpg.Connection) -> None:
    game_code, _ = await _seed_game_with_one_song(db)
    token = await fetch_manager_token(db, game_code)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _call(db, game_code, token, song_id=uuid.uuid4())
    assert exc.value.sqlstate == "P0002"
    assert "song_not_found" in str(exc.value)
