# Tests

Five test categories live here. The split is intentional — see [`docs/testing-strategy.md`](../docs/testing-strategy.md) for the complete strategy.

| Directory | What goes here | Tool | Phase |
|---|---|---|---|
| [`db/`](db/) | PL/pgSQL function tests, RLS policy tests, migration idempotency, pg_cron | pytest + testcontainers-postgres | 3 |
| [`backend/`](backend/) | FastAPI endpoint tests against an in-process app with testcontainer DB | pytest + httpx + testcontainers | 4 |
| [`frontend/`](frontend/) | (Empty) — frontend unit tests are co-located with components in `frontend/src/**/*.test.ts(x)`. This dir exists only for cross-component integration tests if needed. | vitest | 5 |
| [`e2e/`](e2e/) | Playwright multi-browser, multi-context end-to-end | Playwright | 6 |
| [`smoke/`](smoke/) | Post-deploy synthetic checks against prod or preview | bash + Playwright | 7 |

## Hard rules

These are enforced by CI. Violating any of them blocks merge:

1. **No skipped tests on `main`**. `it.skip`, `test.skip`, `@pytest.mark.skip`, `xfail` all banned outside of generated code or with a documented issue link.
2. **No `pragma: no cover` in `backend/app/`**. We don't game coverage.
3. **No tests against the prod Supabase project**. Use testcontainers (DB tests) or the `Sound-Clash-Preview` project (E2E).
4. **No `time.sleep(N)` to wait for race conditions**. Poll with timeout or use proper synchronization.
5. **Tests must be independent**. Order randomization is enabled (`pytest -p no:randomly` is on); a passing-only-in-order test is a failing test.

## Running tests locally

```bash
# Backend (from repo root)
cd backend
pytest                              # all backend + db tests
pytest tests/backend                # subset
pytest -m "not slow and not stress" # quick subset
pytest --cov=app --cov-report=html  # coverage report

# Frontend (from repo root)
cd frontend
npm test                            # watch mode
npm run test:run                    # single run
npm run test:coverage               # with coverage

# E2E (requires local stack running OR preview env vars)
cd tests/e2e
npx playwright test                 # all
npx playwright test --ui            # interactive
```

See [`docs/local-development.md`](../docs/local-development.md) for full local setup.

## Test inventory

[`docs/testing-strategy.md`](../docs/testing-strategy.md) §4 lists every planned test file with its purpose and phase. Don't add a new test file without a corresponding entry there (or update the strategy doc in the same PR).

## Phase 1 status

This dir is mostly empty in Phase 1. Each subdirectory contains a placeholder smoke test that proves CI runs end-to-end. Real tests arrive in their respective phases.
