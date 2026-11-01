"""game_setlist() and round_song(): game-scoped song metadata for the browser.

Spec: docs/rpc-functions.md §3g-§3h and db/migrations/053_catalogue_rpcs.sql.

The browser resolves a round's song (host score panel, TV reveal) and the
end-of-game setlist through these two SECURITY DEFINER functions instead of
reading the songs table, so a later migration can revoke anon's SELECT on the
catalog. They return a song only for a game that played it: the live game's
rounds while its rows exist, else the most recent archived game with that code.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import asyncpg
import pytest
import pytest_asyncio

from ._helpers import (
    create_test_game,
    create_test_song,
    create_test_team,
    fetch_manager_token,
)

pytestmark = pytest.mark.needs_docker

SETLIST_SQL = (
    "SELECT round_number, id, title, artist, youtube_id, start_time, release_year, "
    "genre_slugs FROM game_setlist($1)"
)
ROUND_SONG_SQL = (
    "SELECT id, title, artist, youtube_id, start_time, release_year, genre_slugs "
    "FROM round_song($1, $2)"
)


async def _song(
    conn: asyncpg.Connection,
    *,
    title: str = "Song",
    artist: str = "Artist",
    year: int | None = None,
    start_time: int = 0,
    slugs: tuple[str, ...] = ("rock",),
) -> uuid.UUID:
    sid = await create_test_song(
        conn, title=title, artist=artist, youtube_id=uuid.uuid4().hex[:11], release_year=year
    )
    await conn.execute("UPDATE songs SET start_time = $1 WHERE id = $2", start_time, sid)
    for slug in slugs:
        # The db fixture reseeds 008_seed_genres.sql (pre-026 split), so the
        # soundtrack-slug genres aren't there: create a missing genre.
        genre_id = await conn.fetchval(
            "INSERT INTO genres (name, slug) VALUES ($1, $1) "
            "ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id",
            slug,
        )
        await conn.execute(
            "INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2)", sid, genre_id
        )
    return sid


async def _play(conn: asyncpg.Connection, code: str, *songs: uuid.UUID) -> None:
    """Insert one closed round per song, numbered from 1."""
    for n, sid in enumerate(songs, start=1):
        await conn.execute(
            "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, $2, $3)",
            code,
            n,
            sid,
        )


async def _sweep(conn: asyncpg.Connection, code: str) -> None:
    """Expire the game and run the hourly sweep: archive, then delete."""
    await conn.execute(
        "UPDATE active_games SET expires_at = now() - interval '1 minute' WHERE game_code = $1",
        code,
    )
    await conn.fetchval("SELECT cleanup_expired_games()")
    assert await conn.fetchval("SELECT count(*) FROM active_games WHERE game_code = $1", code) == 0


async def _setlist_ids(conn: asyncpg.Connection, code: str) -> list[uuid.UUID]:
    return [r["id"] for r in await conn.fetch(SETLIST_SQL, code)]


# ----- game_setlist ----------------------------------------------------------


@pytest.mark.asyncio
async def test_setlist_returns_the_played_songs_in_round_order(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    first = await _song(db, title="One", artist="A", year=1985, start_time=30, slugs=("rock", "pop"))
    second = await _song(db, title="Two", artist="B", slugs=("soundtracks",))
    third = await _song(db, title="Three", artist="C", year=2001, slugs=())
    await _song(db, title="Never played")
    await _play(db, code, second, first, third)

    rows = await db.fetch(SETLIST_SQL, code)
    assert [r["round_number"] for r in rows] == [1, 2, 3]
    assert [r["id"] for r in rows] == [second, first, third]

    one = rows[1]
    assert one["title"] == "One"
    assert one["artist"] == "A"
    assert one["release_year"] == 1985
    assert one["start_time"] == 30
    assert len(one["youtube_id"]) == 11
    assert one["genre_slugs"] == ["pop", "rock"]  # sorted
    assert rows[0]["genre_slugs"] == ["soundtracks"]  # what deriveIsSoundtrack reads
    assert rows[0]["release_year"] is None
    assert rows[2]["genre_slugs"] == []  # a song in no genre: empty, not NULL


@pytest.mark.asyncio
async def test_setlist_of_a_game_with_no_rounds_is_empty(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="waiting")
    await _song(db)
    assert await db.fetch(SETLIST_SQL, code) == []


@pytest.mark.asyncio
async def test_setlist_of_an_unknown_or_null_code_is_empty(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    await _play(db, code, await _song(db))
    assert await db.fetch(SETLIST_SQL, "ZZZZZZ") == []
    assert await db.fetch(SETLIST_SQL, code.lower()) == []
    assert await db.fetch(SETLIST_SQL, None) == []
    assert await db.fetch(SETLIST_SQL, "") == []


@pytest.mark.asyncio
async def test_setlist_lists_only_its_own_game(db: asyncpg.Connection) -> None:
    mine = await create_test_game(db)
    theirs = await create_test_game(db)
    a = await _song(db)
    b = await _song(db)
    await _play(db, mine, a)
    await _play(db, theirs, b)
    assert await _setlist_ids(db, mine) == [a]
    assert await _setlist_ids(db, theirs) == [b]


@pytest.mark.asyncio
async def test_setlist_after_end_game(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    a = await _song(db)
    b = await _song(db)
    await _play(db, code, a, b)
    await db.fetchval("SELECT end_game($1)", code)
    assert await _setlist_ids(db, code) == [a, b]


@pytest.mark.asyncio
async def test_setlist_after_the_sweep_comes_from_the_archive(db: asyncpg.Connection) -> None:
    """A tab left open past the 4h sweep still gets its setlist: the live rows
    are gone, the archive (mig 033) says which songs played, and the rows come
    from the catalog with year and genres (the archive has neither)."""
    code = await create_test_game(db)
    await create_test_team(db, code)
    a = await _song(db, title="Archived", year=1977, slugs=("israeli-soundtracks",))
    b = await _song(db)
    await _play(db, code, a, b)
    await _sweep(db, code)

    rows = await db.fetch(SETLIST_SQL, code)
    assert [(r["round_number"], r["id"]) for r in rows] == [(1, a), (2, b)]
    assert rows[0]["title"] == "Archived"
    assert rows[0]["release_year"] == 1977
    assert rows[0]["genre_slugs"] == ["israeli-soundtracks"]


@pytest.mark.asyncio
async def test_setlist_after_end_game_then_sweep(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    a = await _song(db)
    await _play(db, code, a)
    await db.fetchval("SELECT end_game($1)", code)
    await _sweep(db, code)
    assert await _setlist_ids(db, code) == [a]


@pytest.mark.asyncio
async def test_recycled_code_uses_the_most_recent_archive(db: asyncpg.Connection) -> None:
    """Codes are recycled after the TTL, so the archive can hold one code twice."""
    code = await create_test_game(db)
    old = await _song(db, title="Old game")
    await _play(db, code, old)
    await db.execute(
        "UPDATE active_games SET started_at = now() - interval '30 days' WHERE game_code = $1",
        code,
    )
    await _sweep(db, code)

    await create_test_game(db, game_code=code)
    new = await _song(db, title="New game")
    await _play(db, code, new)
    await _sweep(db, code)

    assert await db.fetchval("SELECT count(*) FROM game_history WHERE game_code = $1", code) == 2
    assert await _setlist_ids(db, code) == [new]


@pytest.mark.asyncio
async def test_a_live_code_never_falls_back_to_an_older_archive(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    old = await _song(db)
    await _play(db, code, old)
    await _sweep(db, code)

    # The same code, live again, before its first round.
    await create_test_game(db, game_code=code, status="waiting")
    assert await db.fetch(SETLIST_SQL, code) == []
    assert await db.fetch(ROUND_SONG_SQL, code, old) == []

    new = await _song(db)
    await _play(db, code, new)
    assert await _setlist_ids(db, code) == [new]


@pytest.mark.asyncio
async def test_a_song_deleted_from_the_catalog_is_left_out(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    kept = await _song(db)
    gone = await _song(db)
    await _play(db, code, gone, kept)
    await db.execute("DELETE FROM songs WHERE id = $1", gone)
    assert await _setlist_ids(db, code) == [kept]
    assert await db.fetch(ROUND_SONG_SQL, code, gone) == []

    await _sweep(db, code)
    assert await _setlist_ids(db, code) == [kept]


# ----- round_song ------------------------------------------------------------


@pytest.mark.asyncio
async def test_round_song_returns_the_song_for_its_game(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    sid = await _song(db, title="Take", artist="Me", year=1985, start_time=12, slugs=("pop",))
    await _play(db, code, sid)

    rows = await db.fetch(ROUND_SONG_SQL, code, sid)
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == sid
    assert (row["title"], row["artist"], row["release_year"], row["start_time"]) == (
        "Take",
        "Me",
        1985,
        12,
    )
    assert row["genre_slugs"] == ["pop"]


@pytest.mark.asyncio
async def test_round_song_refuses_a_song_the_game_did_not_play(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    other_game = await create_test_game(db)
    played = await _song(db)
    unplayed = await _song(db)
    elsewhere = await _song(db)
    await _play(db, code, played)
    await _play(db, other_game, elsewhere)

    assert await db.fetch(ROUND_SONG_SQL, code, unplayed) == []  # in the catalog, not in this game
    assert await db.fetch(ROUND_SONG_SQL, code, elsewhere) == []  # another game's song
    assert await db.fetch(ROUND_SONG_SQL, other_game, played) == []  # wrong code
    assert await db.fetch(ROUND_SONG_SQL, "ZZZZZZ", played) == []  # unknown code
    assert await db.fetch(ROUND_SONG_SQL, code, uuid.uuid4()) == []  # unknown song
    assert await db.fetch(ROUND_SONG_SQL, None, played) == []
    assert await db.fetch(ROUND_SONG_SQL, code, None) == []


@pytest.mark.asyncio
async def test_round_song_sees_a_round_as_soon_as_select_next_song_opens_it(
    db: asyncpg.Connection,
) -> None:
    """The browser asks for the song of a round row it has already seen, and
    treats "no row" as final. Through the real round flow, every round's song
    is returned for its game the moment the round exists, including the open
    one (the TV reveal) and after the game ends."""
    code = await create_test_game(db, status="waiting")
    token = await fetch_manager_token(db, code)
    rock = await db.fetchval("SELECT id FROM genres WHERE slug = 'rock'")
    await db.execute(
        "UPDATE active_games SET selected_genres = ARRAY[$1::uuid] WHERE game_code = $2",
        rock,
        code,
    )
    songs = [await _song(db, artist=f"Artist {n}") for n in range(3)]
    for _ in songs:
        row = await db.fetchrow("SELECT song_id FROM select_next_song($1, $2, NULL)", code, token)
        assert row is not None
        current = row["song_id"]
        open_round = await db.fetchrow(
            "SELECT song_id FROM game_rounds WHERE game_code = $1 AND ended_at IS NULL", code
        )
        assert open_round is not None and open_round["song_id"] == current
        got = await db.fetch(ROUND_SONG_SQL, code, current)
        assert [r["id"] for r in got] == [current]

    await db.fetchval("SELECT end_game($1)", code)
    for sid in songs:
        assert len(await db.fetch(ROUND_SONG_SQL, code, sid)) == 1


@pytest.mark.asyncio
async def test_round_song_after_the_sweep_comes_from_the_archive(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    played = await _song(db, title="Kept", year=1999)
    unplayed = await _song(db)
    await _play(db, code, played)
    await _sweep(db, code)

    rows = await db.fetch(ROUND_SONG_SQL, code, played)
    assert [(r["id"], r["title"], r["release_year"]) for r in rows] == [(played, "Kept", 1999)]
    assert await db.fetch(ROUND_SONG_SQL, code, unplayed) == []


# ----- security mode, grants, and anon after the revoke ----------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("proname", ["game_setlist", "round_song", "song_pool_counts"])
async def test_functions_are_read_only_security_definer(
    db: asyncpg.Connection, proname: str
) -> None:
    row = await db.fetchrow(
        "SELECT prosecdef, provolatile::text AS provolatile, proconfig FROM pg_proc "
        "WHERE proname = $1",
        proname,
    )
    assert row is not None
    assert row["prosecdef"] is True
    assert row["provolatile"] == "s"
    assert "search_path=public" in (row["proconfig"] or [])


@pytest_asyncio.fixture
async def catalog_revoked(db: asyncpg.Connection) -> AsyncIterator[None]:
    """Simulate migration 054: anon loses SELECT on songs and song_genres.
    Restores migration 006's grant afterwards, whatever the test does."""
    await db.execute("REVOKE SELECT ON songs, song_genres FROM anon")
    try:
        yield
    finally:
        await db.execute("GRANT SELECT ON songs, song_genres TO anon")


