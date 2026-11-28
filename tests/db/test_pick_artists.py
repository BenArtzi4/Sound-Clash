"""Pick artists (migration 062): the list of names, the ready rule and the save.

Spec: docs/rpc-functions.md (artist_game_rule, pickable_credits,
list_pickable_artists, artist_pick_status, save_game_artists),
docs/data-model.md (artist_whole_names) and
docs/planning/2026-11-24-pick-artists-plan.md, Task 1.

A host ticks artists and the game plays every catalog song by them. The game
can start only when the choice holds enough songs by enough artists (the
numbers live in artist_game_rule() alone). No song count ever leaves the
server: the list has no count column and the status is ready plus a coarse
level. Every artist name here is made up: real catalog names and the rows of
artist_whole_names / artist_aliases are private and never committed.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import asyncpg
import pytest

from ._helpers import create_test_game, fetch_manager_token

pytestmark = [pytest.mark.needs_docker, pytest.mark.asyncio]

MIGRATION = Path(__file__).resolve().parents[2] / "db" / "migrations" / "062_pick_artists.sql"

RULE = "SELECT min_songs, min_artists, levels FROM artist_game_rule()"
CREDITS = "SELECT song_id, artist_key, shown FROM pickable_credits()"
LIST = "SELECT * FROM list_pickable_artists()"
STATUS = "SELECT * FROM artist_pick_status($1::text[])"
SAVE = "SELECT save_game_artists($1, $2::text[])"
ADD_WHOLE = "INSERT INTO artist_whole_names (name) VALUES ($1)"
ADD_ALIAS = "INSERT INTO artist_aliases (alias, artist_key) VALUES ($1, $2)"

# Made-up Hebrew names. Neither holds a word that starts with the Hebrew "and"
# prefix, so song_artist_keys does not cut them.
HE_NAME = "ד״ר זד"  # "Dr. Zed", with the gershayim mark
HE_FILM_NAME = "זד בנד"  # "Zed Band"


async def _film_genre(conn: asyncpg.Connection, slug: str = "soundtracks") -> uuid.UUID:
    """The fixture reseeds only migration 008's genres: no soundtrack slugs."""
    return await conn.fetchval(
        "INSERT INTO genres (name, slug) VALUES ($1, $1) "
        "ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id",
        slug,
    )


async def _rock(conn: asyncpg.Connection) -> uuid.UUID:
    return await conn.fetchval("SELECT id FROM genres WHERE slug = 'rock'")


async def _songs(
    conn: asyncpg.Connection,
    credit: str,
    n: int = 1,
    *,
    genre: uuid.UUID | None = None,
    unavailable: bool = False,
) -> list[uuid.UUID]:
    """Insert n catalog songs credited to `credit` (one statement), each with
    its own video id; optionally in one genre and/or flagged unavailable."""
    rows = await conn.fetch(
        "INSERT INTO songs (title, artist, youtube_id, unavailable_at) "
        "SELECT 'Song ' || g, $1, substr(md5(gen_random_uuid()::text), 1, 11), "
        "       CASE WHEN $3::boolean THEN now() END "
        "  FROM generate_series(1, $2::integer) AS g "
        "RETURNING id",
        credit,
        n,
        unavailable,
    )
    ids = [r["id"] for r in rows]
    if genre is not None:
        await conn.execute(
            "INSERT INTO song_genres (song_id, genre_id) SELECT unnest($1::uuid[]), $2::uuid",
            ids,
            genre,
        )
    return ids


async def _band(conn: asyncpg.Connection, counts: Sequence[int], prefix: str) -> list[str]:
    """One made-up artist per count ("<prefix> 1", "<prefix> 2", ...), each with
    that many solo songs. Returns their keys."""
    keys = []
    for i, n in enumerate(counts, start=1):
        name = f"{prefix} {i}"
        await _songs(conn, name, n)
        keys.append(name.lower())
    return keys


async def _list(conn: asyncpg.Connection) -> list[dict[str, Any]]:
    return [dict(r) for r in await conn.fetch(LIST)]


async def _by_key(conn: asyncpg.Connection) -> dict[str, dict[str, Any]]:
    return {r["artist_key"]: r for r in await _list(conn)}


