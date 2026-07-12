"""set_song_availability(): persists dead-video scan verdicts (migration 045).

Spec: docs/rpc-functions.md §6 and db/migrations/045_song_unavailable.sql.

The function takes (p_flag_ids uuid[], p_clear_ids uuid[]) and returns one row
{flagged, cleared} counting the rows actually changed. Semantics under test:

  * flagging sets unavailable_at = now() ONLY where it is currently NULL --
    a re-confirmed dead song keeps its first-noticed timestamp (and the row
    is not rewritten on every weekly scan)
  * clearing sets unavailable_at = NULL ONLY where it is currently NOT NULL
  * both lists apply in one call; empty/NULL arrays are no-ops
  * service-role only: anon EXECUTE is revoked (also covered in
    test_rls_function_grants.py alongside the other backend-only RPCs)
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import create_test_song

pytestmark = pytest.mark.needs_docker


async def _call(
    conn: asyncpg.Connection,
    flag_ids: list[uuid.UUID],
    clear_ids: list[uuid.UUID],
) -> asyncpg.Record:
    row = await conn.fetchrow(
        "SELECT flagged, cleared FROM set_song_availability($1::uuid[], $2::uuid[])",
        flag_ids,
        clear_ids,
    )
    assert row is not None
    return row


async def _unavailable_at(conn: asyncpg.Connection, song_id: uuid.UUID):
    return await conn.fetchval("SELECT unavailable_at FROM songs WHERE id = $1", song_id)


@pytest.mark.asyncio
async def test_flag_sets_timestamp_and_counts(db: asyncpg.Connection) -> None:
    sid = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])
    assert await _unavailable_at(db, sid) is None

    row = await _call(db, [sid], [])
    assert row["flagged"] == 1
    assert row["cleared"] == 0
    assert await _unavailable_at(db, sid) is not None


@pytest.mark.asyncio
async def test_reflag_keeps_first_noticed_timestamp(db: asyncpg.Connection) -> None:
    """A song already flagged is left untouched: the timestamp records when
    the video was FIRST confirmed dead, and the weekly re-scan must not
    rewrite (or bump) it."""
    sid = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])
    await db.execute(
        "UPDATE songs SET unavailable_at = now() - interval '3 days' WHERE id = $1", sid
    )
    first_seen = await _unavailable_at(db, sid)

    row = await _call(db, [sid], [])
    assert row["flagged"] == 0  # nothing actually changed
    assert await _unavailable_at(db, sid) == first_seen


@pytest.mark.asyncio
async def test_clear_resets_flagged_song(db: asyncpg.Connection) -> None:
    sid = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", sid)

    row = await _call(db, [], [sid])
    assert row["cleared"] == 1
    assert row["flagged"] == 0
    assert await _unavailable_at(db, sid) is None


@pytest.mark.asyncio
async def test_clear_of_already_playable_song_is_a_noop(db: asyncpg.Connection) -> None:
    sid = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])

    row = await _call(db, [], [sid])
    assert row["cleared"] == 0
    assert await _unavailable_at(db, sid) is None


@pytest.mark.asyncio
async def test_flag_and_clear_apply_in_one_call(db: asyncpg.Connection) -> None:
    to_flag = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])
    to_clear = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])
    untouched = await create_test_song(db, youtube_id=uuid.uuid4().hex[:11])
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", to_clear)

    row = await _call(db, [to_flag], [to_clear])
    assert row["flagged"] == 1
    assert row["cleared"] == 1
    assert await _unavailable_at(db, to_flag) is not None
    assert await _unavailable_at(db, to_clear) is None
    assert await _unavailable_at(db, untouched) is None


@pytest.mark.asyncio
async def test_empty_arrays_are_a_noop(db: asyncpg.Connection) -> None:
    row = await _call(db, [], [])
    assert row["flagged"] == 0
    assert row["cleared"] == 0


@pytest.mark.asyncio
async def test_null_arrays_are_a_noop(db: asyncpg.Connection) -> None:
    """The COALESCE guard makes NULL arrays behave like empty ones."""
    row = await db.fetchrow(
        "SELECT flagged, cleared FROM set_song_availability(NULL::uuid[], NULL::uuid[])"
    )
    assert row is not None
    assert row["flagged"] == 0
    assert row["cleared"] == 0


@pytest.mark.asyncio
async def test_unknown_ids_are_ignored(db: asyncpg.Connection) -> None:
    row = await _call(db, [uuid.uuid4()], [uuid.uuid4()])
    assert row["flagged"] == 0
    assert row["cleared"] == 0
