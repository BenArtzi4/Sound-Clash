"""buzz_in race correctness — the headline Phase 3 exit criterion.

10 concurrent calls to buzz_in() must produce exactly 1 winner. The test is
marked `stress` so the e2e.yml `buzz_race_stress` job runs it 100 times in a
row (`for i in seq 1 100; do pytest -x -m stress ...`).

See docs/realtime-design.md §4 for the race-correctness argument and
docs/rpc-functions.md §1 for the function spec.
"""

from __future__ import annotations

import asyncio

import asyncpg
import pytest

from ._helpers import create_test_game, create_test_team

pytestmark = [pytest.mark.stress, pytest.mark.needs_docker]


@pytest.mark.asyncio
async def test_concurrent_buzz_one_winner(db: asyncpg.Connection, pool: asyncpg.Pool) -> None:
    """10 teams call buzz_in simultaneously; exactly one row reports locked=true."""
    game_code = await create_test_game(db, status="playing")
    team_ids = [await create_test_team(db, game_code) for _ in range(10)]

    async def race(team_id: object) -> asyncpg.Record:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT locked, locked_team_id, locked_at FROM buzz_in($1, $2)",
                game_code,
                team_id,
            )
            assert row is not None
            return row

    results = await asyncio.gather(*(race(tid) for tid in team_ids))

    winners = [r for r in results if r["locked"]]
    assert len(winners) == 1, (
        f"Expected exactly 1 winner, got {len(winners)}; results={list(results)}"
    )

    # The single winner's locked_team_id matches one of the team ids we created.
    winner = winners[0]
    assert winner["locked_team_id"] in team_ids
    assert winner["locked_at"] is not None

    # Every loser sees the same winning team in their locked_team_id field
    # (the function returns the current holder for non-winners).
    losers = [r for r in results if not r["locked"]]
    assert len(losers) == 9
    for loser in losers:
        assert loser["locked_team_id"] == winner["locked_team_id"]