async def _status(conn: asyncpg.Connection, keys: list[str | None] | None) -> dict[str, Any]:
    row = await conn.fetchrow(STATUS, keys)
    assert row is not None
    return dict(row)


async def _columns(conn: asyncpg.Connection, sql: str) -> list[str]:
    """The answer's column names, read from the statement (works with 0 rows)."""
    stmt = await conn.prepare(sql)
    return [a.name for a in stmt.get_attributes()]


# ---------------------------------------------------------------------------
# artist_game_rule: the one place that holds the numbers
# ---------------------------------------------------------------------------


async def test_rule_numbers(db: asyncpg.Connection) -> None:
    assert dict(await db.fetchrow(RULE)) == {"min_songs": 60, "min_artists": 5, "levels": 4}


# ---------------------------------------------------------------------------
# list_pickable_artists
# ---------------------------------------------------------------------------


async def test_list_has_no_count_and_orders_by_most_songs(db: asyncpg.Connection) -> None:
    await _songs(db, "Nia Quillfeather", 1)
    await _songs(db, "Zed Band", 3)
    assert await _columns(db, LIST) == ["artist_key", "name", "kind", "aliases"]
    assert [r["artist_key"] for r in await _list(db)] == ["zed band", "nia quillfeather"]


async def test_list_ties_sort_by_name_in_byte_order(db: asyncpg.Connection) -> None:
    """Ruling D: "then name" is byte order (COLLATE "C"), so an upper-case
    name comes before a lower-case one. A locale order would put "bea moss"
    first."""
    await _songs(db, "bea moss", 1)
    await _songs(db, "Cora Vale", 1)
    await _songs(db, "Zed Band", 2)
    assert [r["name"] for r in await _list(db)] == ["Zed Band", "Cora Vale", "bea moss"]


async def test_list_skips_unavailable_songs(db: asyncpg.Connection) -> None:
    await _songs(db, "Nia Quillfeather", 1, unavailable=True)
    await _songs(db, "Zed Band", 1)
    await _songs(db, "Zed Band", 1, unavailable=True)
    assert [r["artist_key"] for r in await _list(db)] == ["zed band"]


async def test_list_kinds(db: asyncpg.Connection) -> None:
    films = await _film_genre(db, "soundtracks")
    israeli = await _film_genre(db, "israeli-soundtracks")
    rock = await _rock(db)
    # film: every song in a soundtrack genre (either slug)
    await _songs(db, "Cora Vale", 1, genre=films)
    await _songs(db, "Cora Vale", 1, genre=israeli)
    # film beats he: a Hebrew key whose songs are all soundtracks
    await _songs(db, HE_FILM_NAME, 2, genre=israeli)
    # he: a Hebrew key (with the gershayim mark) that is not all soundtracks
    await _songs(db, HE_NAME, 1, genre=rock)
    # en: one soundtrack song is not every song
    await _songs(db, "Zed Band", 1, genre=films)
    await _songs(db, "Zed Band", 1, genre=rock)
    # Ruling E: kind is over the playable songs; a flagged rock song does not count
    await _songs(db, "Dee Fox", 1, genre=films)
    await _songs(db, "Dee Fox", 1, genre=rock, unavailable=True)
    # en: a song in no genre at all
    await _songs(db, "Nia Quillfeather", 1)

    kinds = {k: r["kind"] for k, r in (await _by_key(db)).items()}
    assert kinds == {
        "cora vale": "film",
        HE_FILM_NAME: "film",
        HE_NAME: "he",
        "zed band": "en",
        "dee fox": "film",
        "nia quillfeather": "en",
    }


async def test_list_name_is_the_most_common_spelling(db: asyncpg.Connection) -> None:
    await _songs(db, "Zed Band", 1)
    await _songs(db, "  Zed Band ", 1)  # padding is not part of the spelling
    await _songs(db, "ZED BAND", 1)
    # A tie: the smallest in byte order ("A" before "a").
    await _songs(db, "nia quillfeather", 1)
    await _songs(db, "Nia Quillfeather", 1)
    names = {k: r["name"] for k, r in (await _by_key(db)).items()}
    assert names == {"zed band": "Zed Band", "nia quillfeather": "Nia Quillfeather"}


