"""archive_game(): durable snapshot of a finished game.

Covers the happy-path snapshot, idempotency, the 0-round / missing-game skips,
and -- the headline durability property -- that the denormalised song and team
columns survive a later edit or delete of the source rows.

Spec: docs/rpc-functions.md, docs/data-model.md.
"""

from __future__ import annotations

import uuid

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker


async def _insert_round(
    conn: asyncpg.Connection,
    game_code: str,
    round_number: int,
    song_id: uuid.UUID | None,
) -> None:
    await conn.execute(
        "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, $2, $3)",
        game_code,
        round_number,
        song_id,
    )


async def _set_score(conn: asyncpg.Connection, team_id: uuid.UUID, score: int) -> None:
    await conn.execute("UPDATE game_teams SET score = $1 WHERE id = $2", score, team_id)


@pytest.mark.asyncio
async def test_archive_writes_history_teams_songs(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="playing")
    genres = [uuid.uuid4(), uuid.uuid4()]
    await db.execute(
        "UPDATE active_games SET selected_genres = $1, selected_decades = $2 WHERE game_code = $3",
        genres,
        [1990, 2000],
        code,
    )

    t1 = await create_test_team(db, code, name="Aleph")
    t2 = await create_test_team(db, code, name="Bet")
    await _set_score(db, t1, 7)
    await _set_score(db, t2, 3)

    s1 = await create_test_song(db, title="Song One", artist="Artist One", youtube_id="aaaaaaaaaaa")
    s2 = await create_test_song(db, title="Song Two", artist="Artist Two", youtube_id="bbbbbbbbbbb")
    s3 = await create_test_song(db, title="Song Three", artist="Artist Three", youtube_id="ccccccccccc")
    await _insert_round(db, code, 1, s1)
    await _insert_round(db, code, 2, s2)
    await _insert_round(db, code, 3, s3)

    started_at = await db.fetchval("SELECT started_at FROM active_games WHERE game_code = $1", code)
    history_id = await db.fetchval("SELECT archive_game($1)", code)
    assert history_id is not None

    hist = await db.fetchrow("SELECT * FROM game_history WHERE id = $1", history_id)
    assert hist is not None
    assert hist["game_code"] == code
    assert hist["started_at"] == started_at
    assert hist["round_count"] == 3
    assert hist["team_count"] == 2
    assert hist["selected_genres"] == genres
    assert hist["selected_decades"] == [1990, 2000]
    assert hist["ended_at"] is not None  # COALESCE fallback to now() when not yet ended

    teams = await db.fetch(
        "SELECT name, score FROM game_history_teams WHERE game_history_id = $1 ORDER BY score DESC",
        history_id,
    )
    assert [(r["name"], r["score"]) for r in teams] == [("Aleph", 7), ("Bet", 3)]

    songs = await db.fetch(
        "SELECT round_number, song_id, song_title, song_artist, youtube_id "
        "FROM game_history_songs WHERE game_history_id = $1 ORDER BY round_number",
        history_id,
    )
    assert [r["round_number"] for r in songs] == [1, 2, 3]
    assert [r["song_title"] for r in songs] == ["Song One", "Song Two", "Song Three"]
    assert [r["song_artist"] for r in songs] == ["Artist One", "Artist Two", "Artist Three"]
    assert [r["youtube_id"] for r in songs] == ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]
    assert [r["song_id"] for r in songs] == [s1, s2, s3]


@pytest.mark.asyncio
async def test_archive_idempotent_double_call(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="playing")
    await create_test_team(db, code, name="Solo")
    song_id = await create_test_song(db, youtube_id="ddddddddddd")
    await _insert_round(db, code, 1, song_id)

    first = await db.fetchval("SELECT archive_game($1)", code)
    second = await db.fetchval("SELECT archive_game($1)", code)
    assert first is not None
    assert first == second  # same row, not a duplicate

    assert await db.fetchval("SELECT count(*) FROM game_history WHERE game_code = $1", code) == 1
    assert (
        await db.fetchval("SELECT count(*) FROM game_history_songs WHERE game_history_id = $1", first)
        == 1
    )
    assert (
        await db.fetchval("SELECT count(*) FROM game_history_teams WHERE game_history_id = $1", first)
        == 1
    )


