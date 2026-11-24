"""Custom setlists (migration 060): the per-game song pool and its picker.

Spec: docs/rpc-functions.md (save_game_setlist, pick_next_pool_song,
game_pool_summary, and the custom-game branch of select_next_song /
peek_next_song) and docs/planning/2026-11-24-custom-setlist-design.md §8.

A game with a game_setlists row plays only its own pool: the host's list
(tier 1) first, then more songs by the same artists (tier 2). A game with no
row is a normal genre game and keeps today's path.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, fetch_manager_token

pytestmark = [pytest.mark.needs_docker, pytest.mark.asyncio]

SAVE = "SELECT save_game_setlist($1, $2::uuid[], $3::uuid[], $4)"
PEEK = "SELECT song_id, expected_round FROM peek_next_song($1, $2)"
GUARDED = "SELECT song_id FROM select_next_song($1, $2, $3, $4)"
LEGACY = "SELECT song_id FROM select_next_song($1, $2, $3)"
SUMMARY = "SELECT * FROM game_pool_summary($1, $2)"


async def _song(conn: asyncpg.Connection, artist: str | None = None) -> uuid.UUID:
    """A catalog song with a unique video id and, unless given, its own artist."""
    return await create_test_song(
        conn,
        artist=artist or f"Artist {uuid.uuid4().hex[:8]}",
        youtube_id=uuid.uuid4().hex[:11],
    )


async def _setlist_game(
    conn: asyncpg.Connection,
    tier1: int,
    tier2: int,
    *,
    ready: bool = True,
    artist: str | None = None,
    list_total: int | None = None,
) -> tuple[str, uuid.UUID, list[uuid.UUID], list[uuid.UUID]]:
    """Game + tier1/tier2 songs saved through save_game_setlist.

    Returns (code, token, ids1, ids2).
    """
    code = await create_test_game(conn, status="waiting")
    token = await fetch_manager_token(conn, code)
    ids1 = [await _song(conn, artist) for _ in range(tier1)]
    ids2 = [await _song(conn, artist) for _ in range(tier2)]
    total = tier1 if list_total is None else list_total
    assert await conn.fetchval(SAVE, code, ids1, ids2, total) == tier1 + tier2
    if not ready:
        await conn.execute("UPDATE game_setlists SET ready = false WHERE game_code = $1", code)
    return code, token, ids1, ids2


async def _play(conn: asyncpg.Connection, code: str, token: uuid.UUID) -> uuid.UUID:
    return (
        await conn.fetchrow(
            "SELECT * FROM select_next_song($1, $2, NULL::uuid, NULL::integer)", code, token
        )
    )["song_id"]


async def _rounds(conn: asyncpg.Connection, code: str) -> int:
    return await conn.fetchval("SELECT count(*) FROM game_rounds WHERE game_code = $1", code)


# ---------------------------------------------------------------------------
# The pool picker, through select_next_song and peek_next_song
# ---------------------------------------------------------------------------


async def test_list_songs_play_before_same_artist_songs(db: asyncpg.Connection) -> None:
    code, token, ids1, ids2 = await _setlist_game(db, 3, 3)
    first = [await _play(db, code, token) for _ in range(3)]
    assert set(first) == set(ids1)
    assert {await _play(db, code, token) for _ in range(3)} == set(ids2)


async def test_no_repeat_then_no_more_songs(db: asyncpg.Connection) -> None:
    code, token, *_ = await _setlist_game(db, 2, 1)
    assert len({await _play(db, code, token) for _ in range(3)}) == 3
    with pytest.raises(asyncpg.PostgresError, match="no_more_songs") as exc:
        await _play(db, code, token)
    assert exc.value.sqlstate == "22023"
    # As for a genre game, an exhausted pool peeks as zero rows, not an error.
    assert await db.fetch(PEEK, code, token) == []


async def test_unavailable_song_is_skipped(db: asyncpg.Connection) -> None:
    code, token, ids1, ids2 = await _setlist_game(db, 2, 1)
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", ids1[0])
    for _ in range(10):
        assert (await db.fetchrow(PEEK, code, token))["song_id"] == ids1[1]
    assert await _play(db, code, token) == ids1[1]
    assert await _play(db, code, token) == ids2[0]
    with pytest.raises(asyncpg.PostgresError, match="no_more_songs"):
        await _play(db, code, token)


async def test_not_ready_blocks_select_and_peek(db: asyncpg.Connection) -> None:
    code, token, ids1, _ = await _setlist_game(db, 2, 0, ready=False)
    calls: tuple[tuple[str, tuple[object, ...]], ...] = (
        (PEEK, (code, token)),
        (GUARDED, (code, token, None, None)),  # random pick
        (GUARDED, (code, token, ids1[0], 0)),  # commit of a peeked song
        (GUARDED, (code, token, ids1[0], None)),  # explicit override
    )
    for sql, args in calls:
        with pytest.raises(asyncpg.PostgresError, match="setlist_not_ready") as exc:
            await db.fetch(sql, *args)
        assert exc.value.sqlstate == "P0001"
    # The token is checked first.
    with pytest.raises(asyncpg.PostgresError, match="manager_token_required"):
        await db.fetch(PEEK, code, uuid.uuid4())
    assert await _rounds(db, code) == 0


async def test_guarded_select_rejects_song_outside_pool(db: asyncpg.Connection) -> None:
    code, token, ids1, ids2 = await _setlist_game(db, 2, 1)
    outside = await _song(db)
    dead = ids2[0]
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", dead)
    assert await db.fetchval(GUARDED, code, token, ids1[0], 0) == ids1[0]

    for candidate in (outside, ids1[0], dead, uuid.uuid4()):
        with pytest.raises(asyncpg.PostgresError, match="song_no_longer_eligible") as exc:
            await db.fetchval(GUARDED, code, token, candidate, 1)
        assert exc.value.sqlstate == "P0001"
    assert await _rounds(db, code) == 1
    assert await db.fetchval(GUARDED, code, token, ids1[1], 1) == ids1[1]


async def test_unguarded_override_ignores_the_pool(db: asyncpg.Connection) -> None:
    """Ruling E: the explicit override (p_song_id with no expected round) stays
    as today for a custom game: any catalog song, no genre check."""
    code, token, *_ = await _setlist_game(db, 1, 0)
    outside = await _song(db)
    assert await db.fetchval(LEGACY, code, token, outside) == outside
    with pytest.raises(asyncpg.PostgresError, match="song_not_found"):
        await db.fetchval(LEGACY, code, token, uuid.uuid4())


async def test_peek_returns_pool_song_and_does_not_advance(db: asyncpg.Connection) -> None:
    code, token, ids1, _ = await _setlist_game(db, 2, 2)
    for _ in range(5):
        row = await db.fetchrow(PEEK, code, token)
        assert row is not None
        assert row["song_id"] in ids1
        assert row["expected_round"] == 0
    round_number = await db.fetchval(
        "SELECT round_number FROM active_games WHERE game_code = $1", code
    )
    assert round_number == 0
    assert await _rounds(db, code) == 0

    peeked = (await db.fetchrow(PEEK, code, token))["song_id"]
    assert await db.fetchval(GUARDED, code, token, peeked, 0) == peeked


async def test_single_artist_pool_plays_every_song(db: asyncpg.Connection) -> None:
    """Artist spacing is a preference: a list by one artist still plays out."""
    code, token, ids1, _ = await _setlist_game(db, 6, 0, artist="Same Artist")
    assert {await _play(db, code, token) for _ in range(6)} == set(ids1)
    with pytest.raises(asyncpg.PostgresError, match="no_more_songs"):
        await _play(db, code, token)


async def test_pool_picker_spaces_artists(db: asyncpg.Connection) -> None:
    """The spacing rule of pick_next_song applies inside a tier: after an
    artist plays, a song by another artist goes first."""
    code = await create_test_game(db, status="waiting")
    token = await fetch_manager_token(db, code)
    a1, a2 = await _song(db, "Artist A"), await _song(db, "Artist A")
    b = await _song(db, "Artist B")
    assert await db.fetchval(SAVE, code, [a1, a2, b], [], 3) == 3
    await db.fetchval(GUARDED, code, token, a1, 0)
    for _ in range(20):
        assert (await db.fetchrow(PEEK, code, token))["song_id"] == b


async def test_anon_plays_a_custom_game_through_the_definers(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    """anon cannot read the pool tables or call the pool picker, but the
    SECURITY DEFINER RPCs reach them as their owner."""
    code, token, ids1, ids2 = await _setlist_game(db, 1, 1)
    summary = await anon_conn.fetchrow(SUMMARY, code, token)
    assert summary is not None and summary["list_left"] == 1
    peek = await anon_conn.fetchrow(PEEK, code, token)
    assert peek is not None and peek["song_id"] == ids1[0]
    assert await anon_conn.fetchval(GUARDED, code, token, peek["song_id"], 0) == ids1[0]
    assert await anon_conn.fetchval(GUARDED, code, token, None, 1) == ids2[0]


# ---------------------------------------------------------------------------
# save_game_setlist
# ---------------------------------------------------------------------------


async def test_save_skips_unknown_ids_and_prefers_tier_1(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    listed, extra, both = await _song(db), await _song(db), await _song(db)
    size = await db.fetchval(
        SAVE, code, [listed, uuid.uuid4(), both, listed], [extra, both, uuid.uuid4()], 4
    )
    assert size == 3
    rows = await db.fetch("SELECT song_id, tier FROM game_song_pool WHERE game_code = $1", code)
    assert {r["song_id"]: r["tier"] for r in rows} == {listed: 1, both: 1, extra: 2}
    assert (
        await db.fetchval(
            "SELECT tier FROM game_song_pool WHERE game_code=$1 AND song_id=$2", code, both
        )
        == 1
    )
    setlist = await db.fetchrow(
        "SELECT ready, list_total FROM game_setlists WHERE game_code = $1", code
    )
    assert dict(setlist) == {"ready": True, "list_total": 4}


async def test_save_empty_raises_and_writes_nothing(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    for list_ids, fill_ids in (([uuid.uuid4()], [uuid.uuid4()]), ([], []), (None, None)):
        with pytest.raises(asyncpg.PostgresError, match="setlist_empty") as exc:
            await db.fetchval(SAVE, code, list_ids, fill_ids, 1)
        assert exc.value.sqlstate == "22023"
    assert await db.fetchval("SELECT count(*) FROM game_setlists WHERE game_code = $1", code) == 0
    assert await db.fetchval("SELECT count(*) FROM game_song_pool WHERE game_code = $1", code) == 0


async def test_save_twice_raises_setlist_exists(db: asyncpg.Connection) -> None:
    code, _, ids1, ids2 = await _setlist_game(db, 2, 1)
    other = await _song(db)
    with pytest.raises(asyncpg.PostgresError, match="setlist_exists") as exc:
        await db.fetchval(SAVE, code, [other], [], 1)
    assert exc.value.sqlstate == "P0001"
    rows = await db.fetch("SELECT song_id FROM game_song_pool WHERE game_code = $1", code)
    assert {r["song_id"] for r in rows} == set(ids1 + ids2)


async def test_save_unknown_game_raises_game_not_found(db: asyncpg.Connection) -> None:
    song = await _song(db)
    with pytest.raises(asyncpg.PostgresError, match="game_not_found") as exc:
        await db.fetchval(SAVE, "ZZZZZZ", [song], [], 1)
    assert exc.value.sqlstate == "P0002"


async def test_pool_is_deleted_with_the_game(db: asyncpg.Connection) -> None:
    code, _, ids1, _ = await _setlist_game(db, 2, 1)
    # A song deleted from the catalog leaves the pool with it.
    await db.execute("DELETE FROM songs WHERE id = $1", ids1[0])
    assert await db.fetchval("SELECT count(*) FROM game_song_pool WHERE game_code = $1", code) == 2

    await db.execute("DELETE FROM active_games WHERE game_code = $1", code)
    assert await db.fetchval("SELECT count(*) FROM game_setlists WHERE game_code = $1", code) == 0
    assert await db.fetchval("SELECT count(*) FROM game_song_pool WHERE game_code = $1", code) == 0


async def test_pool_tables_are_locked_down(db: asyncpg.Connection) -> None:
    """RLS on, no policy, nothing granted to anon or authenticated, and not in
    the Realtime publication (players must never see the answers)."""
    for table in ("game_setlists", "game_song_pool"):
        assert await db.fetchval(
            "SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass", f"public.{table}"
        ) is True
        assert await db.fetch(
            "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1",
            table,
        ) == []
        for role in ("anon", "authenticated"):
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                assert await db.fetchval(
                    "SELECT has_table_privilege($1, $2, $3)", role, f"public.{table}", privilege
                ) is False, f"{role} must not have {privilege} on {table}"
        assert await db.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_publication_tables "
            "WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = $1)",
            table,
        ) is False


# ---------------------------------------------------------------------------
# game_pool_summary
# ---------------------------------------------------------------------------


async def test_summary_counts_and_token(db: asyncpg.Connection) -> None:
    # 3 tier-1, 2 tier-2, list_total 5, one round played
    code, token, _, ids2 = await _setlist_game(db, 3, 2, list_total=5)
    await _play(db, code, token)
    row = await db.fetchrow(SUMMARY, code, token)
    assert dict(row) == {
        "list_total": 5,
        "list_songs": 3,
        "list_left": 2,
        "extra_songs": 2,
        "extra_left": 2,
    }

    # An unavailable song still counts in the pool but is not left to play.
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", ids2[0])
    row = await db.fetchrow(SUMMARY, code, token)
    assert (row["extra_songs"], row["extra_left"]) == (2, 1)

    # wrong token -> 'manager_token_required'
    for bad in (uuid.uuid4(), None):
        with pytest.raises(asyncpg.PostgresError, match="manager_token_required") as exc:
            await db.fetch(SUMMARY, code, bad)
        assert exc.value.sqlstate == "28000"
    with pytest.raises(asyncpg.PostgresError, match="game_not_found") as exc:
        await db.fetch(SUMMARY, "ZZZZZZ", token)
    assert exc.value.sqlstate == "P0002"


async def test_genre_game_has_no_summary_and_still_plays(db: asyncpg.Connection) -> None:
    rock = await db.fetchval("SELECT id FROM genres WHERE slug = 'rock'")
    code = await create_test_game(db, status="waiting")
    token = await fetch_manager_token(db, code)
    await db.execute(
        "UPDATE active_games SET selected_genres = ARRAY[$1]::uuid[] WHERE game_code = $2",
        rock,
        code,
    )
    song = await _song(db)
    await db.execute("INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2)", song, rock)

    assert await db.fetch(SUMMARY, code, token) == []
    assert (await db.fetchrow(PEEK, code, token))["song_id"] == song
    assert await _play(db, code, token) == song
    with pytest.raises(asyncpg.PostgresError, match="no_more_songs"):
        await _play(db, code, token)

    # No row and no genres: today's no_genres_selected, from both.
    bare = await create_test_game(db, status="waiting")
    bare_token = await fetch_manager_token(db, bare)
    for sql, args in ((PEEK, (bare, bare_token)), (GUARDED, (bare, bare_token, None, None))):
        with pytest.raises(asyncpg.PostgresError, match="no_genres_selected"):
            await db.fetch(sql, *args)
