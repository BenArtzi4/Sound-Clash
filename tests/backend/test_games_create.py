"""POST /games; game creation and code generation."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

import pytest

from app.services.setlist_catalog import get_catalog_index

from ._fake_supabase import FakeAPIError
from ._helpers import fetch_genre_ids, insert_song

pytestmark = pytest.mark.needs_docker

GAME_CODE_RE = re.compile(r"^[A-HJ-NP-Z2-9]{6}$")


async def test_happy_path(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={"selected_genres": [str(genres[0])]},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert GAME_CODE_RE.match(body["game_code"]) is not None
    assert body["status"] == "waiting"
    assert "started_at" in body
    assert "expires_at" in body
    # The host's manager token is returned in the body so the browser can
    # store it and present it on subsequent manager-only endpoints.
    assert "manager_token" in body
    uuid.UUID(body["manager_token"])


async def test_validation_requires_genres(client) -> None:
    resp = await client.post("/games", json={"selected_genres": []})
    assert resp.status_code == 400
    assert resp.json()["error"] == "validation_error"


async def test_selected_decades_persisted(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={"selected_genres": [str(genres[0])], "selected_decades": [1980, 1990]},
    )
    assert resp.status_code == 201, resp.text
    assert sorted(resp.json()["selected_decades"]) == [1980, 1990]
    # It actually lands on the active_games row the picker reads.
    row = await db.fetchrow(
        "SELECT selected_decades FROM active_games WHERE game_code = $1",
        resp.json()["game_code"],
    )
    assert sorted(row["selected_decades"]) == [1980, 1990]


async def test_selected_decades_default_empty(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post("/games", json={"selected_genres": [str(genres[0])]})
    assert resp.status_code == 201
    assert resp.json()["selected_decades"] == []


async def test_selected_decades_out_of_range_rejected(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={"selected_genres": [str(genres[0])], "selected_decades": [1850]},
    )
    assert resp.status_code == 400
    assert resp.json()["error"] == "validation_error"


async def test_unique_token_per_game(client, db) -> None:
    """Each game's manager_token is independently random."""
    genres = await fetch_genre_ids(db, slugs=["rock"])
    payload = {"selected_genres": [str(genres[0])]}
    r1 = await client.post("/games", json=payload)
    r2 = await client.post("/games", json=payload)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["manager_token"] != r2.json()["manager_token"]


async def test_collision_retry(client, db, monkeypatch) -> None:
    """Force the first three generated codes to collide; the fourth wins."""
    from app.services import codes as codes_module

    real_gen = codes_module.generate_code
    seen_first = {"count": 0}

    # Pre-seed an active_games row that will collide with our forced code.
    forced = "BENCHX"
    await db.execute(
        """
        INSERT INTO active_games (game_code, status, expires_at)
        VALUES ($1, 'waiting', now() + interval '4 hours')
        """,
        forced,
    )

    def fake_gen() -> str:
        seen_first["count"] += 1
        if seen_first["count"] <= 2:
            return forced  # collision
        return real_gen()

    monkeypatch.setattr(codes_module, "generate_code", fake_gen)

    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={"selected_genres": [str(genres[0])]},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["game_code"] != forced
    assert seen_first["count"] >= 3


# --- Test-game flag (migration 051, issue #393) -----------------------------

PHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)
HEADLESS_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "HeadlessChrome/131.0.0.0 Safari/537.36"
)


async def _create_and_read_flag(client, db, headers: dict[str, str]) -> bool:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post("/games", json={"selected_genres": [str(genres[0])]}, headers=headers)
    assert resp.status_code == 201, resp.text
    return bool(
        await db.fetchval(
            "SELECT is_test FROM game_secrets WHERE game_code = $1", resp.json()["game_code"]
        )
    )


async def test_real_browser_game_is_not_a_test(client, db) -> None:
    assert await _create_and_read_flag(client, db, {"User-Agent": PHONE_UA}) is False


async def test_headless_browser_game_is_a_test(client, db) -> None:
    assert await _create_and_read_flag(client, db, {"User-Agent": HEADLESS_UA}) is True


async def test_non_browser_client_game_is_a_test(client, db) -> None:
    # Node fetch, curl and httpx never send a Mozilla/ user agent.
    assert await _create_and_read_flag(client, db, {"User-Agent": "node"}) is True


async def test_test_header_marks_a_real_browser_game(client, db) -> None:
    headers = {"User-Agent": PHONE_UA, "X-Sound-Clash-Test": "1"}
    assert await _create_and_read_flag(client, db, headers) is True


