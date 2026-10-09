"""peek_next_song(): read-only "what would the next random song be?" probe.

Spec: docs/rpc-functions.md and db/migrations/029_peek_next_song.sql.

The function takes (p_game_code text, p_manager_token uuid) and returns at most
one row {song_id, youtube_id, start_time} describing a candidate unplayed song
from the selected genres, WITHOUT advancing the round. It exists so the manager
browser can prebuffer the next YouTube video during the current round; the
eventual commit goes through select_next_song(..., p_song_id => <peeked id>).

Coverage:
  * happy path: returns an unplayed in-genre song; never a played one
  * read-only: does NOT create a round / advance round_number / mutate game
  * pool exhausted: returns ZERO rows (not an error)
  * token validation: right token, wrong token, null token
  * game-state errors: game_not_found, game_ended, no_genres_selected
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


async def _seed_game_with_songs(
    conn: asyncpg.Connection,
    *,
    status: str = "playing",
    extra_songs: int = 0,
) -> tuple[str, list[uuid.UUID]]:
    """active_games row + 'rock' genre selected + N+1 songs all in that genre."""
    game_code = await create_test_game(conn, status=status)
    rock = (await _genre_ids(conn, "rock"))[0]
    await _set_selected_genres(conn, game_code, [rock])
    songs: list[uuid.UUID] = []
    for _ in range(extra_songs + 1):
        sid = await create_test_song(conn, youtube_id=uuid.uuid4().hex[:11])
        await _attach_song_to_genre(conn, sid, rock)
        songs.append(sid)
    return game_code, songs


async def _peek(
    conn: asyncpg.Connection,
    game_code: str,
    token: uuid.UUID,
) -> list[asyncpg.Record]:
    return await conn.fetch(
        "SELECT song_id, youtube_id, start_time FROM peek_next_song($1, $2)",
        game_code,
        token,
    )


async def _select(
    conn: asyncpg.Connection,
    game_code: str,
    token: uuid.UUID,
    song_id: uuid.UUID | None = None,
) -> asyncpg.Record:
    rows = await conn.fetch(
        "SELECT round_id, round_number, song_id FROM select_next_song($1, $2, $3)",
        game_code,
        token,
        song_id,
    )
    return rows[0]


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_peek_returns_an_unplayed_song_in_selected_genres(
    db: asyncpg.Connection,
) -> None:
    game_code, songs = await _seed_game_with_songs(db, extra_songs=2)
    token = await fetch_manager_token(db, game_code)

    rows = await _peek(db, game_code, token)
    assert len(rows) == 1
    row = rows[0]
    assert row["song_id"] in songs
    assert row["youtube_id"] is not None
    # youtube_id is returned as text (no char(11) padding).
    assert len(row["youtube_id"]) <= 11


@pytest.mark.asyncio
async def test_peek_returns_song_metadata(db: asyncpg.Connection) -> None:
    """Migration 038: peek also returns song_title / song_artist / is_soundtrack
    (computed the same way select_next_song computes it) so the manager fast path
    can render the new song's card in-gesture instead of showing the old title
    until the RPC resolves."""
    game_code = await create_test_game(db, status="playing")
    rock = (await _genre_ids(db, "rock"))[0]
    await _set_selected_genres(db, game_code, [rock])
    sid = await create_test_song(
        db, title="My Song", artist="My Artist", youtube_id=uuid.uuid4().hex[:11]
    )
    await _attach_song_to_genre(db, sid, rock)
    token = await fetch_manager_token(db, game_code)

    rows = await db.fetch(
        "SELECT song_id, youtube_id, start_time, song_title, song_artist, is_soundtrack "
        "FROM peek_next_song($1, $2)",
        game_code,
        token,
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["song_id"] == sid
    assert row["song_title"] == "My Song"
    assert row["song_artist"] == "My Artist"
    # A plain rock song is not a soundtrack; the flag is computed, not stored.
    assert row["is_soundtrack"] is False


@pytest.mark.asyncio
async def test_peek_does_not_advance_the_round(db: asyncpg.Connection) -> None:
    """The whole point: peeking must be a no-op on game state. No round row is
    inserted, round_number stays put, and active_games is untouched."""
    game_code, _ = await _seed_game_with_songs(db, extra_songs=2)
    token = await fetch_manager_token(db, game_code)

    before = await db.fetchrow(
        "SELECT status, round_number, current_round_id, current_song_id "
        "FROM active_games WHERE game_code = $1",
        game_code,
    )
    rounds_before = await db.fetchval(
        "SELECT count(*) FROM game_rounds WHERE game_code = $1", game_code
    )

    # Peek several times; nothing should change.
    await _peek(db, game_code, token)
    await _peek(db, game_code, token)
    await _peek(db, game_code, token)

    after = await db.fetchrow(
        "SELECT status, round_number, current_round_id, current_song_id "
        "FROM active_games WHERE game_code = $1",
        game_code,
    )
    rounds_after = await db.fetchval(
        "SELECT count(*) FROM game_rounds WHERE game_code = $1", game_code
    )

    assert dict(after) == dict(before)
    assert rounds_after == rounds_before == 0


@pytest.mark.asyncio
async def test_peek_excludes_already_played_song(db: asyncpg.Connection) -> None:
    """With two songs, after one is actually played (via select_next_song), peek
    must only ever return the other."""
    game_code, songs = await _seed_game_with_songs(db, extra_songs=1)
    token = await fetch_manager_token(db, game_code)
    assert len(songs) == 2
    first, second = songs

    played = await _select(db, game_code, token, song_id=first)
    assert played["song_id"] == first

    # Peek is deterministic now: only the unplayed song remains.
    for _ in range(5):
        rows = await _peek(db, game_code, token)
        assert len(rows) == 1
        assert rows[0]["song_id"] == second


@pytest.mark.asyncio
async def test_peek_then_commit_uses_the_peeked_song(db: asyncpg.Connection) -> None:
    """End-to-end of the intended flow: peek, then commit that exact id via
    select_next_song's manual-pick path -> the started round uses the song."""
    game_code, _ = await _seed_game_with_songs(db, extra_songs=3)
    token = await fetch_manager_token(db, game_code)

    peeked = (await _peek(db, game_code, token))[0]["song_id"]
    committed = await _select(db, game_code, token, song_id=peeked)
    assert committed["song_id"] == peeked
    assert committed["round_number"] == 1


