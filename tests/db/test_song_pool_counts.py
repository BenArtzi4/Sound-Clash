"""song_pool_counts(): the create page's song count for a genre + decade mix.

Spec: docs/rpc-functions.md §3f and db/migrations/052_song_pool_counts.sql
(issue #375).

The function returns the playable catalog grouped by (decade, sorted genre
ids). The create page sums song_count over the rows whose decade is selected
(or any, when no decade is) and whose genre_ids share an id with the selected
genres. These tests pin the grouping, and prove that sum equals the number of
songs select_next_song actually serves before no_more_songs, for a catalog that
covers every eligibility rule: multi-genre songs, unknown years, pre-1960
years, dead videos and songs in no genre.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, fetch_manager_token

pytestmark = pytest.mark.needs_docker


async def _genre_ids(conn: asyncpg.Connection, *slugs: str) -> list[uuid.UUID]:
    rows = await conn.fetch(
        "SELECT id FROM genres WHERE slug = ANY($1::text[]) ORDER BY slug", list(slugs)
    )
    assert len(rows) == len(slugs)
    return [r["id"] for r in rows]


async def _song(
    conn: asyncpg.Connection,
    genres: list[uuid.UUID],
    year: int | None,
    *,
    dead: bool = False,
) -> uuid.UUID:
    sid = await create_test_song(conn, youtube_id=uuid.uuid4().hex[:11], release_year=year)
    for gid in genres:
        await conn.execute(
            "INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2)", sid, gid
        )
    if dead:
        await conn.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", sid)
    return sid


async def _matrix(conn: asyncpg.Connection) -> list[asyncpg.Record]:
    return await conn.fetch("SELECT decade, genre_ids, song_count FROM song_pool_counts()")


def _pool(
    matrix: list[asyncpg.Record], genres: list[uuid.UUID], decades: list[int]
) -> int:
    """The create page's sum (frontend/src/lib/songPool.ts::countSongsInMix)."""
    wanted = set(genres)
    total = 0
    for row in matrix:
        if decades and (row["decade"] is None or row["decade"] not in decades):
            continue
        if not wanted.intersection(row["genre_ids"]):
            continue
        total += row["song_count"]
    return total


async def _served_until_empty(
    conn: asyncpg.Connection, genres: list[uuid.UUID], decades: list[int]
) -> int:
    """Create a game with this mix and count the rounds select_next_song serves
    before it raises no_more_songs."""
    code = await create_test_game(conn, status="waiting")
    await conn.execute(
        "UPDATE active_games SET selected_genres = $1::uuid[], selected_decades = $2::int[] "
        "WHERE game_code = $3",
        genres,
        decades,
        code,
    )
    token = await fetch_manager_token(conn, code)
    served: set[uuid.UUID] = set()
    for _ in range(100):
        try:
            row = await conn.fetchrow(
                "SELECT song_id FROM select_next_song($1, $2, NULL)", code, token
            )
        except asyncpg.PostgresError as e:
            assert "no_more_songs" in str(e)
            return len(served)
        assert row is not None
        assert row["song_id"] not in served, "the picker served a song twice"
        served.add(row["song_id"])
    raise AssertionError("select_next_song never ran out of songs")


@pytest.mark.asyncio
async def test_groups_songs_by_decade_and_genre_set(db: asyncpg.Connection) -> None:
    hip_hop, pop, rock = await _genre_ids(db, "hip-hop", "pop", "rock")
    await _song(db, [rock], 1985)
    await _song(db, [rock], 1989)  # same decade + genre set as the one above
    await _song(db, [rock, pop], 1984)  # two genres: one row, both ids
    await _song(db, [pop], None)  # unknown year
    await _song(db, [hip_hop], 1953)  # before the first decade chip
    await _song(db, [rock], 1981, dead=True)  # dead video: not playable
    await create_test_song(db, youtube_id=uuid.uuid4().hex[:11], release_year=1990)  # no genre

    rows = {(r["decade"], tuple(r["genre_ids"])): r["song_count"] for r in await _matrix(db)}
    assert rows == {
        (1980, (rock,)): 2,
        (1980, tuple(sorted([rock, pop]))): 1,
        (None, (pop,)): 1,
        (1950, (hip_hop,)): 1,
    }


