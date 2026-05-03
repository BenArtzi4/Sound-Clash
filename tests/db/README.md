# Database tests

Tests for PL/pgSQL functions, RLS policies, schema constraints, and the pg_cron sweeper.

These tests spin up a fresh Postgres 15 instance via `testcontainers-postgres`, apply all `db/migrations/*.sql` files in order, then run the test logic.

**Phase 3 deliverable.** Empty in Phase 1.

## Planned test files

See [`docs/testing-strategy.md`](../../docs/testing-strategy.md) §4.1 for the full list. Highlights:

- `test_buzz_in_race.py` — 10 concurrent calls → exactly 1 winner. **Stress mode runs 100×.**
- `test_buzz_in_edge_cases.py` — game waiting/ended/missing; bad UUID; lock-already-held.
- `test_award_points.py` — happy path; **idempotency** (second call → 409); timeout case skips score update.
- `test_rls_anon.py` — as `anon` role: SELECT works on every table; INSERT/UPDATE/DELETE rejected.
- `test_rls_function_grants.py` — only `buzz_in` is anon-callable.
- `test_cleanup_expired_games.py` — manually set `expires_at` to past; invoke cleanup; verify cascade.
- `test_migrations_idempotent.py` — applying migrations twice is a no-op.

## Running

```bash
# From repo root, requires Docker for testcontainers
cd backend
pytest ../tests/db
pytest ../tests/db -m stress       # the 100× race loop
```

## Authoring conventions

- Each test file owns one PL/pgSQL function (or one cross-cutting concern like RLS).
- Use the `db_with_migrations` fixture (in `conftest.py`) — it gives you a fresh testcontainer with all migrations applied.
- Don't share state between tests. Create the game/teams/etc. inside each test.
- Race-condition tests use `asyncio.gather` over `asyncpg`. **No `time.sleep`.**
- Mark race tests with `@pytest.mark.stress` so they're opt-in in CI.

## What NOT to do

- ❌ Don't connect to production Supabase from these tests. Ever.
- ❌ Don't mock Postgres. The point is to exercise the real engine.
- ❌ Don't use `pytest.mark.skip` to "fix later." Either delete the test or the marker.