async def test_list_carries_aliases(db: asyncpg.Connection) -> None:
    await _songs(db, "Zed Band", 1)
    await _songs(db, "Nia Quillfeather", 1)
    await db.execute(ADD_ALIAS, "zed band alt", "zed band")
    by_key = await _by_key(db)
    assert by_key["zed band"]["aliases"] == ["zed band alt"]
    assert by_key["nia quillfeather"]["aliases"] == []

    # Sorted in byte order (Python's str order is code-point order, the same
    # for UTF-8); an alias of a key with no playable song lists nothing.
    for alias in ("zed-band", "zb", "zed band two"):
        await db.execute(ADD_ALIAS, alias, "zed band")
    await db.execute(ADD_ALIAS, "nobody alt", "nobody")
    by_key = await _by_key(db)
    aliases = by_key["zed band"]["aliases"]
    assert aliases == sorted(["zed band alt", "zed-band", "zb", "zed band two"])
    assert "nobody" not in by_key


async def test_duet_counts_for_both_artists(db: asyncpg.Connection) -> None:
    await _songs(db, "Zed Band & Nia Quillfeather", 1)
    await _songs(db, "Zed Band", 1)
    rows = await _list(db)
    assert [(r["artist_key"], r["name"]) for r in rows] == [
        ("zed band", "Zed Band"),
        ("nia quillfeather", "Nia Quillfeather"),
    ]


async def test_whole_name_is_one_artist(db: asyncpg.Connection) -> None:
    """Review Focus 3: a credit that is ONE artist although it holds a comma
    and an ampersand is cut into three without a row, and stays whole with
    one. Only a whole credit matches: the same name inside a longer credit is
    still cut (Ruling L)."""
    await _songs(db, "Salt, Pepper & Co", 2)
    assert set(await _by_key(db)) == {"salt", "pepper", "co"}

    await db.execute(ADD_WHOLE, "salt, pepper & co")
    by_key = await _by_key(db)
    assert set(by_key) == {"salt, pepper & co"}
    assert by_key["salt, pepper & co"]["name"] == "Salt, Pepper & Co"

    # Case and padding of the credit do not matter for the match.
    await _songs(db, "  SALT, PEPPER & CO ", 1)
    by_key = await _by_key(db)
    assert set(by_key) == {"salt, pepper & co"}
    assert by_key["salt, pepper & co"]["name"] == "Salt, Pepper & Co"

    await _songs(db, "Salt, Pepper & Co ft. Nia Quillfeather", 1)
    assert set(await _by_key(db)) == {
        "salt, pepper & co",
        "salt",
        "pepper",
        "co",
        "nia quillfeather",
    }


async def test_whole_name_must_be_lowercase_and_trimmed(db: asyncpg.Connection) -> None:
    for bad in ("Salt, Pepper & Co", " salt, pepper & co", "salt, pepper & co ", "", "  "):
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(ADD_WHOLE, bad)
    await db.execute(ADD_WHOLE, "salt, pepper & co")
    with pytest.raises(asyncpg.UniqueViolationError):
        await db.execute(ADD_WHOLE, "salt, pepper & co")


