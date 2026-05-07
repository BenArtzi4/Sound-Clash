# Sound Clash: Testing Strategy

The standard for this project: **CI is the gate; merging implies the tests passed.** No "I'll test it later", no flaky-test escape hatch, no skipped tests on `main`.

## 1. What we're optimizing for

Not 100% line coverage; that incentivizes testing trivialities.

We're optimizing for **confidence in correctness under realistic conditions** for the high-stakes parts of the system:

| Concern | Why it matters | Test medium |
|---|---|---|
| Buzzer race | A double-winner makes the game unplayable | DB race test (10 concurrent calls) + Playwright |
| State-machine integrity | Invalid transitions corrupt scoreboards | DB tests on each RPC's error paths |
| RLS | Anon must never escalate | DB tests connecting as anon |
| Idempotency | Network retries must not double-award | DB tests calling each RPC twice |
| Latency | The architectural promise is <200ms | E2E latency measurement |
| TTL cleanup | Game data really must disappear at 4h | DB test with manually-set `expires_at` |
| Auth gate | Admin endpoints must reject without password | Backend tests |
| Reconnection | Realtime drop must not leave UI broken | Playwright + frontend hook tests |
| Rate limiting | Abuse must return 429, not exhaust Render | Backend tests |
| Schema migrations | Re-run must be idempotent | `db/migrate.sh` invoked twice in CI |

## 2. Coverage Gates (CI-enforced)

| Gate | Threshold | Tool | Where enforced |
|---|---|---|---|
| All tests pass | 100% (zero failures, zero un-skipped skips) | pytest, vitest, playwright | All workflows |
| Backend line coverage | ≥ 90% | `pytest --cov=app --cov-fail-under=90` | `backend.yml` |
| Backend branch coverage | ≥ 85% | `pytest --cov-branch --cov-fail-under=85` | `backend.yml` |
| Frontend line coverage | ≥ 85% | `vitest run --coverage` with v8 + threshold | `frontend.yml` |
| PL/pgSQL function coverage | 100% | manual: every function has a happy + every error case | reviewed in PR |
| Buzz race test | passes 100 consecutive runs | dedicated CI job loops the test | `e2e.yml` (gated on label `run-stress`) |
| Buzz E2E latency | p95 < 200ms (informational only; flaky in cloud CI) | Playwright trace + report | `e2e.yml` |
| No `# pragma: no cover` | banned outside generated code | `ruff` rule + grep in CI | `backend.yml` |
| No `it.skip` / `test.skip` | banned on main | grep in CI | `frontend.yml` |
| No `xfail` without an open issue link | enforced via PR review | reviewer | code review |

PRs that drop coverage below threshold fail. PRs that introduce skipped tests on `main` fail. PRs cannot merge with red CI.

## 3. Test Pyramid (where each test type lives)

```
                       ╱─────────╲
                      ╱  E2E      ╲          tests/e2e/         ~10 tests
                     ╱  (slow)    ╲          Playwright multi-browser
                    ╱──────────────╲
                   ╱  Integration   ╲        tests/backend/    ~30 tests
                  ╱   (medium)      ╲        pytest+httpx+testcontainers
                 ╱──────────────────╲
                ╱   DB (PL/pgSQL)    ╲       tests/db/         ~25 tests
               ╱     (fast)          ╲       pytest+testcontainers
              ╱───────────────────────╲
             ╱  Unit (frontend hooks   ╲     frontend/**/*.test.ts ~50 tests
            ╱   + backend services)    ╲     vitest, pytest
           ╱─────────────────────────────╲
```

Numbers are targets at end of Phase 6. Don't game them; let the test count emerge from real coverage need.

## 4. Test Categories: What and Where

### 4.1 Database tests: `tests/db/`

Spin up Postgres via `testcontainers-postgres`. Apply all migrations from `db/migrations/`. Run tests against the fresh DB.

| File | What it tests | Phase 3 priority |
|---|---|---|
| `test_buzz_in_race.py` | 10 concurrent buzz_in calls → exactly 1 winner. **Loops 100×** in stress mode. | P0 |
| `test_buzz_in_edge_cases.py` | buzz when game waiting/ended/missing; bad UUID; lock-already-held | P0 |
| `test_start_round.py` | happy path; on ended game raises `game_already_ended`; advances round_number atomically | P0 |
| `test_award_points.py` | happy path; idempotency (second call → `round_already_ended`); timeout case skips score update; team score accumulates | P0 |
| `test_end_game.py` | happy path; on already-ended raises | P1 |
| `test_cleanup_expired_games.py` | manually set `expires_at` to past; invoke `cleanup_expired_games()`; verify cascade to teams + rounds | P0 |
| `test_rls_anon.py` | as `anon` role: SELECT works, INSERT/UPDATE/DELETE rejected on every table | P0 |
| `test_rls_function_grants.py` | as `anon`: EXECUTE buzz_in works; EXECUTE start_round/award_points/end_game/cleanup rejected | P0 |
| `test_migrations_idempotent.py` | run all migrations twice; second run is no-op | P1 |
| `test_schema_constraints.py` | duplicate game_code rejected; duplicate (game_code,name) rejected; FK cascades | P1 |
| `test_pg_cron_registered.py` | `SELECT * FROM cron.job WHERE jobname = 'cleanup-expired-games'` returns 1 row | P1 |

