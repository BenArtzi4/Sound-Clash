"""The catalog snapshot for setlist matching (app/services/setlist_catalog.py).

The loader reads songs, the soundtrack genres' song_genres rows and
artist_aliases through the supabase client, in pages of 1,000 rows (PostgREST
returns at most 1,000 per request), and keeps the CatalogIndex for
CACHE_SECONDS. Every name here is made up.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from typing import Any

import pytest

from app.db.errors import InternalError
from app.db.supabase_client import get_supabase_client
from app.services import setlist_catalog
from app.services.setlist_catalog import CACHE_SECONDS, get_catalog_index
from app.services.setlist_text import artist_keys, norm

from ._fake_supabase import FakeAPIError
from ._helpers import insert_song

pytestmark = pytest.mark.needs_docker

# The backend test DB re-seeds only migration 008's genres, which predate the
# soundtrack split (migration 026), so the two soundtrack slugs are added here.
ADD_SOUNDTRACK_GENRES = """
    INSERT INTO genres (name, slug) VALUES
      ('Soundtracks', 'soundtracks'),
      ('Israeli Soundtracks', 'israeli-soundtracks')
    ON CONFLICT (slug) DO NOTHING
"""

# 1,500 songs in one statement: more than one 1,000-row page.
INSERT_MANY_SONGS = """
    INSERT INTO songs (title, artist, youtube_id)
    SELECT 'Paging Song ' || g, 'Paging Artist ' || (g % 40), lpad(g::text, 11, '0')
      FROM generate_series(1, $1::int) AS g
