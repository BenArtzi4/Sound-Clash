"""Song spacing in pick_next_song (migration 049).

Spec: docs/rpc-functions.md §3cc and db/migrations/049_song_spacing.sql.

Genre rotation and balance are asserted round by round in
test_select_next_song.py / test_peek_next_song.py. This file covers what 049
added on the song side:

  * song_artist_keys splits a free-text artist credit into its artists
  * a song that shares no genre with the song playing now beats one that does
  * no artist is heard again within 8 rounds while another artist is left
  * a duet counts for both artists
  * a small pool spreads its repeats as far apart as it can
  * an artist heard 9+ rounds ago is fresh again, and artists heard less in
    the game are preferred (weight 1 / (1 + plays)^2)

Every multi-round test asserts its rule on every round, so they are
deterministic. The two weighted tests use bands at least 5 standard deviations
wide.
"""

from __future__ import annotations

import uuid
from itertools import pairwise

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, fetch_manager_token

pytestmark = pytest.mark.needs_docker


async def _genre_ids(conn: asyncpg.Connection, *slugs: str) -> dict[str, uuid.UUID]:
    rows = await conn.fetch("SELECT slug, id FROM genres WHERE slug = ANY($1::text[])", list(slugs))
    return {r["slug"]: r["id"] for r in rows}


async def _song(conn: asyncpg.Connection, artist: str, *genre_ids: uuid.UUID) -> uuid.UUID:
    sid = await create_test_song(conn, artist=artist, youtube_id=uuid.uuid4().hex[:11])
    for gid in genre_ids:
        await conn.execute(
            "INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2)", sid, gid
        )
    return sid


async def _game(conn: asyncpg.Connection, *genre_ids: uuid.UUID) -> tuple[str, uuid.UUID]:
    game_code = await create_test_game(conn, status="waiting")
    await conn.execute(
        "UPDATE active_games SET selected_genres = $1::uuid[] WHERE game_code = $2",
        list(genre_ids),
        game_code,
    )
    return game_code, await fetch_manager_token(conn, game_code)


async def _next(
    conn: asyncpg.Connection, game_code: str, token: uuid.UUID, song_id: uuid.UUID | None = None
) -> uuid.UUID:
    row = await conn.fetchrow(
        "SELECT song_id FROM select_next_song($1, $2, $3)", game_code, token, song_id
    )
    assert row is not None
    return row["song_id"]


async def _peeks(
    conn: asyncpg.Connection, game_code: str, token: uuid.UUID, draws: int
) -> dict[uuid.UUID, int]:
    """One separate peek_next_song call per draw (see test_peek_next_song.py)."""
    counts: dict[uuid.UUID, int] = {}
    for _ in range(draws):
        row = await conn.fetchrow("SELECT song_id FROM peek_next_song($1, $2)", game_code, token)
        assert row is not None
        counts[row["song_id"]] = counts.get(row["song_id"], 0) + 1
    return counts


# ---------------------------------------------------------------------------
# song_artist_keys
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("artist", "keys"),
    [
        ("Queen", ["queen"]),
        ("TOTO", ["toto"]),
        ("  Adele  ", ["adele"]),
        ("Calvin Harris & Dua Lipa", ["calvin harris", "dua lipa"]),
        ("Rihanna ft. Drake", ["drake", "rihanna"]),
        ("Travis Scott feat. Playboi Carti", ["playboi carti", "travis scott"]),
        (
            "Justin Bieber featuring Daniel Caesar & Giveon",
            ["daniel caesar", "giveon", "justin bieber"],
        ),
        ("David Guetta,Anne-Marie,Coi Leray", ["anne-marie", "coi leray", "david guetta"]),
        ("ZAYN, Taylor Swift", ["taylor swift", "zayn"]),
        ("Lil Nas X & Jack Harlow", ["jack harlow", "lil nas x"]),
        ("Lil Nas X", ["lil nas x"]),
        ("נס X סטילה", ["נס", "סטילה"]),
        ("עומר אדם ולירן דנינו", ["לירן דנינו", "עומר אדם"]),
        ("סטטיק ובן אל ופאר טסי", ["בן אל", "סטטיק", "פאר טסי"]),  # noqa: RUF001
        ("עומר אדם, אודיה ושרק", ["אודיה", "עומר אדם", "שרק"]),
        ("", []),
        (None, []),
    ],
)
async def test_song_artist_keys(db: asyncpg.Connection, artist: str | None, keys: list[str]) -> None:
    got = await db.fetchval("SELECT song_artist_keys($1)", artist)
    assert sorted(got) == keys


# ---------------------------------------------------------------------------
# Genre overlap inside the chosen genre (rule 3)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_song_sharing_the_genre_playing_now_loses(db: asyncpg.Connection) -> None:
    """Rock is playing, so pop goes next. Of the two pop songs, the one also
    tagged rock must lose to the pure pop one."""
    g = await _genre_ids(db, "rock", "pop")
    playing = await _song(db, "Alpha", g["rock"])
    pop_and_rock = await _song(db, "Beta", g["pop"], g["rock"])
    pure_pop = await _song(db, "Gamma", g["pop"])
    game_code, token = await _game(db, g["rock"], g["pop"])
    await _next(db, game_code, token, playing)

    assert set(await _peeks(db, game_code, token, 30)) == {pure_pop}
    assert pop_and_rock != pure_pop


