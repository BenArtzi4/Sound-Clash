"""POST /admin/songs/check-availability — dead-YouTube-video scan (I-Liveness).

The oEmbed probe is stubbed (``youtube_availability.check_oembed``) so the
real batch helper runs but no network is hit; the DB layer is the real
testcontainer Postgres via the fake supabase client.
"""

from __future__ import annotations

import pytest

from app.services import youtube_availability

from ._helpers import insert_song

pytestmark = pytest.mark.needs_docker


def _stub_probe(monkeypatch, mapping: dict[str, str], *, default: str = "ok") -> None:
    def fake(youtube_id: str, *, timeout: float = 3.0) -> str:
        return mapping.get(youtube_id, default)

    monkeypatch.setattr(youtube_availability, "check_oembed", fake)


async def test_admin_required(client) -> None:
    resp = await client.post("/admin/songs/check-availability", json={})
    assert resp.status_code == 401


async def test_classifies_dead_and_unknown(admin_client, db, monkeypatch) -> None:
    await insert_song(db, title="Alive", youtube_id="okVIDEO0123", genre_slugs=["rock"])
    await insert_song(db, title="Gone", youtube_id="deadVIDEO01", genre_slugs=["rock"])
    await insert_song(db, title="Maybe", youtube_id="unknownVID1", genre_slugs=["rock"])
    _stub_probe(
        monkeypatch,
        {"okVIDEO0123": "ok", "deadVIDEO01": "dead", "unknownVID1": "unknown"},
    )

    resp = await admin_client.post("/admin/songs/check-availability", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["checked"] == 3
    assert [d["youtube_id"] for d in body["dead"]] == ["deadVIDEO01"]
    assert [u["youtube_id"] for u in body["unknown"]] == ["unknownVID1"]
    # Each flagged song carries enough to find/fix it in the admin UI.
    dead = body["dead"][0]
    assert dead["title"] == "Gone"
    assert "id" in dead
    # Three songs < the default 200 limit → catalog exhausted.
    assert body["next_offset"] is None


async def test_all_ok_returns_empty_report(admin_client, db, monkeypatch) -> None:
    await insert_song(db, title="Fine", youtube_id="fineVIDEO01", genre_slugs=["rock"])
    _stub_probe(monkeypatch, {})  # default "ok"

    resp = await admin_client.post("/admin/songs/check-availability", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["checked"] == 1
    assert body["dead"] == []
    assert body["unknown"] == []


async def test_paging_next_offset(admin_client, db, monkeypatch) -> None:
    for n in range(5):
        await insert_song(db, title=f"Song {n}", genre_slugs=["rock"])
    # Everything dead so each page's ids are collectable from the report.
    _stub_probe(monkeypatch, {}, default="dead")

    seen: set[str] = set()
    offset: int | None = 0
    pages = 0
    while offset is not None:
        resp = await admin_client.post(
            "/admin/songs/check-availability", json={"limit": 2, "offset": offset}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        seen.update(d["youtube_id"] for d in body["dead"])
        offset = body["next_offset"]
        pages += 1
        assert pages <= 5  # loop guard

    assert pages == 3  # 2 + 2 + 1
    assert len(seen) == 5  # every song probed exactly once across the pages


async def test_explicit_song_ids_ignore_paging(admin_client, db, monkeypatch) -> None:
    id1 = await insert_song(db, title="One", youtube_id="idONEvideo1", genre_slugs=["rock"])
    id2 = await insert_song(db, title="Two", youtube_id="idTWOvideo2", genre_slugs=["rock"])
    await insert_song(db, title="Three", youtube_id="idTHREEvid3", genre_slugs=["rock"])
    _stub_probe(monkeypatch, {"idONEvideo1": "dead"}, default="ok")

    resp = await admin_client.post(
        "/admin/songs/check-availability",
        json={"song_ids": [str(id1), str(id2)]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["checked"] == 2
    assert [d["youtube_id"] for d in body["dead"]] == ["idONEvideo1"]
    # Explicit-id probes never page.
    assert body["next_offset"] is None


async def test_limit_over_cap_rejected(admin_client) -> None:
    resp = await admin_client.post("/admin/songs/check-availability", json={"limit": 999})
    assert resp.status_code == 400
