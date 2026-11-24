"""Custom setlists (migration 061): the artist alias table and the song demand
queue.

Spec: docs/data-model.md (artist_aliases, song_demand), docs/rpc-functions.md
(record_song_demand) and docs/planning/2026-11-24-custom-setlist-design.md §7
and §13.

artist_aliases maps a spelling a host may type to one catalog artist key.
song_demand counts the list lines that matched no catalog song, for the
maintainer. Both are durable and closed to players. Every value here is made
up: real alias rows are private catalog data and are never committed.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game

pytestmark = [pytest.mark.needs_docker, pytest.mark.asyncio]

ADD_ALIAS = "INSERT INTO artist_aliases (alias, artist_key) VALUES ($1, $2)"
RECORD = "SELECT record_song_demand($1::text[], $2::text[])"
DEMAND = "SELECT raw_line, request_count, status FROM song_demand WHERE line_key = $1"


async def _demand_rows(conn: asyncpg.Connection) -> int:
    return await conn.fetchval("SELECT count(*) FROM song_demand")


# ---------------------------------------------------------------------------
# artist_aliases
# ---------------------------------------------------------------------------


async def test_alias_must_be_lowercase_and_trimmed(db: asyncpg.Connection) -> None:
    for bad in (" Omer Adam", "Omer Adam", "omer adam ", " omer adam", "", "   "):
        with pytest.raises(asyncpg.CheckViolationError):
            await db.execute(ADD_ALIAS, bad, "example artist")
    await db.execute(ADD_ALIAS, "omer adam", "example artist")
    assert await db.fetchval(
        "SELECT artist_key FROM artist_aliases WHERE alias = 'omer adam'"
    ) == "example artist"


async def test_alias_maps_to_one_artist(db: asyncpg.Connection) -> None:
    """A spelling names one artist; one artist may have many spellings."""
    await db.execute(ADD_ALIAS, "spelling one", "example artist")
    await db.execute(ADD_ALIAS, "spelling two", "example artist")
    with pytest.raises(asyncpg.UniqueViolationError):
        await db.execute(ADD_ALIAS, "spelling one", "another artist")
    rows = await db.fetch(
        "SELECT alias FROM artist_aliases WHERE artist_key = $1 ORDER BY alias", "example artist"
    )
    assert [r["alias"] for r in rows] == ["spelling one", "spelling two"]


async def test_alias_artist_key_is_indexed(db: asyncpg.Connection) -> None:
    defs = await db.fetch(
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'artist_aliases'"
    )
    assert any(r["indexdef"].endswith("(artist_key)") for r in defs), defs


# ---------------------------------------------------------------------------
# record_song_demand
# ---------------------------------------------------------------------------


async def test_record_demand_inserts_then_counts(db: asyncpg.Connection) -> None:
    assert await db.fetchval(RECORD, ["queen innuendo"], ["Queen - Innuendo"]) == 1
    assert await db.fetchval(RECORD, ["queen innuendo"], ["QUEEN - Innuendo "]) == 1
    row = await db.fetchrow(
        "SELECT raw_line, request_count FROM song_demand WHERE line_key = 'queen innuendo'"
    )
    assert (row["raw_line"], row["request_count"]) == ("Queen - Innuendo", 2)
    assert (await db.fetchrow(DEMAND, "queen innuendo"))["status"] == "pending"


async def test_record_demand_keeps_first_requested_at(db: asyncpg.Connection) -> None:
    await db.fetchval(RECORD, ["example line"], ["Example - Line"])
    await db.execute(
        "UPDATE song_demand SET first_requested_at = '2026-01-01 00:00:00+00', "
        "last_requested_at = '2026-01-01 00:00:00+00'"
    )
    await db.fetchval(RECORD, ["example line"], ["Example - Line"])
    row = await db.fetchrow(
        "SELECT first_requested_at = '2026-01-01 00:00:00+00' AS first_kept, "
        "last_requested_at > '2026-01-01 00:00:00+00' AS last_moved FROM song_demand"
    )
    assert dict(row) == {"first_kept": True, "last_moved": True}


async def test_record_demand_repeated_key_in_one_call(db: asyncpg.Connection) -> None:
    """Ruling B: one paste can name the same missing song twice. The key
    counts once for that call and the first line for it wins (by position,
    not by sort order: the first line here sorts last)."""
    touched = await db.fetchval(
        RECORD,
        ["dup key", "other key", "dup key"],
        ["Zulu - First Take", "Other - Line", "Alpha - Later Take"],
    )
    assert touched == 2
    assert await _demand_rows(db) == 2
    row = await db.fetchrow(DEMAND, "dup key")
    assert (row["raw_line"], row["request_count"]) == ("Zulu - First Take", 1)
    assert (await db.fetchrow(DEMAND, "other key"))["request_count"] == 1

    # A second call that repeats the key again still adds one.
    assert await db.fetchval(RECORD, ["dup key", "dup key"], ["x", "y"]) == 1
    row = await db.fetchrow(DEMAND, "dup key")
    assert (row["raw_line"], row["request_count"]) == ("Zulu - First Take", 2)


async def test_record_demand_rejects_unequal_arrays(db: asyncpg.Connection) -> None:
    for keys, lines in (
        (["key a", "key b"], ["Line A"]),
        (["key a"], ["Line A", "Line B"]),
        (None, ["Line A"]),
        (["key a"], []),
    ):
        with pytest.raises(asyncpg.PostgresError, match="demand_arrays_unequal") as exc:
            await db.fetchval(RECORD, keys, lines)
        assert exc.value.sqlstate == "22023"
    assert await _demand_rows(db) == 0


async def test_record_demand_empty_or_null_arrays_record_nothing(
    db: asyncpg.Connection,
) -> None:
    for keys, lines in (([], []), (None, None), ([], None), (None, [])):
        assert await db.fetchval(RECORD, keys, lines) == 0
    assert await _demand_rows(db) == 0


async def test_record_demand_null_element_fails(db: asyncpg.Connection) -> None:
    """A NULL key or line is a caller bug: it is not skipped, the table's
    NOT NULL refuses it and the call writes nothing."""
    for keys, lines in ((["key a", None], ["Line A", "Line B"]), (["key a"], [None])):
        with pytest.raises(asyncpg.NotNullViolationError):
            await db.fetchval(RECORD, keys, lines)
    assert await _demand_rows(db) == 0


@pytest.mark.parametrize("status", ["approved", "rejected", "added"])
async def test_rejected_status_survives_a_new_request(
    db: asyncpg.Connection, status: str
) -> None:
    """The maintainer's verdict stays; the count still rises."""
    await db.fetchval(RECORD, ["example line"], ["Example - Line"])
    await db.execute("UPDATE song_demand SET status = $1 WHERE line_key = 'example line'", status)
    await db.fetchval(RECORD, ["example line"], ["Example - Line again"])
    row = await db.fetchrow(DEMAND, "example line")
    assert dict(row) == {"raw_line": "Example - Line", "request_count": 2, "status": status}