# ---------------------------------------------------------------------------
# Artist spacing (rule 4)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_artist_again_within_8_rounds(db: asyncpg.Connection) -> None:
    """12 artists x 6 songs in one genre, 2 games of 30 rounds: no round shares
    an artist with any of the 8 before it. 12 artists always leave at least 4
    unheard ones, and none can run out (at most 4 plays each in 30 rounds)."""
    g = await _genre_ids(db, "rock")
    artist_of: dict[uuid.UUID, str] = {}
    for a in range(12):
        for _ in range(6):
            artist_of[await _song(db, f"Artist {a}", g["rock"])] = f"Artist {a}"
    for _ in range(2):
        game_code, token = await _game(db, g["rock"])
        heard: list[str] = []
        for rnd in range(1, 31):
            artist = artist_of[await _next(db, game_code, token)]
            assert artist not in heard[-8:], f"round {rnd}: {artist} within 8 rounds"
            heard.append(artist)


@pytest.mark.asyncio
async def test_duet_counts_for_both_artists(db: asyncpg.Connection) -> None:
    """After "Alpha & Beta", a Beta solo song is spaced like any Beta song, so
    only the unheard Gamma is offered."""
    g = await _genre_ids(db, "rock")
    duet = await _song(db, "Alpha & Beta", g["rock"])
    await _song(db, "Beta", g["rock"])
    gamma = await _song(db, "Gamma", g["rock"])
    game_code, token = await _game(db, g["rock"])
    await _next(db, game_code, token, duet)

    assert set(await _peeks(db, game_code, token, 30)) == {gamma}


@pytest.mark.asyncio
async def test_small_pool_spreads_its_repeats(db: asyncpg.Connection) -> None:
    """Only two artists, 5 songs each: repeats can't be avoided, but the artist
    heard longest ago always wins, so the whole pool alternates."""
    g = await _genre_ids(db, "rock")
    artist_of = {await _song(db, a, g["rock"]): a for a in ["A"] * 5 + ["B"] * 5}
    game_code, token = await _game(db, g["rock"])
    order = [artist_of[await _next(db, game_code, token)] for _ in range(10)]
    assert all(x != y for x, y in pairwise(order)), order


@pytest.mark.asyncio
async def test_artist_heard_8_rounds_ago_is_still_spaced(db: asyncpg.Connection) -> None:
    """Old, then 7 other artists: Old was heard 8 rounds ago (inside the
    window), so only the never-heard New is offered."""
    g = await _genre_ids(db, "rock")
    old = [await _song(db, "Old", g["rock"]) for _ in range(2)]
    others = [await _song(db, f"Filler {i}", g["rock"]) for i in range(7)]
    new = await _song(db, "New", g["rock"])
    game_code, token = await _game(db, g["rock"])
    for sid in [old[0], *others]:
        await _next(db, game_code, token, sid)

    assert set(await _peeks(db, game_code, token, 40)) == {new}


# ---------------------------------------------------------------------------
# Artist share (rule 5)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_artist_heard_9_rounds_ago_returns_with_a_lower_weight(
    db: asyncpg.Connection,
) -> None:
    """Old, then 8 other artists: Old was heard 9 rounds ago, so it is fresh
    again, but it already has 1 play against 0 for each of 3 unheard artists.
    Weights 1/4 vs 1, 1, 1 give Old 1/13 of the draws: expected 31 of 400,
    standard deviation 5.3. A uniform draw would give 100."""
    g = await _genre_ids(db, "rock")
    old = [await _song(db, "Old", g["rock"]) for _ in range(2)]
    others = [await _song(db, f"Filler {i}", g["rock"]) for i in range(8)]
    new = [await _song(db, f"New {i}", g["rock"]) for i in range(3)]
    game_code, token = await _game(db, g["rock"])
    for sid in [old[0], *others]:
        await _next(db, game_code, token, sid)

    counts = await _peeks(db, game_code, token, 400)
    assert set(counts) == {old[1], *new}
    assert 8 <= counts[old[1]] <= 60, counts


@pytest.mark.asyncio
async def test_artist_holding_half_the_genre_is_not_held_back(db: asyncpg.Connection) -> None:
    """Big was played twice (more than 8 rounds ago) and now holds 3 of the 4
    songs the genre has left. Holding it back (weight 1/9 each) would give it a
    quarter of the draws; because it holds half or more of what is left it is
    weighted like the rest, so it gets three quarters: expected 300 of 400,
    standard deviation 8.7."""
    g = await _genre_ids(db, "rock")
    big = [await _song(db, "Big", g["rock"]) for _ in range(5)]
    others = [await _song(db, f"Filler {i}", g["rock"]) for i in range(8)]
    lone = await _song(db, "Lone", g["rock"])
    game_code, token = await _game(db, g["rock"])
    for sid in [big[0], big[1], *others]:
        await _next(db, game_code, token, sid)

    counts = await _peeks(db, game_code, token, 400)
    assert set(counts) == {*big[2:], lone}
    assert 240 <= sum(counts[s] for s in big[2:]) <= 360, counts
