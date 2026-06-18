"""POST /admin/songs/bulk-import; CSV upload, idempotent on youtube_id."""

from __future__ import annotations

import io

import pytest

from ._helpers import insert_song

pytestmark = pytest.mark.needs_docker


def _csv(rows: list[list[str]]) -> bytes:
    header = "title,artist,youtube_id,start_time,genres\n"
    body = "\n".join(",".join(r) for r in rows)
    return (header + body + "\n").encode("utf-8")


async def test_inserts_new_rows(admin_client) -> None:
    csv = _csv(
        [
            ["Hello", "Adele", "YQHsXMglC9A", "0", "rock"],
            ["Yesterday", "Beatles", "NrgmdOz227I", "10", "rock"],
        ]
    )
    resp = await admin_client.post(
        "/admin/songs/bulk-import",
        files={"file": ("songs.csv", io.BytesIO(csv), "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["inserted"] == 2
    assert body["updated"] == 0


async def test_updates_existing_youtube_id(admin_client, db) -> None:
    await insert_song(db, title="Old", artist="Old", youtube_id="DUPKEY12345", genre_slugs=["rock"])
    csv = _csv([["NewTitle", "NewArtist", "DUPKEY12345", "5", "rock"]])
    resp = await admin_client.post(
        "/admin/songs/bulk-import",
        files={"file": ("songs.csv", io.BytesIO(csv), "text/csv")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["inserted"] == 0
    assert body["updated"] == 1
    row = await db.fetchrow("SELECT title FROM songs WHERE youtube_id = $1", "DUPKEY12345")
    assert row["title"] == "NewTitle"


async def test_malformed_row_rejected_with_line_number(admin_client) -> None:
    csv = _csv(
        [
            ["Hello", "Adele", "YQHsXMglC9A", "0", "rock"],
            ["Bad", "Bad", "tooshort", "0", "rock"],
        ]
    )
    resp = await admin_client.post(
        "/admin/songs/bulk-import",
        files={"file": ("songs.csv", io.BytesIO(csv), "text/csv")},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "validation_error"
    assert body["details"]["line"] == 3  # 1=header, 2=first row, 3=bad row


async def test_unknown_genre_rejected(admin_client) -> None:
    csv = _csv([["Song", "Artist", "abcDEF1234X", "0", "non_existent_slug"]])
    resp = await admin_client.post(
        "/admin/songs/bulk-import",
        files={"file": ("songs.csv", io.BytesIO(csv), "text/csv")},
    )
    assert resp.status_code == 400
    assert resp.json()["details"]["issue"] == "unknown_slug"


async def test_admin_required(client) -> None:
    csv = _csv([["X", "Y", "abcDEF1234X", "0", "rock"]])
    resp = await client.post(
        "/admin/songs/bulk-import",
        files={"file": ("songs.csv", io.BytesIO(csv), "text/csv")},
    )
    assert resp.status_code == 401


async def test_bulk_import_persists_release_year(admin_client, db) -> None:
    header = "title,artist,youtube_id,start_time,genres,release_year\n"
    body = "Yr Song,Yr Artist,YQHsXMglC9A,0,rock,1994\n"
    csv = (header + body).encode("utf-8")
    resp = await admin_client.post(
        "/admin/songs/bulk-import",
        files={"file": ("songs.csv", io.BytesIO(csv), "text/csv")},
    )
    assert resp.status_code == 200, resp.text
    row = await db.fetchrow("SELECT release_year FROM songs WHERE youtube_id = $1", "YQHsXMglC9A")
    assert row["release_year"] == 1994
