"""POST /games; game creation and code generation."""

from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.models.games import CreateGameRequest
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


def _fail_rpc(
    monkeypatch, fake, name: str, code: str = "XX000", message: str = "connection reset"
) -> None:
    """Make the fake client's ``name`` RPC fail; by default as a dropped
    connection would, or with the given SQLSTATE and message."""
    real_rpc = fake.rpc

    class _Failing:
        def execute(self) -> Any:
            raise FakeAPIError(code=code, message=message)

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


# A playlist export (Exportify's columns): the row is artist and title, and
# its URI, album and duration cells are not part of the song.
EXPORT_HEADER = "Track URI,Track Name,Artist Name(s),Album Name,Duration (ms)"


async def test_one_missing_song_has_one_demand_key_however_it_is_written(client, db) -> None:
    # Spec §13.5: the queue counts songs, so a numbered line, a timed line, the
    # swapped order, a recording note and a CSV row all count for one key.
    await _seed_setlist_catalog(db)
    playable = "Velvet Comet - Paper Lanterns"
    texts = [
        f"{playable}\nNobody - Not A Real Song",
        f"1. {playable}\n2. Nobody - Not A Real Song",
        f"{playable} (4:02)\nNobody - Not A Real Song (3:51)",
        f"{playable}\nNot A Real Song - Nobody",
        f"{playable}\nNobody - Not A Real Song - Remastered 2011",
        f"{EXPORT_HEADER}\n"
        "spotify:track:aaa,Paper Lanterns,Velvet Comet,Lantern Days,201000\n"
        "spotify:track:bbb,Not A Real Song,Nobody,Made Up Album,231000",
    ]

    for text in texts:
        resp = await _create_from_list(client, text)
        assert resp.status_code == 201, (text, resp.text)
        assert resp.json()["setlist"] == {"list_songs": 1, "same_artist_songs": 1}, text

    rows = await db.fetch("SELECT line_key, raw_line, request_count FROM song_demand")
    assert [dict(row) for row in rows] == [
        {
            "line_key": "nobody not a real song",
            "raw_line": "Nobody - Not A Real Song",  # the first line seen for the key
            "request_count": len(texts),
        }
    ]