# ---------------------------------------------------------------------------
# Pool exhaustion: empty result, NOT an error
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_peek_returns_no_rows_when_pool_exhausted(db: asyncpg.Connection) -> None:
    game_code, songs = await _seed_game_with_songs(db, extra_songs=0)
    token = await fetch_manager_token(db, game_code)
    assert len(songs) == 1

    # Play the only song.
    await _select(db, game_code, token, song_id=songs[0])

    # Peek must now return zero rows and must NOT raise.
    rows = await _peek(db, game_code, token)
    assert rows == []


# ---------------------------------------------------------------------------
# Decade filter (migration 032) -- must match select_next_song in lockstep
# ---------------------------------------------------------------------------


async def _set_selected_decades(
    conn: asyncpg.Connection, game_code: str, decades: list[int]
) -> None:
    await conn.execute(
        "UPDATE active_games SET selected_decades = $1::int[] WHERE game_code = $2",
        decades,
        game_code,
    )


@pytest.mark.asyncio
async def test_peek_respects_decade_filter(db: asyncpg.Connection) -> None:
    """Peek must only ever surface a song inside the selected decade, so the
    browser never prebuffers a song the commit (select_next_song) would reject."""
    game_code = await create_test_game(db, status="waiting")
    token = await fetch_manager_token(db, game_code)
    rock = (await _genre_ids(db, "rock"))[0]
    await _set_selected_genres(db, game_code, [rock])
    s80 = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11], release_year=1985)
    s90 = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11], release_year=1995)
    await _attach_song_to_genre(db, s80, rock)
    await _attach_song_to_genre(db, s90, rock)
    await _set_selected_decades(db, game_code, [1980])

    for _ in range(5):
        rows = await _peek(db, game_code, token)
        assert len(rows) == 1
        assert rows[0]["song_id"] == s80


