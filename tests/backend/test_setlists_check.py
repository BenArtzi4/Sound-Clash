"""POST /setlists/check: match a host's pasted song list against the catalog.

The answer names songs by title and artist only (catalogue protection), in
the catalog's spelling, and the endpoint writes nothing. Every name here is
made up.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.db.errors import InternalError
from app.services import setlist_reader

from ._fake_supabase import FakeAPIError
from ._helpers import insert_song

pytestmark = pytest.mark.needs_docker

URL = "/setlists/check"


async def _seed_catalog(db) -> dict[str, str]:
    """A small made-up catalog; returns each song's youtube id by title."""
    songs = {
        "Paper Lanterns": ("Velvet Comet", "PaperLant01"),
        "Northern Static": ("Velvet Comet", "NorthStat01"),
        "Harbor Lights": ("Glass Harbor", "HarborLig01"),
        "Tide Song": ("Glass Harbor", "TideSong001"),
        "Night Ferry": ("Pale Rowan", "NightFerr01"),
    }
    for title, (artist, youtube_id) in songs.items():
        await insert_song(db, title=title, artist=artist, youtube_id=youtube_id)
    return {title: youtube_id for title, (_, youtube_id) in songs.items()}


async def test_check_returns_counts_and_catalog_spelling(client, db) -> None:
    await _seed_catalog(db)
    text = (
        "velvet comet - paper lanterns\n"
        "glass harbor\n"
        "Nobody - Not A Real Song\n"
        "Paper Lanterns - Velvet Comet\n"
    )

    resp = await client.post(URL, json={"text": text})

    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "lines_total": 4,
        "ready": [
            {
                "line": "velvet comet - paper lanterns",
                "title": "Paper Lanterns",
                "artist": "Velvet Comet",
                "songs": 1,
            },
            {"line": "glass harbor", "title": None, "artist": "Glass Harbor", "songs": 2},
            {
                "line": "Paper Lanterns - Velvet Comet",
                "title": "Paper Lanterns",
                "artist": "Velvet Comet",
                "songs": 1,
            },
        ],
        "not_found": [{"line": "Nobody - Not A Real Song", "reason": "not_in_catalog"}],
        # Paper Lanterns once (named twice) + both Glass Harbor songs.
        "list_songs": 3,
        # Northern Static: Velvet Comet's other song. Pale Rowan is not in the list.
        "same_artist_songs": 1,
        "pool_size": 4,
    }


async def test_check_never_returns_ids(client, db) -> None:
    youtube_ids = await _seed_catalog(db)
    song_ids = [str(row["id"]) for row in await db.fetch("SELECT id FROM songs")]

    resp = await client.post(
        URL, json={"text": "Velvet Comet - Paper Lanterns\nGlass Harbor\nVelvet Comet"}
    )

    assert resp.status_code == 200, resp.text
    for song_id in song_ids:
        assert song_id not in resp.text
    for youtube_id in youtube_ids.values():
        assert youtube_id not in resp.text
    assert "youtube_id" not in resp.text
    assert "start_time" not in resp.text
    for item in resp.json()["ready"]:
        assert set(item) == {"line", "title", "artist", "songs"}


async def test_check_links_only_is_a_400(client) -> None:
    text = "https://open.spotify.com/track/abc\nhttps://open.spotify.com/track/def"

    resp = await client.post(URL, json={"text": text})

    assert resp.status_code == 400 and resp.json()["error"] == "setlist_links_only"
    assert resp.json()["message"] == "These are links, not song names."


@pytest.mark.parametrize(
    "text",
    [
        pytest.param("x" * 20_001, id="over-20000-characters"),
        pytest.param("a - b\n" * 301, id="over-300-lines"),
    ],
)
async def test_check_too_long_is_a_400(client, text: str) -> None:
    resp = await client.post(URL, json={"text": text})

    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "setlist_too_long"
    assert body["message"] == "Your list is too long: at most 300 songs and 20,000 characters."


