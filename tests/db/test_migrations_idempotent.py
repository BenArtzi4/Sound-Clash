"""Migrations are idempotent; re-applying produces no errors and no diff.

This is also enforced in CI by db-migrate.yml (apply, then re-apply). The test
here gives the same coverage to local-dev runs.
"""

from __future__ import annotations

from pathlib import Path

import asyncpg
import pytest

pytestmark = pytest.mark.needs_docker

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"


@pytest.mark.asyncio
async def test_reapplying_migrations_succeeds(db: asyncpg.Connection) -> None:
    """The session fixture has applied all migrations; re-apply once more."""
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        sql = path.read_text(encoding="utf-8")
        await db.execute(sql)


@pytest.mark.asyncio
async def test_reapplying_does_not_change_table_count(
    db: asyncpg.Connection,
) -> None:
    table_count_sql = "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
    before = await db.fetchval(table_count_sql)

    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        await db.execute(path.read_text(encoding="utf-8"))

    after = await db.fetchval(table_count_sql)
    assert before == after


@pytest.mark.asyncio
async def test_reapplying_does_not_duplicate_policies(
    db: asyncpg.Connection,
) -> None:
    """Re-applying 006 must not duplicate a policy. Migration 054 drops two of
    006's policies, so 006 alone is not the end state: replay 006 and every
    migration after it, as CI's second pass does, and compare the full set."""
    policies_sql = (
        "SELECT tablename, policyname FROM pg_policies "
        "WHERE schemaname = 'public' ORDER BY 1, 2"
    )
    before = [tuple(r) for r in await db.fetch(policies_sql)]
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name >= "006_rls_policies.sql":
            await db.execute(path.read_text(encoding="utf-8"))
    after = [tuple(r) for r in await db.fetch(policies_sql)]
    assert before == after


@pytest.mark.asyncio
async def test_reapplying_keeps_the_catalog_closed_to_anon(
    db: asyncpg.Connection,
) -> None:
    """Migration 054: a full replay re-runs 006 (which grants anon SELECT on
    songs / song_genres and recreates their policies) and then 054, which
    removes both again. The end state must still deny anon."""
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        await db.execute(path.read_text(encoding="utf-8"))
    for table in ("songs", "song_genres"):
        for role in ("anon", "authenticated"):
            assert await db.fetchval(
                "SELECT has_table_privilege($1, $2, 'SELECT')", role, f"public.{table}"
            ) is False, f"{role} can read {table} after a replay"
    assert await db.fetchval(
        "SELECT has_table_privilege('anon', 'public.genres', 'SELECT')"
    ) is True