@pytest.mark.asyncio
async def test_peek_returns_no_rows_when_decade_excludes_all(db: asyncpg.Connection) -> None:
    """When no in-genre song is in the selected decade, peek returns zero rows
    (not an error) -- the host just doesn't prebuffer."""
    game_code = await create_test_game(db, status="waiting")
    token = await fetch_manager_token(db, game_code)
    rock = (await _genre_ids(db, "rock"))[0]
    await _set_selected_genres(db, game_code, [rock])
    s90 = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11], release_year=1995)
    await _attach_song_to_genre(db, s90, rock)
    await _set_selected_decades(db, game_code, [1980])

    assert await _peek(db, game_code, token) == []


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wrong_token_raises_manager_token_required(db: asyncpg.Connection) -> None:
    game_code, _ = await _seed_game_with_songs(db)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _peek(db, game_code, uuid.uuid4())
    assert exc.value.sqlstate == "28000"
    assert "manager_token_required" in str(exc.value)


@pytest.mark.asyncio
async def test_null_token_raises_manager_token_required(db: asyncpg.Connection) -> None:
    game_code, _ = await _seed_game_with_songs(db)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await db.execute("SELECT peek_next_song($1, NULL::uuid)", game_code)
    assert exc.value.sqlstate == "28000"


# ---------------------------------------------------------------------------
# Game-state errors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_game_raises_game_not_found(db: asyncpg.Connection) -> None:
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _peek(db, "ZZZZZZ", uuid.uuid4())
    assert exc.value.sqlstate == "P0002"


@pytest.mark.asyncio
async def test_game_ended_raises_game_ended(db: asyncpg.Connection) -> None:
    game_code, _ = await _seed_game_with_songs(db)
    await db.execute(
        "UPDATE active_games SET ended_at = now(), status = 'ended' WHERE game_code = $1",
        game_code,
    )
    token = await fetch_manager_token(db, game_code)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _peek(db, game_code, token)
    assert exc.value.sqlstate == "P0001"
    assert "game_ended" in str(exc.value)


@pytest.mark.asyncio
async def test_no_genres_selected_raises(db: asyncpg.Connection) -> None:
    game_code = await create_test_game(db)
    token = await fetch_manager_token(db, game_code)
    with pytest.raises(asyncpg.PostgresError) as exc:
        await _peek(db, game_code, token)
    assert exc.value.sqlstate == "22023"
    assert "no_genres_selected" in str(exc.value)


# ---------------------------------------------------------------------------
# Dead-video auto-skip (migration 045)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_peek_never_returns_an_unavailable_song(db: asyncpg.Connection) -> None:
    """Two eligible songs, one flagged unavailable: repeated peeks always land
    on the live one (the picker is random, so probe it several times)."""
    game_code, songs = await _seed_game_with_songs(db, extra_songs=1)
    token = await fetch_manager_token(db, game_code)
    dead, alive = songs
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", dead)

    for _ in range(10):
        rows = await _peek(db, game_code, token)
        assert len(rows) == 1
        assert rows[0]["song_id"] == alive


@pytest.mark.asyncio
async def test_peek_returns_zero_rows_when_all_songs_unavailable(
    db: asyncpg.Connection,
) -> None:
    """An all-flagged pool looks exhausted to the peek: zero rows, no error --
    same contract as a genuinely empty pool."""
    game_code, songs = await _seed_game_with_songs(db)
    token = await fetch_manager_token(db, game_code)
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", songs[0])

    rows = await _peek(db, game_code, token)
    assert rows == []


# ---------------------------------------------------------------------------
# Balanced genre turns (migration 048)
#
# peek_next_song is READ-ONLY, so calling it repeatedly samples the picker for
# the CURRENT point of the game without changing it. It runs the same
# pick_next_song helper as select_next_song's random path, so these tests pin
# the rule the prebuffered video follows: a genre more than one song ahead of
# the least-played genre is never offered.
# ---------------------------------------------------------------------------


async def _peek_counts(
    conn: asyncpg.Connection,
    game_code: str,
    token: uuid.UUID,
    draws: int,
) -> dict[uuid.UUID, int]:
    """Call peek_next_song `draws` times and tally per-song hits.

    Each call is a separate invocation (a single generate_series/LATERAL query
    would let the planner evaluate the uncorrelated set-returning function once
    and reuse the row, defeating the sampling). peek is read-only, so no state
    changes between draws and every call is an independent random draw.
    """
    counts: dict[uuid.UUID, int] = {}
    for _ in range(draws):
        row = await conn.fetchrow("SELECT song_id FROM peek_next_song($1, $2)", game_code, token)
        assert row is not None, "peek returned no candidate for a non-empty pool"
        counts[row["song_id"]] = counts.get(row["song_id"], 0) + 1
    return counts