async def test_check_no_songs_is_a_400(client) -> None:
    resp = await client.post(URL, json={"text": "# my party list\n\n   \n"})

    assert resp.status_code == 400
    assert resp.json()["error"] == "setlist_no_songs"
    assert resp.json()["message"] == "No song names found."


@pytest.mark.parametrize(
    ("text", "error"),
    [
        pytest.param("x" * 20_001, "setlist_too_long", id="too-long"),
        pytest.param("https://open.spotify.com/track/abc", "setlist_links_only", id="links-only"),
        pytest.param("# my party list\n", "setlist_no_songs", id="no-songs"),
    ],
)
async def test_check_refuses_a_list_without_reading_the_catalog(
    client, fake_supabase, monkeypatch, text: str, error: str
) -> None:
    # The list is read before the catalog loads: with the database down, a
    # refused list still gets its own 400, not a 500.
    def database_down(name: str) -> Any:
        raise FakeAPIError(code="XX000", message="connection refused")

    monkeypatch.setattr(fake_supabase, "table", database_down)

    resp = await client.post(URL, json={"text": text})

    assert resp.status_code == 400
    assert resp.json()["error"] == error


async def test_check_answers_links_only_when_the_catalog_cannot_load(client, monkeypatch) -> None:
    # Controller ruling m2: the text is read before the catalog snapshot is
    # asked for, so a refused text never waits on (or fails with) the catalog.
    calls = 0

    async def catalog_down() -> Any:
        nonlocal calls
        calls += 1
        raise InternalError("catalog unavailable")

    monkeypatch.setattr(setlist_reader, "get_catalog_index", catalog_down)
    links = "https://open.spotify.com/track/abc\nhttps://open.spotify.com/track/def"

    resp = await client.post(URL, json={"text": links})

    assert resp.status_code == 400 and resp.json()["error"] == "setlist_links_only"
    assert calls == 0
    # The patch is live: a list with a song line does ask for the catalog.
    resp = await client.post(URL, json={"text": "Velvet Comet - Paper Lanterns"})
    assert resp.status_code == 500 and calls == 1


# The JSON escape for a lone UTF-16 high surrogate, built from chr(92) (a
# backslash) so neither this file nor the request holds the character itself:
# the server's JSON reader turns it into U+D800, which UTF-8 cannot encode.
LONE_SURROGATE = chr(92) + "ud800"