@pytest.mark.asyncio
async def test_anon_gets_its_game_songs_with_the_catalog_revoked(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection, catalog_revoked: None
) -> None:
    code = await create_test_game(db)
    a = await _song(db, title="Visible", slugs=("rock", "pop"))
    b = await _song(db)
    hidden = await _song(db)
    await _play(db, code, a, b)

    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.fetch("SELECT id FROM songs")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await anon_conn.fetch("SELECT song_id FROM song_genres")

    assert await _setlist_ids(anon_conn, code) == [a, b]
    rows = await anon_conn.fetch(ROUND_SONG_SQL, code, a)
    assert [(r["title"], r["genre_slugs"]) for r in rows] == [("Visible", ["pop", "rock"])]
    assert await anon_conn.fetch(ROUND_SONG_SQL, code, hidden) == []

    await _sweep(db, code)
    assert await _setlist_ids(anon_conn, code) == [a, b]  # the archive is anon-invisible too


@pytest.mark.asyncio
async def test_song_pool_counts_same_for_anon_with_the_catalog_revoked(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection, catalog_revoked: None
) -> None:
    await _song(db, year=1985, slugs=("rock",))
    await _song(db, year=1987, slugs=("rock",))
    await _song(db, year=None, slugs=("pop", "rock"))
    sql = "SELECT decade, genre_ids, song_count FROM song_pool_counts()"
    as_owner = [tuple(r) for r in await db.fetch(sql)]
    as_anon = [tuple(r) for r in await anon_conn.fetch(sql)]
    assert as_anon == as_owner
    assert sum(r[2] for r in as_anon) == 3