async def test_shown_pieces_agree_with_artist_keys(db: asyncpg.Connection) -> None:
    """pickable_credits cuts a credit with song_artist_keys' regular expression
    (migration 049), copied, and skips the cut for a credit that is its own
    only key. For every seeded credit (uncut, cut into one key, cut into
    several) the keys must be exactly songs.artist_keys, each key is
    lower(shown), and a song counts once per key. If song_artist_keys ever
    changes, this fails until the copy does."""
    credits = [
        "Zed Band",
        "Zed Band,",
        HE_NAME,
        "Zed Band & Nia Quillfeather",
        "Zed Band ft. Nia Quillfeather",
        "Zed Band Ft Nia Quillfeather",
        "Zed Band feat. Nia Quillfeather",
        "Zed Band FEAT Nia Quillfeather",
        "Zed Band featuring Nia Quillfeather",
        "Zed Band vs. Nia Quillfeather",
        "Zed Band vs Nia Quillfeather",
        "Zed Band x Nia Quillfeather",
        "Zed X & Nia Quillfeather",
        "X Zed",
        "Zed Band, Nia Quillfeather",
        "Zed Band,Nia Quillfeather",
        "Zed Band  &  Nia Quillfeather",
        "Zed Band & & Nia Quillfeather",
        "  Padded Zed  ",
        "Zed Band & Nia Quillfeather ft. Cora Vale",
        "Zed Band & ZED BAND",
        "זד בנד וזד",
        f"{HE_NAME} ft. Nia Quillfeather",
        " , ",
        "Salt, Pepper & Co",
    ]
    for credit in credits:
        await _songs(db, credit, 1)
    rows = await db.fetch(
        """
        SELECT s.artist,
               s.artist_keys,
               coalesce(array_agg(c.artist_key) FILTER (WHERE c.song_id IS NOT NULL), '{}')
                 AS keys,
               coalesce(bool_and(lower(c.shown) = c.artist_key), true) AS same,
               count(c.song_id) AS n,
               count(DISTINCT c.artist_key) AS n_keys
          FROM songs s
          LEFT JOIN pickable_credits() c ON c.song_id = s.id
         GROUP BY s.id, s.artist, s.artist_keys
        """
    )
    assert len(rows) == len(credits)
    for r in rows:
        assert set(r["keys"]) == set(r["artist_keys"]), r["artist"]
        assert r["same"] is True, r["artist"]
        assert r["n"] == r["n_keys"], r["artist"]
    # The repeated key keeps the spelling of its first piece.
    shown = await db.fetch(
        "SELECT c.shown FROM pickable_credits() c JOIN songs s ON s.id = c.song_id "
        "WHERE s.artist = 'Zed Band & ZED BAND'"
    )
    assert [r["shown"] for r in shown] == ["Zed Band"]
    assert await _columns(db, CREDITS) == ["song_id", "artist_key", "shown"]


# ---------------------------------------------------------------------------
# artist_pick_status
# ---------------------------------------------------------------------------


async def test_status_ready_needs_both_rules(db: asyncpg.Connection) -> None:
    short = await _band(db, [12, 12, 12, 12, 11], "Kite Club")  # 5 artists, 59 songs
    four = await _band(db, [20, 20, 20, 20], "Moss Row")  # 4 artists, 80 songs
    ready = await _band(db, [12, 12, 12, 12, 12], "Zed Band")  # 5 artists, 60 songs
    assert (await _status(db, short))["ready"] is False
    assert (await _status(db, four))["ready"] is False
    assert (await _status(db, ready))["ready"] is True


async def test_status_levels(db: asyncpg.Connection) -> None:
    small = await _band(db, [1], "Nia Quillfeather")
    thirty = await _band(db, [6, 6, 6, 6, 6], "Kite Club")
    fifty_nine = await _band(db, [12, 12, 12, 12, 11], "Moss Row")
    four = await _band(db, [20, 20, 20, 20], "Dee Fox")
    ready = await _band(db, [12, 12, 12, 12, 12], "Zed Band")
    expected = {
        "no key": (None, False, 0),
        "empty": ([], False, 0),
        "unknown only": (["nobody here"], False, 0),
        "one small artist": (small, False, 1),
        "5 artists, 30 songs": (thirty, False, 2),
        "5 artists, 59 songs": (fifty_nine, False, 3),
        "4 artists, 80 songs": (four, False, 3),
        "ready": (ready, True, 4),
    }
    for label, (keys, is_ready, level) in expected.items():
        assert await _status(db, keys) == {
            "ready": is_ready,
            "level": level,
            "levels": 4,
            "min_artists": 5,
        }, label


async def test_status_counts_a_duet_once(db: asyncpg.Connection) -> None:
    keys = await _band(db, [11, 11, 11, 11], "Zed Band")  # 44 songs
    await _songs(db, "Zed Band 1 & Nia Quillfeather", 15)  # 59 different songs, 74 credits
    keys.append("nia quillfeather")
    status = await _status(db, keys)
    assert (status["ready"], status["level"]) == (False, 3)
    await _songs(db, "Nia Quillfeather ft. Zed Band 2", 1)  # 60 different songs
    assert (await _status(db, keys))["ready"] is True


