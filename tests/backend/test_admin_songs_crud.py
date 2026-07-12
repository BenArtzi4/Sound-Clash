"""Admin songs CRUD; list, get, create, update, delete."""

from __future__ import annotations

import pytest

from ._helpers import fetch_genre_ids, insert_song

pytestmark = pytest.mark.needs_docker


async def test_admin_required(client) -> None:
    resp = await client.get("/admin/songs")
    assert resp.status_code == 401


async def test_create_and_get(admin_client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    payload = {
        "title": "Created",
        "artist": "Tester",
        "youtube_id": "abcDEF12345",
        "start_time": 30,
        "genre_ids": [str(rock[0])],
    }
    create_resp = await admin_client.post("/admin/songs", json=payload)
    assert create_resp.status_code == 201, create_resp.text
    song = create_resp.json()
    assert song["title"] == "Created"
    assert song["youtube_id"] == "abcDEF12345"

    get_resp = await admin_client.get(f"/admin/songs/{song['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == song["id"]


async def test_invalid_youtube_id_400(admin_client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    resp = await admin_client.post(
        "/admin/songs",
        json={
            "title": "Bad",
            "artist": "Bad",
            "youtube_id": "tooshort",
            "start_time": 0,
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 400


async def test_update(admin_client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    song_id = await insert_song(db, genre_slugs=["rock"])
    resp = await admin_client.put(
        f"/admin/songs/{song_id}",
        json={
            "title": "Updated",
            "artist": "Updated",
            "youtube_id": "ZZZZZZZZZZZ",
            "start_time": 5,
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "Updated"


async def test_create_and_update_release_year(admin_client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    create = await admin_client.post(
        "/admin/songs",
        json={
            "title": "Yr",
            "artist": "Yr",
            "youtube_id": "yrSONG12345",
            "start_time": 0,
            "release_year": 1991,
            "genre_ids": [str(rock[0])],
        },
    )
    assert create.status_code == 201, create.text
    song = create.json()
    assert song["release_year"] == 1991

    # Omitting the year (null) on update clears it.
    upd = await admin_client.put(
        f"/admin/songs/{song['id']}",
        json={
            "title": "Yr",
            "artist": "Yr",
            "youtube_id": "yrSONG12345",
            "start_time": 0,
            "release_year": None,
            "genre_ids": [str(rock[0])],
        },
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["release_year"] is None


async def test_create_without_release_year_defaults_null(admin_client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    resp = await admin_client.post(
        "/admin/songs",
        json={
            "title": "NoYr",
            "artist": "NoYr",
            "youtube_id": "noYR1234567",
            "start_time": 0,
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["release_year"] is None


async def test_release_year_out_of_range_400(admin_client, db) -> None:
    # Pydantic constraint violations are mapped to 400 here (same as a bad
    # youtube_id), not FastAPI's default 422.
    rock = await fetch_genre_ids(db, slugs=["rock"])
    resp = await admin_client.post(
        "/admin/songs",
        json={
            "title": "Bad",
            "artist": "Bad",
            "youtube_id": "badYR123456",
            "start_time": 0,
            "release_year": 1850,
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 400


async def test_delete(admin_client, db) -> None:
    song_id = await insert_song(db)
    resp = await admin_client.delete(f"/admin/songs/{song_id}")
    assert resp.status_code == 204
    row = await db.fetchrow("SELECT 1 FROM songs WHERE id = $1", song_id)
    assert row is None


async def test_list_pagination_and_search(admin_client, db) -> None:
    await insert_song(db, title="AAA First", genre_slugs=["rock"])
    await insert_song(db, title="BBB Second", genre_slugs=["rock"])
    await insert_song(db, title="CCC Third", genre_slugs=["rock"])
    resp = await admin_client.get("/admin/songs?per_page=2&page=1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] >= 3
    assert len(body["items"]) == 2

    search = await admin_client.get("/admin/songs?search=Second")
    assert search.status_code == 200
    titles = {s["title"] for s in search.json()["items"]}
    assert "BBB Second" in titles


async def test_list_pages_through_full_total(admin_client, db) -> None:
    # Five sortable titles; page through 2 at a time. Guards the regression
    # where the list fetched every row and counted/sliced in Python — which
    # capped both the window and `total` at PostgREST's 1000-row ceiling.
    for n in ("1", "2", "3", "4", "5"):
        await insert_song(db, title=f"Zpage {n}", genre_slugs=["rock"])
    pages = [
        (await admin_client.get(f"/admin/songs?search=Zpage&per_page=2&page={p}")).json()
        for p in (1, 2, 3)
    ]
    # `total` is the exact count of all matches, not just the returned page.
    assert all(pg["total"] == 5 for pg in pages)
    assert [len(pg["items"]) for pg in pages] == [2, 2, 1]
    # Server-side range() returns the correct, ordered, non-overlapping window.
    titles = [s["title"] for pg in pages for s in pg["items"]]
    assert titles == [f"Zpage {n}" for n in ("1", "2", "3", "4", "5")]


async def test_list_genre_filter(admin_client, db) -> None:
    await insert_song(db, title="RockSong", genre_slugs=["rock"])
    await insert_song(db, title="PopSong", genre_slugs=["pop"])
    resp = await admin_client.get("/admin/songs?genre=rock")
    assert resp.status_code == 200
    titles = {s["title"] for s in resp.json()["items"]}
    assert "RockSong" in titles
    assert "PopSong" not in titles


async def test_list_genre_filter_unknown_returns_empty(admin_client) -> None:
    resp = await admin_client.get("/admin/songs?genre=nonexistent_slug")
    assert resp.status_code == 200
    assert resp.json()["items"] == []
    assert resp.json()["total"] == 0


async def test_list_genre_real_but_empty_pool_returns_empty(admin_client, db) -> None:
    # `jazz` is a real seeded genre, but no song is tagged with it here, so its
    # song pool is empty (distinct from the unknown-slug case above).
    resp = await admin_client.get("/admin/songs?genre=jazz")
    assert resp.status_code == 200
    assert resp.json()["items"] == []
    assert resp.json()["total"] == 0


async def test_list_response_includes_genres_per_song(admin_client, db) -> None:
    await insert_song(db, title="GenresPing", genre_slugs=["rock", "pop"])
    resp = await admin_client.get("/admin/songs?search=GenresPing")
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) >= 1
    row = next(s for s in items if s["title"] == "GenresPing")
    slugs = sorted(g["slug"] for g in row["genres"])
    assert slugs == ["pop", "rock"]
    # Each embedded genre has the full id/name/slug shape the admin UI needs.
    assert all({"id", "name", "slug"} <= g.keys() for g in row["genres"])


async def test_get_song_includes_genres(admin_client, db) -> None:
    song_id = await insert_song(db, genre_slugs=["rock"])
    resp = await admin_client.get(f"/admin/songs/{song_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert [g["slug"] for g in body["genres"]] == ["rock"]


async def test_create_response_includes_attached_genres(admin_client, db) -> None:
    rock, pop = await fetch_genre_ids(db, slugs=["rock", "pop"])
    resp = await admin_client.post(
        "/admin/songs",
        json={
            "title": "WithGenresCreate",
            "artist": "X",
            "youtube_id": "qqqqqqqqqqq",
            "start_time": 0,
            "genre_ids": [str(rock), str(pop)],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert sorted(g["slug"] for g in body["genres"]) == ["pop", "rock"]


async def test_get_unknown_id_404(admin_client) -> None:
    resp = await admin_client.get("/admin/songs/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


async def test_delete_unknown_id_404(admin_client) -> None:
    resp = await admin_client.delete("/admin/songs/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


async def test_update_unknown_id_404(admin_client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    resp = await admin_client.put(
        "/admin/songs/00000000-0000-0000-0000-000000000000",
        json={
            "title": "X",
            "artist": "Y",
            "youtube_id": "abcDEF12345",
            "start_time": 0,
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 404


async def test_update_with_new_youtube_id_clears_unavailable_flag(admin_client, db) -> None:
    """Fixing a dead song by swapping in a new video makes it playable again
    immediately (mig 045) -- the dead verdict belongs to the video, not the
    song row -- instead of staying skipped until the next availability scan."""
    rock = await fetch_genre_ids(db, slugs=["rock"])
    song_id = await insert_song(db, youtube_id="deadVIDEO01", genre_slugs=["rock"])
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", song_id)

    resp = await admin_client.put(
        f"/admin/songs/{song_id}",
        json={
            "title": "Fixed",
            "artist": "Fixed",
            "youtube_id": "newVIDEO123",
            "start_time": 0,
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["unavailable_at"] is None
    assert await db.fetchval("SELECT unavailable_at FROM songs WHERE id = $1", song_id) is None


async def test_update_keeping_youtube_id_keeps_unavailable_flag(admin_client, db) -> None:
    """A metadata-only edit (same video) must NOT clear the dead verdict --
    the video is still dead; only the weekly scan's 200 (or a video swap)
    un-flags it."""
    rock = await fetch_genre_ids(db, slugs=["rock"])
    song_id = await insert_song(db, youtube_id="deadVIDEO01", genre_slugs=["rock"])
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", song_id)

    resp = await admin_client.put(
        f"/admin/songs/{song_id}",
        json={
            "title": "Renamed only",
            "artist": "Renamed only",
            "youtube_id": "deadVIDEO01",
            "start_time": 0,
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["unavailable_at"] is not None
    assert (
        await db.fetchval("SELECT unavailable_at FROM songs WHERE id = $1", song_id) is not None
    )