async def _two_genre_game(
    conn: asyncpg.Connection, sizes: tuple[int, int], dual: int = 0
) -> tuple[str, uuid.UUID, list[uuid.UUID], list[uuid.UUID], list[uuid.UUID]]:
    """Game with rock + pop selected: `sizes` single-genre songs each, plus
    `dual` songs tagged in both. Returns (code, token, rock, pop, dual)."""
    game_code = await create_test_game(conn, status="playing")
    rock = (await _genre_ids(conn, "rock"))[0]
    pop = (await _genre_ids(conn, "pop"))[0]
    await _set_selected_genres(conn, game_code, [rock, pop])
    token = await fetch_manager_token(conn, game_code)
    rock_songs = [await create_test_song(conn, youtube_id=uuid.uuid4().hex[:11]) for _ in range(sizes[0])]
    pop_songs = [await create_test_song(conn, youtube_id=uuid.uuid4().hex[:11]) for _ in range(sizes[1])]
    dual_songs = [await create_test_song(conn, youtube_id=uuid.uuid4().hex[:11]) for _ in range(dual)]
    for sid in rock_songs:
        await _attach_song_to_genre(conn, sid, rock)
    for sid in pop_songs:
        await _attach_song_to_genre(conn, sid, pop)
    for sid in dual_songs:
        await _attach_song_to_genre(conn, sid, rock)
        await _attach_song_to_genre(conn, sid, pop)
    return game_code, token, rock_songs, pop_songs, dual_songs


@pytest.mark.asyncio
async def test_peek_offers_only_the_genre_that_is_behind(db: asyncpg.Connection) -> None:
    """Two rock songs already played, no pop: rock is 2 ahead, so every peek
    must offer a pop song even though rock still has songs left."""
    game_code, token, rock, pop, _ = await _two_genre_game(db, (5, 5))
    await _select(db, game_code, token, song_id=rock[0])
    await _select(db, game_code, token, song_id=rock[1])

    counts = await _peek_counts(db, game_code, token, 40)
    assert set(counts) <= set(pop)


@pytest.mark.asyncio
async def test_peek_never_offers_the_genre_playing_now(db: asyncpg.Connection) -> None:
    """One rock song is playing. Under 048 rock (only 1 ahead) could go again;
    under migration 049's genre rotation every peek must offer pop, and every
    pop song stays reachable."""
    game_code, token, rock, pop, _ = await _two_genre_game(db, (5, 5))
    await _select(db, game_code, token, song_id=rock[0])

    counts = await _peek_counts(db, game_code, token, 200)
    assert set(counts) == set(pop)


@pytest.mark.asyncio
async def test_multi_genre_song_counts_as_a_turn_for_each_genre(db: asyncpg.Connection) -> None:
    """Playing two songs tagged in rock AND pop gives both genres 2 turns, so a
    third selected genre with none must be the only one offered."""
    game_code, token, _, _, dual = await _two_genre_game(db, (4, 4), dual=2)
    hip_hop = (await _genre_ids(db, "hip-hop"))[0]
    hip_songs = [await create_test_song(db, youtube_id=uuid.uuid4().hex[:11]) for _ in range(4)]
    for sid in hip_songs:
        await _attach_song_to_genre(db, sid, hip_hop)
    await db.execute(
        "UPDATE active_games SET selected_genres = array_append(selected_genres, $1) "
        "WHERE game_code = $2",
        hip_hop,
        game_code,
    )
    for sid in dual:
        await _select(db, game_code, token, song_id=sid)

    counts = await _peek_counts(db, game_code, token, 40)
    assert set(counts) <= set(hip_songs)


@pytest.mark.asyncio
async def test_peek_draws_every_song_of_an_allowed_genre(db: asyncpg.Connection) -> None:
    """Within the genres allowed to go next the song is uniformly random: over
    300 peeks of a fresh 3 + 3 game every song, including a dual-tagged one,
    turns up."""
    game_code, token, rock, pop, dual = await _two_genre_game(db, (3, 3), dual=1)
    counts = await _peek_counts(db, game_code, token, 300)
    assert set(counts) == set(rock) | set(pop) | set(dual)