async def test_status_ignores_unknown_and_repeated_keys(db: asyncpg.Connection) -> None:
    """Review Focus 3: unknown keys, repeats, other case or padding and NULL
    elements add nothing; a key whose only song is flagged is unknown."""
    keys = await _band(db, [15, 15, 15, 15], "Zed Band")  # 4 artists, 60 songs
    await _songs(db, "Nia Quillfeather", 1, unavailable=True)
    noisy: list[str | None] = [
        *keys,
        keys[0],
        " ZED BAND 2 ",
        "nobody here",
        "nia quillfeather",
        None,
    ]
    assert (await _status(db, noisy))["ready"] is False
    await _songs(db, "Cora Vale", 1)
    assert (await _status(db, [*noisy, "Cora Vale"]))["ready"] is True


async def test_status_refuses_more_than_200_keys(db: asyncpg.Connection) -> None:
    keys = [f"nobody {i}" for i in range(201)]
    with pytest.raises(asyncpg.PostgresError, match="too_many_artists") as exc:
        await _status(db, keys)
    assert exc.value.sqlstate == "22023"
    assert (await _status(db, keys[:200]))["level"] == 0


async def test_status_columns_hold_no_count(db: asyncpg.Connection) -> None:
    assert await _columns(db, STATUS) == ["ready", "level", "levels", "min_artists"]


# ---------------------------------------------------------------------------
# save_game_artists
# ---------------------------------------------------------------------------


async def test_save_fills_tier_one_and_marks_ready(db: asyncpg.Connection) -> None:
    keys = await _band(db, [12, 12, 12, 12, 12], "Zed Band")
    await _songs(db, "Zed Band 1", 1, unavailable=True)  # cannot play: not in the pool
    await _songs(db, "Nia Quillfeather", 3)  # not chosen
    code = await create_test_game(db, status="waiting")
    expected = {
        r["id"]
        for r in await db.fetch(
            "SELECT id FROM songs WHERE artist LIKE 'Zed Band %' AND unavailable_at IS NULL"
        )
    }

    assert await db.fetchval(SAVE, code, [*keys, keys[0], "nobody"]) == 60
    setlist = await db.fetchrow(
        "SELECT ready, list_total FROM game_setlists WHERE game_code = $1", code
    )
    assert dict(setlist) == {"ready": True, "list_total": 5}
    pool = await db.fetch("SELECT song_id, tier FROM game_song_pool WHERE game_code = $1", code)
    assert {r["song_id"] for r in pool} == expected
    assert {r["tier"] for r in pool} == {1}


async def test_save_refuses_a_small_choice_and_writes_nothing(db: asyncpg.Connection) -> None:
    """Review Focus 1: the ready rule is checked in the database, first."""
    short = await _band(db, [12, 12, 12, 12, 11], "Zed Band")
    code = await create_test_game(db, status="waiting")
    for game in (code, "ZZZZZZ"):  # the rule comes before the game lookup
        with pytest.raises(asyncpg.PostgresError, match="artists_not_enough") as exc:
            await db.fetchval(SAVE, game, short)
        assert exc.value.sqlstate == "22023"
    for keys in (None, []):
        with pytest.raises(asyncpg.PostgresError, match="artists_not_enough"):
            await db.fetchval(SAVE, code, keys)
    with pytest.raises(asyncpg.PostgresError, match="too_many_artists"):
        await db.fetchval(SAVE, code, [f"nobody {i}" for i in range(201)])
    assert await db.fetchval("SELECT count(*) FROM game_setlists") == 0
    assert await db.fetchval("SELECT count(*) FROM game_song_pool") == 0


async def test_save_unknown_game_raises_game_not_found(db: asyncpg.Connection) -> None:
    keys = await _band(db, [12, 12, 12, 12, 12], "Zed Band")
    with pytest.raises(asyncpg.PostgresError, match="game_not_found") as exc:
        await db.fetchval(SAVE, "ZZZZZZ", keys)
    assert exc.value.sqlstate == "P0002"