async def test_flag_does_not_change_the_response(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    resp = await client.post(
        "/games",
        json={"selected_genres": [str(genres[0])]},
        headers={"X-Sound-Clash-Test": "1"},
    )
    assert resp.status_code == 201
    assert "is_test" not in resp.json()


# --- A game from a pasted song list (custom setlists, phase 1 Task 7) --------
#
# The server repeats the check's match and saves the result as the game's song
# pool. Every name here is made up.

SETLIST_CATALOG = {  # title: artist
    "Paper Lanterns": "Velvet Comet",
    "Northern Static": "Velvet Comet",
    "Harbor Lights": "Glass Harbor",
    "Night Ferry": "Pale Rowan",
}
SETLIST_EMPTY_MESSAGE = "None of the songs in your list can play."


async def _seed_setlist_catalog(db) -> dict[str, uuid.UUID]:
    """The made-up catalog the list tests play from; song id by title."""
    return {
        title: await insert_song(db, title=title, artist=artist)
        for title, artist in SETLIST_CATALOG.items()
    }


async def _create_from_list(client, text: str, **extra: Any) -> Any:
    return await client.post("/games", json={"setlist": {"text": text}, **extra})


async def _pool(db, code: str) -> dict[str, int]:
    """The game's song pool as {title: tier}."""
    rows = await db.fetch(
        """
        SELECT s.title, p.tier
          FROM game_song_pool p JOIN songs s ON s.id = p.song_id
         WHERE p.game_code = $1
        """,
        code,
    )
    return {row["title"]: row["tier"] for row in rows}


async def _count(db, table: str) -> int:
    return int(await db.fetchval(f"SELECT count(*) FROM {table}"))  # noqa: S608


def _fail_rpc(monkeypatch, fake, name: str) -> None:
    """Make the fake client's ``name`` RPC fail as a dropped connection would."""
    real_rpc = fake.rpc

    class _Failing:
        def execute(self) -> Any:
            raise FakeAPIError(code="XX000", message="connection reset")

    def rpc(fn: str, params: dict[str, Any] | None = None) -> Any:
        return _Failing() if fn == name else real_rpc(fn, params)

    monkeypatch.setattr(fake, "rpc", rpc)


async def test_create_with_setlist_saves_the_pool(client, db) -> None:
    await _seed_setlist_catalog(db)

    resp = await _create_from_list(
        client, "Velvet Comet - Paper Lanterns\nNobody - Not A Real Song"
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["setlist"] == {"list_songs": 1, "same_artist_songs": 1}
    assert body["selected_genres"] == [] and body["selected_decades"] == []
    code = body["game_code"]
    setlist = await db.fetchrow(
        "SELECT ready, list_total FROM game_setlists WHERE game_code = $1", code
    )
    assert setlist["ready"] is True
    assert setlist["list_total"] == 2  # both song lines, found or not
    assert await _pool(db, code) == {"Paper Lanterns": 1, "Northern Static": 2}
    game = await db.fetchrow(
        "SELECT selected_genres, selected_decades FROM active_games WHERE game_code = $1", code
    )
    assert game["selected_genres"] == [] and game["selected_decades"] == []


async def test_create_with_setlist_answer_names_no_song(client, db) -> None:
    song_ids = await _seed_setlist_catalog(db)
    youtube_ids = [row["youtube_id"] for row in await db.fetch("SELECT youtube_id FROM songs")]

    resp = await _create_from_list(client, "Velvet Comet\nGlass Harbor - Harbor Lights")

    assert resp.status_code == 201, resp.text
    assert resp.json()["setlist"] == {"list_songs": 3, "same_artist_songs": 0}
    for value in [*(str(song_id) for song_id in song_ids.values()), *youtube_ids]:
        assert value not in resp.text
    assert "youtube_id" not in resp.text and "start_time" not in resp.text


async def test_create_with_setlist_records_demand(client, db) -> None:
    await _seed_setlist_catalog(db)

    resp = await _create_from_list(
        client, "Velvet Comet - Paper Lanterns\nNobody - Not A Real Song"
    )

    assert resp.status_code == 201, resp.text
    rows = await db.fetch("SELECT line_key, raw_line, request_count FROM song_demand")
    assert [dict(row) for row in rows] == [
        {
            "line_key": "nobody not a real song",
            "raw_line": "Nobody - Not A Real Song",
            "request_count": 1,
        }
    ]


async def test_create_with_both_or_neither_is_a_400(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    await _seed_setlist_catalog(db)
    payloads: list[dict[str, Any]] = [
        {"selected_genres": [str(genres[0])], "setlist": {"text": "Velvet Comet"}},
        {},
        {"setlist": None},
        {"selected_genres": [], "selected_decades": [1980]},
    ]

    for payload in payloads:
        resp = await client.post("/games", json=payload)
        assert resp.status_code == 400, payload
        assert resp.json()["error"] == "validation_error", payload

    assert await _count(db, "active_games") == 0


async def test_create_with_setlist_and_decades_is_a_400(client, db) -> None:
    await _seed_setlist_catalog(db)

    resp = await _create_from_list(client, "Velvet Comet", selected_decades=[1980])

    assert resp.status_code == 400
    assert resp.json()["error"] == "validation_error"
    assert await _count(db, "active_games") == 0


async def test_setlist_with_no_playable_song_is_a_400_and_creates_nothing(client, db) -> None:
    await _seed_setlist_catalog(db)

    resp = await _create_from_list(client, "Nobody - Not A Real Song\nLucky Nobody")

    assert resp.status_code == 400
    assert resp.json() == {"error": "setlist_empty", "message": SETLIST_EMPTY_MESSAGE}
    for table in ("active_games", "game_secrets", "game_setlists", "song_demand"):
        assert await _count(db, table) == 0, table


@pytest.mark.parametrize(
    ("text", "error"),
    [
        pytest.param("x" * 20_001, "setlist_too_long", id="too-long"),
        pytest.param("https://open.spotify.com/track/abc", "setlist_links_only", id="links-only"),
        pytest.param("# my party list\n", "setlist_no_songs", id="no-songs"),
    ],
)
async def test_a_refused_list_answers_its_400_without_the_catalog(
    client, db, fake_supabase, monkeypatch, text: str, error: str
) -> None:
    # The list is read before the catalog loads: with the database down, a
    # refused list still gets its own 400, not a 500.
    def database_down(name: str) -> Any:
        raise FakeAPIError(code="XX000", message="connection refused")

    monkeypatch.setattr(fake_supabase, "table", database_down)

    resp = await _create_from_list(client, text)

    assert resp.status_code == 400
    assert resp.json()["error"] == error
    assert await _count(db, "active_games") == 0


@pytest.mark.parametrize(
    "change",
    [
        pytest.param("DELETE FROM songs WHERE id = $1", id="deleted"),
        pytest.param("UPDATE songs SET unavailable_at = now() WHERE id = $1", id="flagged"),
    ],
)
async def test_song_deleted_after_the_index_was_cached(client, db, change: str) -> None:
    song_ids = await _seed_setlist_catalog(db)
    await get_catalog_index()  # the cached snapshot still holds Paper Lanterns
    await db.execute(change, song_ids["Paper Lanterns"])

    resp = await _create_from_list(
        client, "Velvet Comet - Paper Lanterns\nGlass Harbor - Harbor Lights"
    )

    assert resp.status_code == 201, resp.text
    assert await _pool(db, resp.json()["game_code"]) == {
        "Harbor Lights": 1,
        "Northern Static": 2,
    }


async def test_every_listed_song_gone_after_the_cache_is_a_400_and_removes_the_game(
    client, db
) -> None:
    song_ids = await _seed_setlist_catalog(db)
    await get_catalog_index()
    await db.execute("DELETE FROM songs WHERE id = $1", song_ids["Night Ferry"])

    # Pale Rowan's only song is gone: save_game_setlist raises setlist_empty.
    resp = await _create_from_list(client, "Pale Rowan - Night Ferry\nNobody - Not A Real Song")

    assert resp.status_code == 400
    assert resp.json() == {"error": "setlist_empty", "message": SETLIST_EMPTY_MESSAGE}
    for table in ("active_games", "game_secrets", "game_setlists", "song_demand"):
        assert await _count(db, table) == 0, table


async def test_failed_pool_save_removes_the_game(client, db, fake_supabase, monkeypatch) -> None:
    await _seed_setlist_catalog(db)
    _fail_rpc(monkeypatch, fake_supabase, "save_game_setlist")

    resp = await _create_from_list(
        client, "Velvet Comet - Paper Lanterns\nNobody - Not A Real Song"
    )

    assert resp.status_code == 500
    assert resp.json()["error"] == "internal_error"
    for table in ("active_games", "game_secrets", "game_setlists", "song_demand"):
        assert await _count(db, table) == 0, table


async def test_failed_cleanup_still_answers_the_save_error(
    client, db, fake_supabase, monkeypatch, caplog
) -> None:
    await _seed_setlist_catalog(db)
    _fail_rpc(monkeypatch, fake_supabase, "save_game_setlist")
    real_table = fake_supabase.table

    class _NoDelete:
        """active_games whose delete fails; every other call is the real one."""

        def __init__(self, query: Any) -> None:
            self._query = query

        def __getattr__(self, name: str) -> Any:
            return getattr(self._query, name)

        def delete(self) -> Any:
            raise FakeAPIError(code="XX000", message="connection reset")

    def table(name: str) -> Any:
        query = real_table(name)
        return _NoDelete(query) if name == "active_games" else query

    monkeypatch.setattr(fake_supabase, "table", table)

    with caplog.at_level(logging.WARNING):
        resp = await _create_from_list(client, "Velvet Comet - Paper Lanterns")

    assert resp.status_code == 500
    assert resp.json()["error"] == "internal_error"
    assert "could not delete game" in caplog.text
    # The row left behind has no pool and no genres, so it can never start a
    # round; the 4-hour sweep removes it.
    assert await _count(db, "active_games") == 1
    assert await _count(db, "game_setlists") == 0


async def test_demand_failure_does_not_fail_the_create(
    client, db, fake_supabase, monkeypatch, caplog
) -> None:
    await _seed_setlist_catalog(db)
    _fail_rpc(monkeypatch, fake_supabase, "record_song_demand")

    with caplog.at_level(logging.WARNING):
        resp = await _create_from_list(
            client, "Velvet Comet - Paper Lanterns\nNobody - Not A Real Song"
        )

    assert resp.status_code == 201, resp.text
    assert await _pool(db, resp.json()["game_code"]) == {
        "Paper Lanterns": 1,
        "Northern Static": 2,
    }
    assert await _count(db, "song_demand") == 0
    assert "song demand not recorded" in caplog.text
    # The log names the error, never the host's list.
    assert "Not A Real Song" not in caplog.text
    assert "not a real song" not in caplog.text


async def test_demand_skips_keys_over_1000_bytes(client, db) -> None:
    await _seed_setlist_catalog(db)
    kept = "y" * 1000  # exactly 1,000 bytes
    too_long = "\N{HEBREW LETTER ALEF}" * 501  # 501 characters, 1,002 bytes
    text = "\n".join(["Velvet Comet - Paper Lanterns", kept, too_long, "Nobody - Not A Real Song"])

    resp = await _create_from_list(client, text)

    assert resp.status_code == 201, resp.text
    keys = {row["line_key"] for row in await db.fetch("SELECT line_key FROM song_demand")}
    assert keys == {kept, "nobody not a real song"}


async def test_demand_skips_a_line_with_a_nul_character(client, db) -> None:
    await _seed_setlist_catalog(db)
    text = "Velvet Comet - Paper Lanterns\nNobody - Not\x00Real\nNobody - Not A Real Song"

    resp = await _create_from_list(client, text)

    assert resp.status_code == 201, resp.text
    keys = {row["line_key"] for row in await db.fetch("SELECT line_key FROM song_demand")}
    assert keys == {"nobody not a real song"}


async def test_a_name_several_songs_share_is_not_recorded_as_demand(client, db) -> None:
    await _seed_setlist_catalog(db)
    await insert_song(db, title="Lucky Stone", artist="Velvet Comet")
    await insert_song(db, title="Lucky Stone", artist="Pale Rowan")

    resp = await _create_from_list(client, "Lucky Stone\nGlass Harbor - Harbor Lights")

    assert resp.status_code == 201, resp.text
    assert await _count(db, "song_demand") == 0


@pytest.mark.parametrize(
    ("user_agent", "is_test"),
    [pytest.param(PHONE_UA, False, id="phone"), pytest.param(HEADLESS_UA, True, id="headless")],
)
async def test_list_game_keeps_the_test_flag(client, db, user_agent: str, is_test: bool) -> None:
    await _seed_setlist_catalog(db)

    resp = await client.post(
        "/games",
        json={"setlist": {"text": "Velvet Comet - Paper Lanterns"}},
        headers={"User-Agent": user_agent},
    )

    assert resp.status_code == 201, resp.text
    flag = await db.fetchval(
        "SELECT is_test FROM game_secrets WHERE game_code = $1", resp.json()["game_code"]
    )
    assert flag is is_test


async def test_genre_game_answer_is_unchanged_but_for_a_null_setlist(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])

    resp = await client.post("/games", json={"selected_genres": [str(genres[0])]})

    assert resp.status_code == 201, resp.text
    assert set(resp.json()) == {
        "game_code",
        "status",
        "selected_genres",
        "selected_decades",
        "started_at",
        "expires_at",
        "manager_token",
        "setlist",
    }
    assert resp.json()["setlist"] is None
    assert await _count(db, "game_setlists") == 0