@pytest.mark.asyncio
async def test_empty_catalog_returns_no_rows(db: asyncpg.Connection) -> None:
    assert await _matrix(db) == []


@pytest.mark.asyncio
async def test_count_matches_what_the_picker_serves(db: asyncpg.Connection) -> None:
    """For every mix below, the create page's sum over song_pool_counts()
    equals the songs select_next_song serves in a real game before
    no_more_songs: same genre membership, decade filter and dead-video skip."""
    electronic, hip_hop, pop, rock = await _genre_ids(db, "electronic", "hip-hop", "pop", "rock")
    await _song(db, [rock], 1965)
    await _song(db, [rock], 1972)
    await _song(db, [rock], 1988)
    await _song(db, [rock], 1983, dead=True)
    await _song(db, [rock, pop], 1986)
    await _song(db, [pop, hip_hop], 2004)
    await _song(db, [pop], 2011)
    await _song(db, [pop], 2023)
    await _song(db, [pop], None)
    await _song(db, [hip_hop], 1995)
    await _song(db, [hip_hop], 2015, dead=True)
    await _song(db, [hip_hop], 1957)
    await _song(db, [electronic], 1999)
    await create_test_song(db, youtube_id=uuid.uuid4().hex[:11], release_year=1988)  # no genre

    matrix = await _matrix(db)
    every_chip = [1960, 1970, 1980, 1990, 2000, 2010, 2020]
    mixes: list[tuple[list[uuid.UUID], list[int]]] = [
        ([rock], []),
        ([rock], [1980]),
        ([rock, pop], []),
        ([rock, pop], [1980]),
        ([pop, hip_hop], [2000, 2010]),
        ([pop], every_chip),
        ([hip_hop], []),
        ([hip_hop], every_chip),
        ([electronic, hip_hop, pop, rock], []),
        ([electronic, hip_hop, pop, rock], every_chip),
        ([hip_hop], [1980]),  # empty: the #375 dead end
        ([electronic], [1960]),  # empty
    ]
    for genres, decades in mixes:
        expected = _pool(matrix, genres, decades)
        assert await _served_until_empty(db, genres, decades) == expected, (genres, decades)

    # The sums the create page will show for a few of them, spelled out.
    assert _pool(matrix, [rock], []) == 4  # 1965, 1972, 1988, the rock+pop duet
    assert _pool(matrix, [rock, pop], []) == 8  # the duet counts once
    assert _pool(matrix, [pop], every_chip) == 4  # the unknown-year song drops out
    assert _pool(matrix, [hip_hop], every_chip) == 2  # so does the 1957 song
    assert _pool(matrix, [hip_hop], [1980]) == 0


@pytest.mark.asyncio
async def test_anon_can_call_it(db: asyncpg.Connection, anon_conn: asyncpg.Connection) -> None:
    (rock,) = await _genre_ids(db, "rock")
    await _song(db, [rock], 1991)
    rows = await anon_conn.fetch("SELECT decade, genre_ids, song_count FROM song_pool_counts()")
    assert [(r["decade"], list(r["genre_ids"]), r["song_count"]) for r in rows] == [
        (1990, [rock], 1)
    ]


@pytest.mark.asyncio
async def test_is_read_only_security_invoker(db: asyncpg.Connection) -> None:
    """No privilege of its own: it runs as the caller (anon reads the catalog
    tables already) and is STABLE, so PostgREST runs it in a read-only
    transaction."""
    row = await db.fetchrow(
        "SELECT prosecdef, provolatile::text AS provolatile FROM pg_proc "
        "WHERE proname = 'song_pool_counts'"
    )
    assert row is not None
    assert row["prosecdef"] is False
    assert row["provolatile"] == "s"