async def test_save_whole_name_game(db: asyncpg.Connection) -> None:
    """A whole name is one artist for the ready rule and the pool too."""
    await db.execute(ADD_WHOLE, "salt, pepper & co")
    keys = await _band(db, [12, 12, 12, 12], "Zed Band")
    whole = await _songs(db, "Salt, Pepper & Co", 12)
    assert (await _status(db, [*keys, "salt", "pepper", "co"]))["ready"] is False
    code = await create_test_game(db, status="waiting")
    assert await db.fetchval(SAVE, code, [*keys, "salt, pepper & co"]) == 60
    assert set(whole) <= {
        r["song_id"]
        for r in await db.fetch("SELECT song_id FROM game_song_pool WHERE game_code = $1", code)
    }


async def test_artist_game_plays_only_its_pool(db: asyncpg.Connection) -> None:
    keys = await _band(db, [12, 12, 12, 12, 12], "Zed Band")
    await _songs(db, "Nia Quillfeather", 5)  # in the catalog, not in the game
    code = await create_test_game(db, status="waiting")
    token = await fetch_manager_token(db, code)
    assert await db.fetchval(SAVE, code, keys) == 60
    pool = {
        r["song_id"]
        for r in await db.fetch("SELECT song_id FROM game_song_pool WHERE game_code = $1", code)
    }

    played = []
    for _ in range(60):
        row = await db.fetchrow(
            "SELECT song_id FROM select_next_song($1, $2, NULL::uuid, NULL::integer)", code, token
        )
        played.append(row["song_id"])
    with pytest.raises(asyncpg.PostgresError, match="no_more_songs"):
        await db.fetch(
            "SELECT * FROM select_next_song($1, $2, NULL::uuid, NULL::integer)", code, token
        )
    assert len(played) == len(set(played)) == 60
    assert set(played) == pool


# ---------------------------------------------------------------------------
# The table and the migration
# ---------------------------------------------------------------------------


async def test_whole_names_table_is_locked_down(db: asyncpg.Connection) -> None:
    """RLS on, no policy, nothing granted to anon or authenticated, not in the
    Realtime publication, no foreign key (durable, outside the game sweep).
    service_role holds explicit base privileges, as for the 061 tables."""
    table = "public.artist_whole_names"
    assert await db.fetchval(
        "SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass", table
    ) is True
    assert await db.fetch(
        "SELECT policyname FROM pg_policies "
        "WHERE schemaname = 'public' AND tablename = 'artist_whole_names'"
    ) == []
    for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        for role in ("anon", "authenticated"):
            assert await db.fetchval(
                "SELECT has_table_privilege($1, $2, $3)", role, table, privilege
            ) is False, f"{role} must not have {privilege}"
        assert await db.fetchval(
            "SELECT has_table_privilege('service_role', $1, $2)", table, privilege
        ) is True, f"service_role must hold {privilege}"
    assert await db.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_publication_tables "
        "WHERE pubname = 'supabase_realtime' AND tablename = 'artist_whole_names')"
    ) is False
    assert await db.fetchval(
        "SELECT count(*) FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'f'",
        table,
    ) == 0


async def test_migration_takes_no_lock_on_existing_tables(db: asyncpg.Connection) -> None:
    """Migration 062 creates new objects only: applying it locks no existing
    table (active_games, songs, ...), so it is safe while games are live. The
    file runs here without its COMMIT, the locks are read, and it is rolled
    back."""
    sql = MIGRATION.read_text(encoding="utf-8")
    body, sep, tail = sql.rpartition("COMMIT;")
    assert sep and tail.strip() == ""
    await db.execute(body)  # BEGIN; ... : the transaction stays open
    try:
        rows = await db.fetch(
            """
            SELECT DISTINCT c.relname
              FROM pg_locks l
              JOIN pg_class c ON c.oid = l.relation
             WHERE l.pid = pg_backend_pid()
               AND l.locktype = 'relation'
               AND c.relnamespace = 'public'::regnamespace
            """
        )
    finally:
        await db.execute("ROLLBACK")
    assert {r["relname"] for r in rows} <= {"artist_whole_names", "artist_whole_names_pkey"}
