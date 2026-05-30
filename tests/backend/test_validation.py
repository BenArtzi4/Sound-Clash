"""Request body validation; Pydantic constraints surface as 400."""

from __future__ import annotations

import pytest

from ._helpers import fetch_genre_ids, insert_game

pytestmark = pytest.mark.needs_docker


async def test_create_game_extra_fields_rejected(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={
            "selected_genres": [str(genres[0])],
            "secret_field": "nope",
        },
    )
    assert resp.status_code == 400


async def test_team_name_blank_rejected(client, db) -> None:
    code, _ = await insert_game(db, status="waiting")
    resp = await client.post(f"/games/{code}/teams", json={"name": "   "})
    assert resp.status_code == 400


async def test_team_name_too_long_rejected(client, db) -> None:
    code, _ = await insert_game(db, status="waiting")
    resp = await client.post(f"/games/{code}/teams", json={"name": "X" * 31})
    assert resp.status_code == 400


async def test_admin_song_invalid_youtube_id(admin_client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await admin_client.post(
        "/admin/songs",
        json={
            "title": "X",
            "artist": "Y",
            "youtube_id": "WAY_TOO_LONG_FOR_YT_ID_FORMAT_!!!",
            "start_time": 0,
            "genre_ids": [str(genres[0])],
        },
    )
    assert resp.status_code == 400