def _raw_json(text_with_escape: str) -> bytes:
    """A request body sent as bytes, so the escape reaches the server unchanged."""
    return ('{"text": "' + text_with_escape + '"}').encode("ascii")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        pytest.param(
            f"Abc {LONE_SURROGATE} def",
            {"ready": [], "not_found": [{"line": "Abc  def", "reason": "not_in_catalog"}]},
            id="not-found-line",
        ),
        pytest.param(
            f"Velvet Comet {LONE_SURROGATE} - Paper Lanterns",
            {
                "ready": [
                    {
                        "line": "Velvet Comet  - Paper Lanterns",
                        "title": "Paper Lanterns",
                        "artist": "Velvet Comet",
                        "songs": 1,
                    }
                ],
                "not_found": [],
            },
            id="ready-line",
        ),
    ],
)
async def test_a_lone_surrogate_is_dropped_not_a_500(
    client, db, text: str, expected: dict[str, Any]
) -> None:
    await _seed_catalog(db)

    resp = await client.post(
        URL, content=_raw_json(text), headers={"Content-Type": "application/json"}
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {"ready": body["ready"], "not_found": body["not_found"]} == expected


HTML_PAGE = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My party playlist</title>
<style>
# not a comment in css, but a comment line here
body { color: #222; }
</style></head>
<body><a href="https://open.spotify.com/playlist/xyz">Open in the app</a>
<script>window.__data = {"tracks": [1, 2, 3]};</script>
</body></html>
"""


@pytest.mark.parametrize(
    "text",
    [
        pytest.param(HTML_PAGE, id="html-page"),
        pytest.param("x" * 20_000, id="one-20000-character-line"),
    ],
)
async def test_check_html_page_gives_an_empty_pool_not_an_error(client, db, text: str) -> None:
    await _seed_catalog(db)

    resp = await client.post(URL, json={"text": text})

    assert resp.status_code == 200 and resp.json()["pool_size"] == 0
    body = resp.json()
    assert body["ready"] == []
    assert body["lines_total"] == len(body["not_found"]) > 0


async def test_check_is_rate_limited(client, db) -> None:
    await _seed_catalog(db)

    statuses = [
        (await client.post(URL, json={"text": "Velvet Comet - Paper Lanterns"})).status_code
        for _ in range(11)
    ]

    assert statuses == [200] * 10 + [429]
    resp = await client.post(URL, json={"text": "Velvet Comet - Paper Lanterns"})
    assert resp.json()["error"] == "rate_limited"


async def test_check_writes_nothing(client, db) -> None:
    await _seed_catalog(db)
    tables = ("active_games", "game_setlists", "game_song_pool", "song_demand", "songs")

    async def counts() -> dict[str, int]:
        return {t: await db.fetchval(f"SELECT count(*) FROM {t}") for t in tables}  # noqa: S608

    before = await counts()

    resp = await client.post(
        URL, json={"text": "Velvet Comet - Paper Lanterns\nNobody - Not A Real Song\nGlass Harbor"}
    )

    assert resp.status_code == 200, resp.text
    assert await counts() == before


async def test_artist_line_uses_the_catalog_spelling_of_the_artist(client, db) -> None:
    # Ruling K: the credit of a song credited to that artist alone, wherever
    # it sits among the artist's songs; else the first song's whole credit.
    await insert_song(db, title="Copper Window", artist="Mira Felt & Orbit Fair")
    await insert_song(db, title="Brass Moon", artist="Mira Felt")
    await insert_song(db, title="Sky Parade", artist="Zora Quill ft. Amber Hollis")

    resp = await client.post(URL, json={"text": "MIRA FELT\namber hollis"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["ready"] == [
        {"line": "MIRA FELT", "title": None, "artist": "Mira Felt", "songs": 2},
        {
            "line": "amber hollis",
            "title": None,
            "artist": "Zora Quill ft. Amber Hollis",
            "songs": 1,
        },
    ]


async def test_a_name_several_songs_share_is_not_found_with_its_reason(client, db) -> None:
    await insert_song(db, title="Lucky Stone", artist="Velvet Comet")
    await insert_song(db, title="Lucky Stone", artist="Pale Rowan")

    resp = await client.post(URL, json={"text": "Lucky Stone"})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["not_found"] == [{"line": "Lucky Stone", "reason": "several_songs_share_this_name"}]
    assert body["pool_size"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({}, id="no-text"),
        pytest.param({"text": 42}, id="text-not-a-string"),
        pytest.param({"text": "Velvet Comet", "genres": []}, id="unknown-field"),
    ],
)
async def test_a_malformed_body_is_a_validation_error(client, payload: dict[str, object]) -> None:
    resp = await client.post(URL, json=payload)

    assert resp.status_code == 400
    assert resp.json()["error"] == "validation_error"


async def test_a_body_that_is_not_json_is_a_validation_error_not_a_500(client) -> None:
    # A text/plain body reaches the model as bytes. The 400 names what was
    # wrong and never echoes the body.
    text = "Velvet Comet - Paper Lanterns\nGlass Harbor\n"

    resp = await client.post(
        URL, content=text.encode("utf-8"), headers={"Content-Type": "text/plain"}
    )

    assert resp.status_code == 400, resp.text
    assert resp.json()["error"] == "validation_error"
    assert "Velvet Comet" not in resp.text and "Glass Harbor" not in resp.text