P0 = blocks Phase 3 exit; P1 = ships in Phase 3 but lower priority.

### 4.2 Backend tests: `tests/backend/`

`pytest + httpx` against the FastAPI app, with a testcontainer Postgres + applied migrations as the DB.

| File | What it tests |
|---|---|
| `test_health.py` | `/health` returns 200 with version |
| `test_admin_auth.py` | 401 without header; 200 with correct; 401 with wrong; constant-time compare |
| `test_games_create.py` | happy path; admin auth required; collision-retry on duplicate code; validation (genres required) |
| `test_games_join.py` | happy path; rejected if name duplicate; rejected if game expired; rejected if game ended |
| `test_games_select_song.py` | happy path; respects `selected_genres`; excludes already-played songs; 409 when exhausted |
| `test_games_award_points.py` | happy path; auth required; idempotency surfaces 409 |
| `test_games_end.py` | happy path; auth required; 409 if already ended |
| `test_games_kick_team.py` | happy path; auth required |
| `test_admin_songs_crud.py` | full CRUD; YouTube ID validation; 401 without auth |
| `test_admin_songs_bulk_import.py` | new rows inserted; existing youtube_id updated; malformed CSV rejected with row numbers |
| `test_genres.py` | public; returns all genres |
| `test_rate_limits.py` | exceed `POST /games` rate → 429; per-IP isolation |
| `test_validation.py` | invalid YouTube IDs; oversized team names; out-of-range total_rounds |
| `test_error_mapping.py` | Postgres P0001/P0002 → HTTP 4xx with structured body |

### 4.3 Frontend unit tests: co-located `*.test.ts(x)`

`vitest + @testing-library/react`. Mock the Supabase client.

| File | What it tests |
|---|---|
| `lib/supabase.test.ts` | client singleton; reads env vars |
| `lib/api.test.ts` | sets X-Admin-Password header from session for admin routes |
| `hooks/useBuzzer.test.ts` | calls `rpc('buzz_in', ...)`; pending → success/lost states; double-press blocked |
| `hooks/useGameChannel.test.ts` | subscribes with filter; reducer applies INSERT/UPDATE/DELETE; unsubscribes on unmount |
| `hooks/useServerTime.test.ts` | computes offset on first event; `serverTimeNow()` returns offset-corrected time |
| `hooks/usePlayerReady.test.ts` | resolves when YT ready; queues song load before ready |
| `pages/TeamGameplay.test.tsx` | renders pending/locked/won/lost; reads team identity from localStorage |
| `pages/ManagerConsole.test.tsx` | renders game state; admin actions disabled until player ready |
| `pages/DisplayScreen.test.tsx` | renders scoreboard; updates on team-score events |
| `components/BuzzButton.test.tsx` | disabled while locked; disabled while disconnected; click fires buzz |
| `components/Scoreboard.test.tsx` | sorts by score desc; ties shown together |
| `lib/managerToken.test.ts` (covered inline by `pages/ManagerConsolePage.test.tsx` + `pages/ManagerCreateGamePage.test.tsx`) | localStorage round-trip; absent token → "not the host" branch |

### 4.4 E2E tests: `tests/e2e/`

Playwright with multi-browser-context. Runs against a dedicated `Sound-Clash-Preview` Supabase project.

| File | What it tests |
|---|---|
| `buzzer_race.spec.ts` | manager + 2 teams + display; both teams click within 5ms; deterministic winner; all contexts agree |
| `full_game.spec.ts` | 3-round happy path with score accumulation |
| `reconnection.spec.ts` | team disconnects mid-game; reload; state restored; can buzz |
| `expiration.spec.ts` | game with expires_at in past; cron runs; all clients redirect to "expired" page |
| `admin_songs_crud.spec.ts` | create/edit/delete song via admin API + bulk-import idempotency (UI deferred; see roadmap) |
| `kick_team.spec.ts` | manager kicks team; team's tab redirects |
| `mobile_team.spec.ts` | iPhone viewport; buzzer reachable + tappable |

Multi-browser matrix: chromium + firefox + webkit. Each spec must pass in all three.

### 4.5 Smoke tests: `tests/smoke/`

Run manually after each prod deploy.

| File | What it does |
|---|---|
| `post_deploy.sh` | curl `/health`; create game (no auth) and capture `manager_token`; join 2 teams; start round (with token); end game (with token); cleanup |
| `prod_realtime.spec.ts` | Playwright against prod URL; one buzzer race round end-to-end |

## 5. Phase Schedule

