"""songs.youtube_id uniqueness (migration 042).

A UNIQUE INDEX (songs_youtube_id_key) enforces one catalog row per YouTube
video, so a second songs row with an already-used youtube_id must be rejected
with a unique-violation (SQLSTATE 23505). Distinct youtube_ids are unaffected.

Spec: docs/data-model.md (songs table -- UNIQUE (youtube_id)).
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_song

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_duplicate_youtube_id_rejected(db: asyncpg.Connection) -> None:
    """Inserting a second song with the same youtube_id raises UniqueViolation."""
    await create_test_song(db, title="First", youtube_id="dupTubeId11")

    with pytest.raises(asyncpg.UniqueViolationError) as exc_info:
        await create_test_song(db, title="Second", youtube_id="dupTubeId11")

    # SQLSTATE 23505 = unique_violation.
    assert exc_info.value.sqlstate == "23505"


@pytest.mark.asyncio
async def test_distinct_youtube_ids_allowed(db: asyncpg.Connection) -> None:
    """Two songs with different youtube_ids coexist -- the constraint only
    forbids exact duplicates, not near-duplicates (e.g. a same-song, different
    video upload)."""
    id_a = await create_test_song(db, title="Song A", youtube_id="aaaaaaaaaaa")
    id_b = await create_test_song(db, title="Song B", youtube_id="bbbbbbbbbbb")

    assert id_a != id_b

    count = await db.fetchval("SELECT count(*) FROM songs")
    assert count == 2
