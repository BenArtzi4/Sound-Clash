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
        "is_soundtrack": False,
        "source": None,
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
            "is_soundtrack": False,
            "source": None,
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
            "is_soundtrack": True,
            "source": "Movie",
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "Updated"


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


async def test_get_unknown_id_404(admin_client) -> None:
    resp = await admin_client.get(
        "/admin/songs/00000000-0000-0000-0000-000000000000"
    )
    assert resp.status_code == 404


async def test_delete_unknown_id_404(admin_client) -> None:
    resp = await admin_client.delete(
        "/admin/songs/00000000-0000-0000-0000-000000000000"
    )
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
            "is_soundtrack": False,
            "source": None,
            "genre_ids": [str(rock[0])],
        },
    )
    assert resp.status_code == 404