async def test_demand_status_is_checked(db: asyncpg.Connection) -> None:
    await db.fetchval(RECORD, ["example line"], ["Example - Line"])
    with pytest.raises(asyncpg.CheckViolationError):
        await db.execute("UPDATE song_demand SET status = 'done'")


# ---------------------------------------------------------------------------
# Both tables: durable and closed to players
# ---------------------------------------------------------------------------


async def test_support_tables_survive_the_game_sweep(db: asyncpg.Connection) -> None:
    code = await create_test_game(db)
    await db.execute(ADD_ALIAS, "example spelling", "example artist")
    await db.fetchval(RECORD, ["example line"], ["Example - Line"])
    await db.execute(
        "UPDATE active_games SET expires_at = now() - interval '1 minute' WHERE game_code = $1",
        code,
    )
    assert await db.fetchval("SELECT cleanup_expired_games()") >= 1
    assert await db.fetchval("SELECT count(*) FROM artist_aliases") == 1
    assert await _demand_rows(db) == 1


async def test_support_tables_are_locked_down(db: asyncpg.Connection) -> None:
    """RLS on, no policy, nothing granted to anon or authenticated, not in the
    Realtime publication, and no foreign key (durable, outside the sweep).
    service_role keeps its base privileges: the backend reads artist_aliases
    through PostgREST."""
    for table in ("artist_aliases", "song_demand"):
        assert await db.fetchval(
            "SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass", f"public.{table}"
        ) is True
        assert await db.fetch(
            "SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1",
            table,
        ) == []
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            for role in ("anon", "authenticated"):
                assert await db.fetchval(
                    "SELECT has_table_privilege($1, $2, $3)", role, f"public.{table}", privilege
                ) is False, f"{role} must not have {privilege} on {table}"
            assert await db.fetchval(
                "SELECT has_table_privilege('service_role', $1, $2)", f"public.{table}", privilege
            ) is True, f"service_role must keep {privilege} on {table}"
        assert await db.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_publication_tables "
            "WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = $1)",
            table,
        ) is False
        assert await db.fetchval(
            "SELECT count(*) FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'f'",
            f"public.{table}",
        ) == 0