async def test_one_create_naming_a_missing_song_twice_counts_it_once(client, db) -> None:
    await _seed_setlist_catalog(db)
    text = "Velvet Comet - Paper Lanterns\n1. Not A Real Song - Nobody\nNobody - Not A Real Song"

    resp = await _create_from_list(client, text)

    assert resp.status_code == 201, resp.text
    rows = await db.fetch("SELECT line_key, raw_line, request_count FROM song_demand")
    assert [dict(row) for row in rows] == [
        {
            "line_key": "nobody not a real song",
            "raw_line": "1. Not A Real Song - Nobody",
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


async def test_a_refused_create_answers_none_of_the_list(client, db) -> None:
    # The 400 of a refused create names what was wrong, never the body: it
    # used to echo the whole list (a 2 MB list gave a 2 MB answer).
    genres = await fetch_genre_ids(db, slugs=["rock"])
    text = "Velvet Comet - Paper Lanterns\n" * 5000  # 150,000 characters

    for extra in ({"selected_genres": [str(genres[0])]}, {"selected_decades": [1980]}):
        resp = await _create_from_list(client, text, **extra)

        assert resp.status_code == 400, extra
        assert resp.json()["error"] == "validation_error", extra
        assert "Velvet Comet" not in resp.text and "Paper Lanterns" not in resp.text
        assert len(resp.content) < 1000, extra
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
    # Ruling Q: the answer gives the matcher's counts from the cached snapshot,
    # so it still counts Paper Lanterns, which the saved pool left out.
    assert resp.json()["setlist"] == {"list_songs": 2, "same_artist_songs": 1}
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
            raise FakeAPIError(code="08006", message="connection lost")

    def table(name: str) -> Any:
        query = real_table(name)
        return _NoDelete(query) if name == "active_games" else query

    monkeypatch.setattr(fake_supabase, "table", table)

    with caplog.at_level(logging.WARNING):
        resp = await _create_from_list(client, "Velvet Comet - Paper Lanterns")

    assert resp.status_code == 500
    assert resp.json()["error"] == "internal_error"
    assert "could not delete game" in caplog.text
    assert "08006 connection lost" in caplog.text  # the delete's own reason
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


async def test_demand_records_at_most_100_songs_per_create(client, db) -> None:
    await _seed_setlist_catalog(db)
    # The first song is named 5 times: it counts once and takes one place.
    missing = ["Nobody - Missing Song 0"] * 5 + [f"Nobody - Missing Song {i}" for i in range(120)]
    text = "\n".join(["Velvet Comet - Paper Lanterns", *missing])

    resp = await _create_from_list(client, text)

    assert resp.status_code == 201, resp.text
    keys = {row["line_key"] for row in await db.fetch("SELECT line_key FROM song_demand")}
    assert keys == {f"missing song {i} nobody" for i in range(100)}


async def test_demand_cuts_a_long_raw_line_but_never_its_key(client, db) -> None:
    await _seed_setlist_catalog(db)
    long_line = "Nobody - " + " ".join(["Long Song"] * 40)  # 408 characters
    text = f"Velvet Comet - Paper Lanterns\n{long_line}"

    resp = await _create_from_list(client, text)

    assert resp.status_code == 201, resp.text
    rows = await db.fetch("SELECT line_key, raw_line FROM song_demand")
    assert [dict(row) for row in rows] == [
        {"line_key": " ".join(["long song"] * 40) + " nobody", "raw_line": long_line[:300]}
    ]
    assert len(rows[0]["raw_line"]) == 300


async def test_demand_skips_a_line_with_a_nul_character(client, db) -> None:
    await _seed_setlist_catalog(db)
    text = "Velvet Comet - Paper Lanterns\nNobody - Not\x00Real\nNobody - Not A Real Song"

    resp = await _create_from_list(client, text)

    assert resp.status_code == 201, resp.text
    keys = {row["line_key"] for row in await db.fetch("SELECT line_key FROM song_demand")}
    assert keys == {"nobody not a real song"}


# The JSON escape for a lone UTF-16 high surrogate, built from chr(92) (a
# backslash) so the character itself is never in this file or the request.
LONE_SURROGATE = chr(92) + "ud800"


@pytest.mark.parametrize(
    ("text", "status", "demand"),
    [
        pytest.param(f"Abc {LONE_SURROGATE} def", 400, set(), id="nothing-playable"),
        pytest.param(
            f"Velvet Comet {LONE_SURROGATE} - Paper Lanterns\\nAbc {LONE_SURROGATE} def",
            201,
            {"abc def"},
            id="playable-and-demand",
        ),
    ],
)
async def test_a_lone_surrogate_in_the_list_is_dropped_not_a_500(
    client, db, text: str, status: int, demand: set[str]
) -> None:
    await _seed_setlist_catalog(db)
    raw = ('{"setlist": {"text": "' + text + '"}}').encode("ascii")

    resp = await client.post("/games", content=raw, headers={"Content-Type": "application/json"})

    assert resp.status_code == status, resp.text
    if status == 400:
        assert resp.json() == {"error": "setlist_empty", "message": SETLIST_EMPTY_MESSAGE}
    else:
        assert resp.json()["setlist"] == {"list_songs": 1, "same_artist_songs": 1}
    keys = {row["line_key"] for row in await db.fetch("SELECT line_key FROM song_demand")}
    assert keys == demand


@pytest.mark.parametrize(
    "other_field",
    [
        pytest.param('"selected_genres": ["00000000-0000-4000-8000-000000000001"]', id="both"),
        pytest.param('"selected_decades": [1980]', id="list-and-decades"),
    ],
)
async def test_a_refused_create_with_a_lone_surrogate_is_a_400_not_a_500(
    client, db, other_field: str
) -> None:
    # The refusal used to echo the body; UTF-8 cannot encode a lone surrogate,
    # so writing the answer failed with a 500.
    text = f"Velvet Comet {LONE_SURROGATE} - Paper Lanterns"
    raw = ('{"setlist": {"text": "' + text + '"}, ' + other_field + "}").encode("ascii")

    resp = await client.post("/games", content=raw, headers={"Content-Type": "application/json"})

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "validation_error"
    assert "Velvet Comet" not in resp.text
    assert await _count(db, "active_games") == 0


async def test_a_name_several_songs_share_is_not_recorded_as_demand(client, db) -> None:
    await _seed_setlist_catalog(db)
    await insert_song(db, title="Lucky Stone", artist="Velvet Comet")
    await insert_song(db, title="Lucky Stone", artist="Pale Rowan")

    resp = await _create_from_list(client, "Lucky Stone\nGlass Harbor - Harbor Lights")

    assert resp.status_code == 201, resp.text
    # Only Harbor Lights matched: "Lucky Stone" really was a miss.
    assert resp.json()["setlist"] == {"list_songs": 1, "same_artist_songs": 0}
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


# --- Length limits on the genre and decade lists (issue #446) ----------------
#
# At most 100 genres and 30 decades. Production has 11 genres and songs in 10
# decades.

# The 21 decade start years in the legal range (1900, 1910, ..., 2100). The
# limit counts entries, not distinct values, so a longer list repeats them.
LEGAL_DECADES = list(range(1900, 2101, 10))


def _decades(count: int) -> list[int]:
    return [LEGAL_DECADES[i % len(LEGAL_DECADES)] for i in range(count)]


def _genre_ids(count: int) -> list[str]:
    """Valid genre UUIDs; no genre row has them."""
    return [str(uuid.uuid4()) for _ in range(count)]


async def test_101_genres_is_a_400(client, db) -> None:
    resp = await client.post("/games", json={"selected_genres": _genre_ids(101)})

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "validation_error"
    assert await _count(db, "active_games") == 0


async def test_31_decades_is_a_400(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])

    resp = await client.post(
        "/games", json={"selected_genres": [str(genres[0])], "selected_decades": _decades(31)}
    )

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "validation_error"
    assert await _count(db, "active_games") == 0


async def test_the_largest_real_request_still_creates_a_game(client, db) -> None:
    # The fixture seeds migration 008's genres; made-up ones make up the 11.
    genre_ids = [row["id"] for row in await db.fetch("SELECT id FROM genres ORDER BY slug")]
    for i in range(len(genre_ids), 11):
        genre_ids.append(
            await db.fetchval(
                "INSERT INTO genres (name, slug) VALUES ($1, $2) RETURNING id",
                f"Made Up Genre {i}",
                f"made-up-genre-{i}",
            )
        )
    decades = list(range(1950, 2041, 10))  # 1950, 1960, ..., 2040
    assert len(genre_ids) == 11 and len(decades) == 10

    resp = await client.post(
        "/games",
        json={"selected_genres": [str(g) for g in genre_ids], "selected_decades": decades},
    )

    assert resp.status_code == 201, resp.text
    assert sorted(resp.json()["selected_genres"]) == sorted(str(g) for g in genre_ids)
    assert sorted(resp.json()["selected_decades"]) == decades


def test_100_genres_and_30_decades_are_accepted_by_the_model() -> None:
    body = CreateGameRequest.model_validate(
        {"selected_genres": _genre_ids(100), "selected_decades": _decades(30)}
    )

    assert len(body.selected_genres) == 100
    assert len(body.selected_decades) == 30


# --- A game from chosen artists (Pick artists plan, Task 2) ------------------
#
# The host ticks artists and the game plays every playable catalog song by
# them, all in tier 1. The database decides whether the choice is enough
# (artist_game_rule, migration 062: 60 songs by 5 artists). Every name here is
# made up.

READY_ARTISTS = (
    "Zed Band",
    "Nia Quillfeather",
    "Orla Thistlewick",
    "Brindle Moth Ensemble",
    "Pemberly Static",
)
SONGS_PER_ARTIST = 12  # 5 artists x 12 songs = 60: just ready
ARTISTS_NOT_ENOUGH = {"error": "artists_not_enough", "message": "Pick more artists to start."}


async def _seed_artist_catalog(db) -> dict[str, list[uuid.UUID]]:
    """Twelve playable songs by each ready artist, a flagged song by Zed Band
    and a song by an artist nobody picks; the playable song ids by artist."""
    songs = {
        artist: [
            await insert_song(db, title=f"{artist} Song {i}", artist=artist)
            for i in range(SONGS_PER_ARTIST)
        ]
        for artist in READY_ARTISTS
    }
    flagged = await insert_song(db, title="Zed Band Lost Song", artist="Zed Band")
    await db.execute("UPDATE songs SET unavailable_at = now() WHERE id = $1", flagged)
    await insert_song(db, title="Salt And Pepper Song", artist="Salt & Pepper Co")
    return songs


async def _create_from_artists(client, names: list[str], **extra: Any) -> Any:
    return await client.post("/games", json={"artists": {"names": names}, **extra})


def _record_rpcs(monkeypatch, fake) -> list[tuple[str, dict[str, Any]]]:
    """Record the fake client's RPC calls as (name, params), in call order."""
    calls: list[tuple[str, dict[str, Any]]] = []
    real_rpc = fake.rpc

    def rpc(fn: str, params: dict[str, Any] | None = None) -> Any:
        calls.append((fn, dict(params or {})))
        return real_rpc(fn, params)

    monkeypatch.setattr(fake, "rpc", rpc)
    return calls


async def _assert_no_game(db) -> None:
    for table in ("active_games", "game_secrets", "game_setlists", "game_song_pool"):
        assert await _count(db, table) == 0, table


async def test_create_with_artists_saves_the_pool(client, db, fake_supabase, monkeypatch) -> None:
    await _seed_artist_catalog(db)
    calls = _record_rpcs(monkeypatch, fake_supabase)
    # As a browser may send them: any case, spaces, a repeat and a name the
    # catalog does not have. The server passes them on; the database cleans them.
    names = [
        "zed band",
        "  NIA QUILLFEATHER ",
        "Orla Thistlewick",
        "brindle moth ensemble",
        "pemberly static",
        "Zed Band",
        "Nobody At All",
    ]

    resp = await _create_from_artists(client, names)

    assert resp.status_code == 201, resp.text
    code = resp.json()["game_code"]
    assert calls == [
        ("artist_pick_status", {"p_keys": names}),
        ("save_game_artists", {"p_game_code": code, "p_keys": names}),
    ]
    assert await db.fetchval("SELECT ready FROM game_setlists WHERE game_code = $1", code) is True
    # Every playable song of the five, all tier 1; not the flagged song, not
    # the song of the artist nobody picked.
    assert await _pool(db, code) == {
        f"{artist} Song {i}": 1 for artist in READY_ARTISTS for i in range(SONGS_PER_ARTIST)
    }
    game = await db.fetchrow(
        "SELECT selected_genres, selected_decades FROM active_games WHERE game_code = $1", code
    )
    assert game["selected_genres"] == [] and game["selected_decades"] == []


async def test_create_answer_has_today_s_keys_only(client, db) -> None:
    song_ids = await _seed_artist_catalog(db)
    genres = await fetch_genre_ids(db, slugs=["rock"])
    genre_game = await client.post("/games", json={"selected_genres": [str(genres[0])]})
    assert genre_game.status_code == 201, genre_game.text

    resp = await _create_from_artists(client, list(READY_ARTISTS))

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert set(body) == set(genre_game.json())
    assert body["setlist"] is None
    assert body["selected_genres"] == [] and body["selected_decades"] == []
    # No count: not one value of the answer is a number.
    assert not any(isinstance(value, int | float) for value in body.values())
    # No song: no song id, YouTube id or start time.
    youtube_ids = [row["youtube_id"] for row in await db.fetch("SELECT youtube_id FROM songs")]
    for value in [*(str(i) for ids in song_ids.values() for i in ids), *youtube_ids]:
        assert value not in resp.text
    assert "youtube_id" not in resp.text and "start_time" not in resp.text


@pytest.mark.parametrize(
    ("names", "flag_one"),
    [
        pytest.param(list(READY_ARTISTS[:4]), False, id="one-artist-short"),
        pytest.param(list(READY_ARTISTS), True, id="one-song-short"),
        pytest.param(["Nobody At All"], False, id="unknown-artist"),
    ],
)
async def test_small_choice_is_a_400_and_creates_nothing(
    client, db, fake_supabase, monkeypatch, names: list[str], flag_one: bool
) -> None:
    songs = await _seed_artist_catalog(db)
    if flag_one:
        await db.execute(
            "UPDATE songs SET unavailable_at = now() WHERE id = $1", songs["Zed Band"][0]
        )
    calls = _record_rpcs(monkeypatch, fake_supabase)

    resp = await _create_from_artists(client, names)

    assert resp.status_code == 400
    assert resp.json() == ARTISTS_NOT_ENOUGH
    assert [fn for fn, _ in calls] == ["artist_pick_status"]  # asked first, never saved
    await _assert_no_game(db)


async def test_choice_shrinks_between_status_and_save(
    client, db, fake_supabase, monkeypatch
) -> None:
    await _seed_artist_catalog(db)
    real_rpc = fake_supabase.rpc
    real_table = fake_supabase.table
    calls: list[str] = []

    def rpc(fn: str, params: dict[str, Any] | None = None) -> Any:
        calls.append(fn)
        if fn == "save_game_artists":
            # Zed Band's songs are flagged after the status said ready, so the
            # save's own check of the rule refuses the choice.
            real_table("songs").update({"unavailable_at": datetime.now(UTC)}).eq(
                "artist", "Zed Band"
            ).execute()
        return real_rpc(fn, params)

    monkeypatch.setattr(fake_supabase, "rpc", rpc)

    resp = await _create_from_artists(client, list(READY_ARTISTS))

    assert resp.status_code == 400
    assert resp.json() == ARTISTS_NOT_ENOUGH
    assert calls == ["artist_pick_status", "save_game_artists"]
    await _assert_no_game(db)


@pytest.mark.parametrize(
    ("code", "message", "status", "error"),
    [
        pytest.param("XX000", "connection reset", 500, "internal_error", id="dropped"),
        pytest.param("P0002", "game_not_found", 404, "not_found", id="game-gone"),
        # Only artists_not_enough is the host's 400; another 22023 is not.
        pytest.param("22023", "setlist_empty", 500, "internal_error", id="other-22023"),
    ],
)
async def test_failed_artist_pool_save_removes_the_game(
    client,
    db,
    fake_supabase,
    monkeypatch,
    caplog,
    code: str,
    message: str,
    status: int,
    error: str,
) -> None:
    await _seed_artist_catalog(db)
    _fail_rpc(monkeypatch, fake_supabase, "save_game_artists", code, message)

    with caplog.at_level(logging.DEBUG):
        resp = await _create_from_artists(client, list(READY_ARTISTS))

    assert resp.status_code == status
    assert resp.json()["error"] == error
    await _assert_no_game(db)
    # No log line names the choice.
    for name in READY_ARTISTS:
        assert name not in caplog.text and name.lower() not in caplog.text


async def test_failed_status_check_creates_nothing(client, db, fake_supabase, monkeypatch) -> None:
    await _seed_artist_catalog(db)
    _fail_rpc(monkeypatch, fake_supabase, "artist_pick_status")

    resp = await _create_from_artists(client, list(READY_ARTISTS))

    assert resp.status_code == 500
    assert resp.json()["error"] == "internal_error"
    await _assert_no_game(db)


async def test_exactly_one_source(client, db) -> None:
    genres = await fetch_genre_ids(db, slugs=["rock"])
    await _seed_artist_catalog(db)
    artists = {"names": list(READY_ARTISTS)}
    payloads: list[dict[str, Any]] = [
        {"selected_genres": [str(genres[0])], "artists": artists},
        {"setlist": {"text": "Zed Band"}, "artists": artists},
        {"selected_genres": [str(genres[0])], "setlist": {"text": "Zed Band"}, "artists": artists},
        {},
        {"artists": None},
        {"artists": artists, "selected_decades": [1980]},
        {"artists": {**artists, "songs": 60}},  # a key the body does not have
        {"artists": list(READY_ARTISTS)},  # names without the object
        {"artists": {"names": []}},
    ]

    for payload in payloads:
        resp = await client.post("/games", json=payload)
        assert resp.status_code == 400, payload
        assert resp.json()["error"] == "validation_error", payload
        assert "Zed Band" not in resp.text, payload  # the refusal never echoes the body

    await _assert_no_game(db)


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        pytest.param({}, "choose genres, a song list or artists: exactly one of them", id="none"),
        pytest.param(
            {"artists": {"names": ["Zed Band"]}, "selected_decades": [1980]},
            "a game from a song list or from artists has no decades",
            id="artists-and-decades",
        ),
        pytest.param(
            {"setlist": {"text": "Zed Band"}, "selected_decades": [1980]},
            "a game from a song list or from artists has no decades",
            id="list-and-decades",
        ),
    ],
)
async def test_a_refused_source_names_its_reason(
    client, db, payload: dict[str, Any], message: str
) -> None:
    resp = await client.post("/games", json=payload)

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "validation_error"
    assert [entry["msg"] for entry in resp.json()["details"]["errors"]] == [message]


