"""pg_cron; the cleanup-expired-games job is registered.

Skipped on Postgres installs without pg_cron (testcontainers postgres:15).
On Supabase preview/prod, this verifies the schedule exists with the right
cron expression, satisfying Phase 3 exit criterion #3.
"""

from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.needs_docker


@pytest.mark.asyncio
async def test_cleanup_job_is_scheduled_when_pg_cron_loaded(
    db: asyncpg.Connection,
) -> None:
    loaded = await db.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')"
    )
    if not loaded:
        pytest.skip("pg_cron not loaded; cron registration is verified on Supabase only.")

    row = await db.fetchrow(
        "SELECT jobname, schedule FROM cron.job WHERE jobname = 'cleanup-expired-games'"
    )
    assert row is not None, "cleanup-expired-games job is not registered"
    assert row["schedule"] == "0 * * * *"