"""


def _count_table_calls(monkeypatch: pytest.MonkeyPatch) -> Counter[str]:
    """Count client.table(name) calls: one per page the loader asks for."""
    fake = get_supabase_client()
    real_table = fake.table
    calls: Counter[str] = Counter()

    def counting(name: str) -> Any:
        calls[name] += 1
        return real_table(name)

    monkeypatch.setattr(fake, "table", counting)
    return calls


async def test_loads_more_than_one_page(client, db) -> None:
    await db.execute(INSERT_MANY_SONGS, 1500)

    index = await get_catalog_index()

    expected = {str(r["id"]) for r in await db.fetch("SELECT id FROM songs")}
    ids = [song.id for song in index.songs]
    assert len(ids) == 1500
    assert set(ids) == expected  # no row skipped or repeated across the pages


async def test_leaves_out_unavailable_songs(client, db) -> None:
    playable = await insert_song(db, title="Copper Window", artist="Mira Felt")
    dead = await insert_song(db, title="Paper Harbor", artist="Mira Felt")
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", dead)

    index = await get_catalog_index()

    assert [song.id for song in index.songs] == [str(playable)]


async def test_marks_soundtracks(client, db) -> None:
    await db.execute(ADD_SOUNDTRACK_GENRES)
    film = await insert_song(
        db, title="Ocean Of Glass", artist="Lantern Bay", genre_slugs=["soundtracks"]
    )
    israeli = await insert_song(
        db, title="שיר הנמל", artist="סרט הנמל", genre_slugs=["israeli-soundtracks"]
    )
    both = await insert_song(
        db, title="Sky Parade", artist="Orbit Fair", genre_slugs=["rock", "soundtracks"]
    )
    plain = await insert_song(db, title="Night Ferry", artist="Pale Rowan", genre_slugs=["rock"])
    no_genre = await insert_song(db, title="Brass Moon", artist="Pale Rowan")

    index = await get_catalog_index()

    marked = {song.id: song.is_soundtrack for song in index.songs}
    assert marked == {
        str(film): True,
        str(israeli): True,
        str(both): True,
        str(plain): False,
        str(no_genre): False,
    }


async def test_loads_aliases(client, db) -> None:
    await insert_song(db, title="שביל הצפצפות", artist="תמרור כחול")
    await db.execute(
        "INSERT INTO artist_aliases (alias, artist_key) VALUES ($1, $2)",
        "tamrur kahol",
        "תמרור כחול",
    )

    index = await get_catalog_index()

    assert index.aliases == {"tamrur kahol": norm("תמרור כחול")}
    assert index.artist_key("Tamrur Kahol") == norm("תמרור כחול")


async def test_second_call_uses_the_cache(client, db, monkeypatch) -> None:
    await db.execute(INSERT_MANY_SONGS, 1500)
    calls = _count_table_calls(monkeypatch)

    first = await get_catalog_index()
    assert calls["songs"] == 2  # a full page of 1,000, then a short page of 500

    second = await get_catalog_index()
    assert second is first
    assert calls["songs"] == 2  # no new request


async def test_keys_keep_the_main_artist_first(client, db) -> None:
    # The songs.artist_keys column sorts its keys (array_agg DISTINCT), which
    # loses the main artist; the loader splits the artist string itself.
    await insert_song(db, title="Velvet Signal", artist="Zora Quill ft. Amber Hollis")

    index = await get_catalog_index()

    (song,) = index.songs
    assert song.artist_keys == ("zora quill", "amber hollis")
    assert song.artist_keys == artist_keys("Zora Quill ft. Amber Hollis")


async def test_reloads_after_cache_seconds(client, db, monkeypatch) -> None:
    now = [5000.0]
    monkeypatch.setattr(setlist_catalog, "monotonic", lambda: now[0])
    await insert_song(db, title="Glass Orchard", artist="Tavi Morrow")

    first = await get_catalog_index()
    await insert_song(db, title="Second Orchard", artist="Tavi Morrow")

    now[0] += CACHE_SECONDS - 1
    assert await get_catalog_index() is first

    now[0] += 2
    reloaded = await get_catalog_index()
    assert reloaded is not first
    assert sorted(song.title for song in reloaded.songs) == ["Glass Orchard", "Second Orchard"]


async def test_concurrent_first_calls_load_once(client, db, monkeypatch) -> None:
    await insert_song(db, title="Quiet Engine", artist="Nell Arbor")
    calls = _count_table_calls(monkeypatch)

    first, second = await asyncio.gather(get_catalog_index(), get_catalog_index())

    assert first is second
    assert calls["songs"] == 1


async def test_a_reset_during_a_load_is_not_kept(client, db, monkeypatch) -> None:
    # A load that began before a reset may hold the old catalog: it is
    # returned to its caller but not cached.
    await insert_song(db, title="Lamp Signal", artist="Odette Vane")
    calls = _count_table_calls(monkeypatch)
    counting = get_supabase_client().table

    def reset_while_loading(name: str) -> Any:
        if name == "songs" and calls["songs"] == 0:
            setlist_catalog.reset_catalog_index_cache()
        return counting(name)

    monkeypatch.setattr(get_supabase_client(), "table", reset_while_loading)
    first = await get_catalog_index()
    assert [song.title for song in first.songs] == ["Lamp Signal"]

    second = await get_catalog_index()
    assert second is not first
    assert calls["songs"] == 2


async def test_failed_load_caches_nothing(client, db, monkeypatch) -> None:
    await insert_song(db, title="Rust Meadow", artist="Iris Calder")
    fake = get_supabase_client()
    real_table = fake.table

    class _BrokenQuery:
        """A songs query whose request fails, as a dropped connection would."""

        def __getattr__(self, name: str) -> Any:
            return lambda *args, **kwargs: self

        def execute(self) -> Any:
            raise FakeAPIError(code="XX000", message="connection reset")

    def broken(name: str) -> Any:
        return _BrokenQuery() if name == "songs" else real_table(name)

    monkeypatch.setattr(fake, "table", broken)
    with pytest.raises(InternalError):
        await get_catalog_index()

    monkeypatch.setattr(fake, "table", real_table)
    index = await get_catalog_index()
    assert [song.title for song in index.songs] == ["Rust Meadow"]
