"""POST /games/{code}/select-song — random song picker + start_round RPC."""

from __future__ import annotations

import pytest

from ._helpers import (
    fetch_genre_ids,
    insert_game,
    insert_song,
    manager_headers,
)

pytestmark = pytest.mark.needs_docker


async def test_happy_path(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    await insert_song(db, genre_slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    resp = await client.post(
        f"/games/{code}/select-song", json={}, headers=manager_headers(token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["round_number"] == 1
    assert body["song"]["youtube_id"]
    assert "id" in body["song"]


async def test_respects_selected_genres(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    pop_song = await insert_song(db, genre_slugs=["pop"])
    rock_song = await insert_song(db, genre_slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    resp = await client.post(
        f"/games/{code}/select-song", json={}, headers=manager_headers(token)
    )
    assert resp.status_code == 200
    chosen = resp.json()["song"]["id"]
    assert chosen == str(rock_song)
    assert chosen != str(pop_song)


async def test_excludes_already_played(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    song1 = await insert_song(db, genre_slugs=["rock"], title="One")
    song2 = await insert_song(db, genre_slugs=["rock"], title="Two")
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    headers = manager_headers(token)
    r1 = await client.post(f"/games/{code}/select-song", json={}, headers=headers)
    assert r1.status_code == 200
    r2 = await client.post(f"/games/{code}/select-song", json={}, headers=headers)
    assert r2.status_code == 200
    chosen = {r1.json()["song"]["id"], r2.json()["song"]["id"]}
    assert chosen == {str(song1), str(song2)}


async def test_exhausted_pool_is_409(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    await insert_song(db, genre_slugs=["rock"])
    code, token = await insert_game(db, status="playing", selected_genres=rock)
    headers = manager_headers(token)
    r1 = await client.post(f"/games/{code}/select-song", json={}, headers=headers)
    assert r1.status_code == 200
    r2 = await client.post(f"/games/{code}/select-song", json={}, headers=headers)
    assert r2.status_code == 409
    assert r2.json()["error"] == "conflict"


async def test_ended_game_is_410(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, token = await insert_game(db, status="ended", selected_genres=rock)
    resp = await client.post(
        f"/games/{code}/select-song", json={}, headers=manager_headers(token)
    )
    assert resp.status_code == 410


async def test_manager_token_required(client, db) -> None:
    rock = await fetch_genre_ids(db, slugs=["rock"])
    code, _ = await insert_game(db, status="playing", selected_genres=rock)
    resp = await client.post(f"/games/{code}/select-song", json={})
    assert resp.status_code == 401
