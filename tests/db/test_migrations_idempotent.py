"""Migrations are idempotent — re-applying produces no errors and no diff.

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
    policy_count_sql = "SELECT count(*) FROM pg_policies WHERE schemaname = 'public'"
    before = await db.fetchval(policy_count_sql)
    rls_path = MIGRATIONS_DIR / "006_rls_policies.sql"
    await db.execute(rls_path.read_text(encoding="utf-8"))
    after = await db.fetchval(policy_count_sql)
    assert before == after