async def test_more_than_200_names_is_a_400(client, db) -> None:
    resp = await _create_from_artists(client, [f"Made Up Artist {i}" for i in range(201)])

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "validation_error"
    await _assert_no_game(db)


@pytest.mark.parametrize(
    "name",
    [pytest.param("x" * 121, id="121-characters"), pytest.param("", id="empty")],
)
async def test_a_name_over_120_characters_or_empty_is_a_400(client, db, name: str) -> None:
    resp = await _create_from_artists(client, ["Zed Band", name])

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "validation_error"
    await _assert_no_game(db)


def test_200_names_of_120_characters_are_accepted_by_the_model() -> None:
    names = [f"{i:03d}".ljust(120, "x") for i in range(200)]

    body = CreateGameRequest.model_validate({"artists": {"names": names}})

    assert body.artists is not None
    assert body.artists.names == names


@pytest.mark.parametrize(
    ("user_agent", "is_test"),
    [pytest.param(PHONE_UA, False, id="phone"), pytest.param(HEADLESS_UA, True, id="headless")],
)
async def test_artist_game_keeps_the_test_flag(client, db, user_agent: str, is_test: bool) -> None:
    await _seed_artist_catalog(db)

    resp = await client.post(
        "/games",
        json={"artists": {"names": list(READY_ARTISTS)}},
        headers={"User-Agent": user_agent},
    )

    assert resp.status_code == 201, resp.text
    flag = await db.fetchval(
        "SELECT is_test FROM game_secrets WHERE game_code = $1", resp.json()["game_code"]
    )
    assert flag is is_test