| Phase | Tests written | Coverage gates active? |
|---|---|---|
| Phase 1 (scaffolding) | dummy passing tests in each suite (so CI runs green) | Configured but at low thresholds (e.g., 0%; passes with empty code) |
| Phase 2 (data migration) | smoke check on imported songs | n/a |
| Phase 3 (Postgres logic) | All `tests/db/*` | DB tests: 100% functions tested + race test 100× |
| Phase 4 (backend port) | All `tests/backend/*` | Backend coverage gate raised to 90% |
| Phase 5 (frontend) | All `frontend/**/*.test.ts(x)` + integration | Frontend coverage gate raised to 85% |
| Phase 6 (E2E) | All `tests/e2e/*` | E2E gate active; latency reported |
| Phase 7 (cutover) | `tests/smoke/*` | Manual run after deploy |

Coverage thresholds in CI start LOW in Phase 1 (so the empty repo doesn't block) and ratchet UP at the end of each phase. PRs to ratchet thresholds are mandatory at phase boundaries.

## 6. Anti-Patterns We Reject

| Anti-pattern | Why we reject |
|---|---|
| Catch-all `try/except: pass` in test | Hides real failures |
| Assertions inside try-blocks | Pytest rewrites assert; the try eats useful info |
| `time.sleep(N)` for race conditions | Flaky; use polling with timeout |
| Mocking Postgres in DB tests | Defeats the point; use testcontainers |
| Tests that depend on test order | Tests must be independent (`pytest -p no:randomly` should still pass) |
| Tests that hit the real Supabase prod project | NEVER; preview only, or testcontainers |
| `it.skip` to "fix later" | Tests are either green or deleted; no gray zone |
| 100% line coverage by testing getters | Optimize for branch coverage on real logic |
| Snapshot tests for everything | Snapshots without intent become regression-blockers without value |
| Coverage reports that summarize but don't fail CI | Threshold-only; humans don't reliably check coverage trends |

## 7. Tooling

### Backend (Python)

```toml
# pyproject.toml [tool.pytest.ini_options]
addopts = "-ra --strict-markers --tb=short -p no:randomly"

# pyproject.toml [tool.coverage.run]
branch = true
source = ["app"]

# pyproject.toml [tool.coverage.report]
fail_under = 90  # raised per phase
exclude_lines = ["pragma: no cover", "if TYPE_CHECKING:", "raise NotImplementedError"]
```

### Frontend

```ts
// vitest.config.ts
test: {
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov'],
    thresholds: {
      lines: 85,
      branches: 80,
      functions: 85,
      statements: 85,
    },
    exclude: ['**/*.test.{ts,tsx}', 'src/main.tsx'],
  },
}
```

### Playwright

```ts
// playwright.config.ts
{
  retries: process.env.CI ? 1 : 0,    // single retry only; surface flake
  workers: process.env.CI ? 2 : undefined,
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox',  use: devices['Desktop Firefox'] },
    { name: 'webkit',   use: devices['Desktop Safari'] },
    { name: 'mobile',   use: devices['iPhone SE'] },
  ],
}
```

## 8. CI Workflow Outline

`backend.yml`:
```yaml
on: [pull_request, push]
jobs:
  test:
    services:
      postgres: postgres:15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -e backend[dev]
      - run: ruff check backend/
      - run: ruff format --check backend/
      - run: mypy backend/app
      - run: cd backend && pytest --cov=app --cov-branch --cov-fail-under=90 --cov-report=xml
      - run: '! grep -r "pragma: no cover" backend/app'
      - uses: codecov/codecov-action@v4
        with: { file: backend/coverage.xml, fail_ci_if_error: true }
```

`frontend.yml`:
```yaml
on: [pull_request, push]
jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npm run typecheck
      - run: cd frontend && npm run test -- --coverage --run
      - run: '! grep -rE "(it|test)\.skip" frontend/src'
      - uses: codecov/codecov-action@v4
        with: { file: frontend/coverage/lcov.info }
```

`e2e.yml`: runs Playwright against the preview Supabase project, label-gated for full matrix.

`db-migrate.yml`: manual dispatch; applies migrations to a chosen environment.

## 9. Local Discipline

Tests run before commit (pre-commit hook):
```yaml
# .pre-commit-config.yaml
- id: ruff-check
- id: ruff-format
- id: pytest-quick   # fast subset, e.g., pytest -m "not slow"
- id: vitest-affected
```

Full suite expected to be runnable in <2 min locally (excluding E2E and DB stress).

## 10. Open Questions / Future Work

- **Mutation testing** (e.g., `mutmut`) on the PL/pgSQL functions: would catch tests that pass without actually validating the logic. Worth considering once the test suite stabilizes.
- **Property-based testing** (e.g., `hypothesis` for game-code generator collision rate, score arithmetic): nice-to-have.
- **Performance regression tests** (track `buzz_in` p95 over time): not in MVP.
- **Visual regression tests** for the manager/display UI: not in MVP; game is functional, not pixel-perfect.

## 11. What This Doc Doesn't Cover

- How to write specific tests (read the existing tests for the pattern)
- Mocking strategies (covered case-by-case in test files)
- Tests for legacy code (out of scope; legacy is reference-only)
