"""RLS; the anon role can SELECT but never mutate any table.

Spec: docs/security-rls.md §2.
"""

from __future__ import annotations

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_song, create_test_team

pytestmark = pytest.mark.needs_docker

ALL_TABLES = (
    "songs",
    "genres",
    "song_genres",
    "active_games",
    "game_teams",
    "game_rounds",
)


@pytest.mark.asyncio
async def test_anon_can_select_every_table(
    db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    """Populate via service-role conn, then SELECT via anon. Each must succeed."""
    game_code = await create_test_game(db)
    team_id = await create_test_team(db, game_code)
    song_id = await create_test_song(db)
    await db.execute(
        "INSERT INTO song_genres (song_id, genre_id) VALUES ($1, (SELECT id FROM genres LIMIT 1))",
        song_id,
    )
    await db.execute(
        "INSERT INTO game_rounds (game_code, round_number, song_id, buzzed_team_id) "
        "VALUES ($1, 1, $2, $3)",
        game_code,
        song_id,
        team_id,
    )

    for table in ALL_TABLES:
        rows = await anon_conn.fetch(f"SELECT * FROM {table}")  # noqa: S608 - constant table list
        assert len(rows) >= 1, f"anon read of {table} returned no rows"


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ALL_TABLES)
async def test_anon_cannot_insert(
    table: str, db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    # The exact SQL that would otherwise succeed for service_role; for anon,
    # Postgres rejects it before inspecting the values.
    payloads: dict[str, tuple[str, tuple[object, ...]]] = {
        "songs": (
            "INSERT INTO songs (title, artist, youtube_id) VALUES ($1, $2, $3)",
            ("X", "Y", "abcdefghijk"),
        ),
        "genres": (
            "INSERT INTO genres (name, slug) VALUES ($1, $2)",
            ("New Genre", "new-genre"),
        ),
        "song_genres": (
            "INSERT INTO song_genres (song_id, genre_id) "
            "VALUES (gen_random_uuid(), gen_random_uuid())",
            (),
        ),
        "active_games": (
            "INSERT INTO active_games (game_code, total_rounds) VALUES ($1, $2)",
            ("INSERT", 5),
        ),
        "game_teams": (
            "INSERT INTO game_teams (game_code, name) VALUES ($1, $2)",
            ("INSERT", "T"),
        ),
        "game_rounds": (
            "INSERT INTO game_rounds (game_code, round_number) VALUES ($1, $2)",
            ("INSERT", 1),
        ),
    }
    sql, args = payloads[table]
    with pytest.raises(
        (asyncpg.InsufficientPrivilegeError, asyncpg.exceptions.InsufficientPrivilegeError)
    ):
        await anon_conn.execute(sql, *args)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ALL_TABLES)
async def test_anon_cannot_update(
    table: str, db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    # Need at least one row to attempt to update; create per-table.
    if table == "songs":
        await create_test_song(db)
        sql = "UPDATE songs SET title = 'x'"
    elif table == "genres":
        sql = "UPDATE genres SET name = 'x' WHERE slug = 'rock'"
    elif table == "song_genres":
        song_id = await create_test_song(db)
        await db.execute(
            "INSERT INTO song_genres (song_id, genre_id) "
            "VALUES ($1, (SELECT id FROM genres LIMIT 1))",
            song_id,
        )
        sql = "UPDATE song_genres SET genre_id = genre_id"
    elif table == "active_games":
        await create_test_game(db)
        sql = "UPDATE active_games SET status = 'ended'"
    elif table == "game_teams":
        game_code = await create_test_game(db)
        await create_test_team(db, game_code)
        sql = "UPDATE game_teams SET name = 'hijack'"
    elif table == "game_rounds":
        game_code = await create_test_game(db)
        song_id = await create_test_song(db)
        await db.execute(
            "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, 1, $2)",
            game_code,
            song_id,
        )
        sql = "UPDATE game_rounds SET title_points = 99"
    else:  # pragma: no cover
        raise AssertionError(table)

    with pytest.raises(
        (asyncpg.InsufficientPrivilegeError, asyncpg.exceptions.InsufficientPrivilegeError)
    ):
        await anon_conn.execute(sql)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ALL_TABLES)
async def test_anon_cannot_delete(
    table: str, db: asyncpg.Connection, anon_conn: asyncpg.Connection
) -> None:
    # Seed each table with at least one row first via service_role.
    if table == "songs":
        await create_test_song(db)
    elif table == "song_genres":
        song_id = await create_test_song(db)
        await db.execute(
            "INSERT INTO song_genres (song_id, genre_id) "
            "VALUES ($1, (SELECT id FROM genres LIMIT 1))",
            song_id,
        )
    elif table == "active_games":
        await create_test_game(db)
    elif table == "game_teams":
        game_code = await create_test_game(db)
        await create_test_team(db, game_code)
    elif table == "game_rounds":
        game_code = await create_test_game(db)
        song_id = await create_test_song(db)
        await db.execute(
            "INSERT INTO game_rounds (game_code, round_number, song_id) VALUES ($1, 1, $2)",
            game_code,
            song_id,
        )
    # genres always has the seed.

    with pytest.raises(
        (asyncpg.InsufficientPrivilegeError, asyncpg.exceptions.InsufficientPrivilegeError)
    ):
        await anon_conn.execute(f"DELETE FROM {table}")  # noqa: S608 - constant table list