@pytest.mark.asyncio
async def test_archive_skips_zero_round_game(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="playing")
    await create_test_team(db, code, name="NoPlay")

    result = await db.fetchval("SELECT archive_game($1)", code)
    assert result is None
    assert await db.fetchval("SELECT count(*) FROM game_history WHERE game_code = $1", code) == 0


@pytest.mark.asyncio
async def test_archive_returns_null_for_missing_game(db: asyncpg.Connection) -> None:
    result = await db.fetchval("SELECT archive_game($1)", "ZZZZZZ")
    assert result is None
    assert await db.fetchval("SELECT count(*) FROM game_history") == 0


@pytest.mark.asyncio
async def test_archive_song_snapshot_survives_song_delete(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="playing")
    await create_test_team(db, code, name="T")
    song_id = await create_test_song(db, title="Doomed", artist="Gone", youtube_id="eeeeeeeeeee")
    await _insert_round(db, code, 1, song_id)

    history_id = await db.fetchval("SELECT archive_game($1)", code)

    # The round's FK is ON DELETE SET NULL, so deleting the song nulls the soft
    # FK on the history row -- but the denormalised columns must be untouched.
    await db.execute("DELETE FROM songs WHERE id = $1", song_id)

    row = await db.fetchrow(
        "SELECT song_id, song_title, song_artist, youtube_id "
        "FROM game_history_songs WHERE game_history_id = $1",
        history_id,
    )
    assert row is not None
    assert row["song_id"] is None  # soft FK cleared
    assert row["song_title"] == "Doomed"  # denorm survived
    assert row["song_artist"] == "Gone"
    assert row["youtube_id"] == "eeeeeeeeeee"


@pytest.mark.asyncio
async def test_archive_song_snapshot_survives_song_edit(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="playing")
    await create_test_team(db, code, name="T")
    song_id = await create_test_song(db, title="Original", artist="Orig", youtube_id="fffffffffff")
    await _insert_round(db, code, 1, song_id)

    history_id = await db.fetchval("SELECT archive_game($1)", code)
    await db.execute("UPDATE songs SET title = 'Renamed', artist = 'Changed' WHERE id = $1", song_id)

    row = await db.fetchrow(
        "SELECT song_title, song_artist FROM game_history_songs WHERE game_history_id = $1",
        history_id,
    )
    assert row is not None
    assert row["song_title"] == "Original"  # snapshot, not a live join
    assert row["song_artist"] == "Orig"


@pytest.mark.asyncio
async def test_archive_team_scores_snapshot(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="playing")
    team_id = await create_test_team(db, code, name="Movers")
    await _set_score(db, team_id, 12)
    song_id = await create_test_song(db, youtube_id="ggggggggggg")
    await _insert_round(db, code, 1, song_id)

    history_id = await db.fetchval("SELECT archive_game($1)", code)
    await _set_score(db, team_id, 999)  # mutate the live row after archiving

    score = await db.fetchval(
        "SELECT score FROM game_history_teams WHERE game_history_id = $1", history_id
    )
    assert score == 12  # snapshot unaffected by the later mutation


@pytest.mark.asyncio
async def test_archive_null_song_round_placeholder(db: asyncpg.Connection) -> None:
    code = await create_test_game(db, status="playing")
    await create_test_team(db, code, name="T")
    kept = await create_test_song(db, title="Kept", artist="Here", youtube_id="hhhhhhhhhhh")
    doomed = await create_test_song(db, title="Doomed", artist="Bye", youtube_id="iiiiiiiiiii")
    await _insert_round(db, code, 1, kept)
    await _insert_round(db, code, 2, doomed)

    # Delete the round-2 song BEFORE archiving, so archive_game sees song_id NULL.
    await db.execute("DELETE FROM songs WHERE id = $1", doomed)

    history_id = await db.fetchval("SELECT archive_game($1)", code)

    songs = await db.fetch(
        "SELECT round_number, song_id, song_title, youtube_id "
        "FROM game_history_songs WHERE game_history_id = $1 ORDER BY round_number",
        history_id,
    )
    assert [r["round_number"] for r in songs] == [1, 2]  # ordered list stays contiguous
    assert songs[0]["song_title"] == "Kept"
    assert songs[1]["song_id"] is None
    assert songs[1]["song_title"] == "(deleted song)"  # placeholder for NOT NULL column
    assert songs[1]["youtube_id"] == ""
