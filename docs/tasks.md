# Sound Clash — Task List

Granular, checkboxed tasks grouped by area. Tasks within an area are roughly ordered, but cross-area parallelism is fine where dependencies allow. Each task should be small enough to ship as one PR.

The new repo is **`Sound-Clash`** (GitHub). The legacy AWS-based repo is **`Sound-Clash-legacy`**.

## Phase 0 — Naming

- [ ] **NAME-01** Rename GitHub repo `BenArtzi4/Sound-Clash` → `BenArtzi4/Sound-Clash-legacy` (Settings → General → Repository name). GitHub auto-redirects the old URL.
- [ ] **NAME-02** Update local clone's remote: `git remote set-url origin https://github.com/BenArtzi4/Sound-Clash-legacy.git`
- [ ] **NAME-03** Add `LEGACY.md` at the root of the renamed repo: "AWS-based Sound Clash. Active development at https://github.com/BenArtzi4/Sound-Clash."

## Infrastructure

- [ ] **INFRA-01** Create new GitHub repo **`Sound-Clash`** (public, MIT license)
- [ ] **INFRA-02** Add baseline files: `.gitignore`, `.env.example`, `README.md`, `LICENSE`, `CODEOWNERS`
- [ ] **INFRA-03** Skeleton directory layout: `backend/`, `frontend/`, `db/migrations/`, `db/seed/`, `tests/`, `scripts/`, `docs/`, `.github/workflows/`
- [ ] **INFRA-04** Copy planning docs from `Sound-Clash-Plan/` into new repo's `docs/` (architecture, realtime-design, data-model, rpc-functions, security-rls, api-contracts, game-rules, tech-stack, runbook, free-tier-budget, local-development)
- [ ] **INFRA-05** Create Supabase project `Sound-Clash` (region: closest to primary users — see `tech-stack.md` §3); record project URL + anon key + service-role key
- [ ] **INFRA-06** Enable Postgres extensions in Supabase: `pg_cron`, `pgcrypto`
- [ ] **INFRA-07** Create dedicated `Sound-Clash-Preview` Supabase project for E2E (see `local-development.md` §12)
- [ ] **INFRA-08** Create Render web service, link to GitHub repo, autodetect Dockerfile in `backend/`
- [ ] **INFRA-09** Create Cloudflare Pages project, link to GitHub repo; build command `npm run build`, output `frontend/dist`
- [ ] **INFRA-10** Add DNS records in Cloudflare: apex `soundclash.org` → Pages; `api.soundclash.org` CNAME → Render
- [ ] **INFRA-11** Add GitHub repo secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PREVIEW_URL`, `SUPABASE_PREVIEW_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `RENDER_DEPLOY_HOOK`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `SENTRY_DSN_FRONTEND`, `SENTRY_DSN_BACKEND`
- [ ] **INFRA-12** Add Render env vars: same secrets minus CF_*; plus `LOG_LEVEL`, `CORS_ORIGINS`
- [ ] **INFRA-13** Add Cloudflare Pages env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_SENTRY_DSN`
- [ ] **INFRA-14** cron-job.org: register, add a job pinging `https://api.soundclash.org/health` every 14 min
- [ ] **INFRA-15** Sentry: create project `sound-clash`; record DSNs (frontend + backend separately)
- [ ] **INFRA-16** Configure Supabase email alerts: free-tier dashboards → set thresholds per `free-tier-budget.md` §4

## Auth & Security

- [ ] **AUTH-01** Implement `backend/app/middleware/admin_auth.py`: header check `X-Admin-Password` vs env var, **constant-time comparison** (`secrets.compare_digest`)
- [ ] **AUTH-02** Apply admin middleware to `/admin/*` and `POST /games`, `POST /games/*/select-song`, `POST /games/*/award-points`, `POST /games/*/end`, `DELETE /games/*/teams/*`
- [ ] **AUTH-03** Frontend: keep existing `AuthContext.tsx` pattern; on admin pages, send `X-Admin-Password` header on every API call via `frontend/src/lib/api.ts` interceptor
- [ ] **AUTH-04** RLS policies SQL — see `security-rls.md` §2
- [ ] **AUTH-05** Function grants: `GRANT EXECUTE ON FUNCTION buzz_in TO anon`; revoke all others from PUBLIC
- [ ] **AUTH-06** CSP `_headers` file in frontend — see `security-rls.md` §7
- [ ] **AUTH-07** Backend security headers (HSTS, X-Content-Type-Options) via FastAPI middleware
- [ ] **AUTH-08** Verify in CI: no `SUPABASE_SERVICE_ROLE_*` env vars are exposed to the frontend bundle. Add a check that fails the frontend build if found.
- [ ] **AUTH-09** Pre-commit hook scanning for committed JWT-shaped strings (catches accidental key leaks)
- [ ] **AUTH-10** Rate limit config in FastAPI via `slowapi` — see `security-rls.md` §6 for limits
- [ ] **AUTH-11** Document secret rotation procedure (covered in `runbook.md` §3)

## Database — Postgres

- [ ] **DB-01** `db/migrations/001_extensions.sql` — `CREATE EXTENSION IF NOT EXISTS pg_cron, pgcrypto`
- [ ] **DB-02** `db/migrations/002_durable_tables.sql` — `songs`, `genres`, `song_genres` (per `data-model.md` §2)
- [ ] **DB-03** `db/migrations/003_ephemeral_tables.sql` — `active_games`, `game_teams`, `game_rounds`, deferred FKs
- [ ] **DB-04** `db/migrations/004_indexes.sql` — per `data-model.md` §3
- [ ] **DB-05** `db/migrations/005_rpc_functions.sql` — `buzz_in`, `start_round`, `award_points`, `end_game`, `cleanup_expired_games` (full bodies in `rpc-functions.md`)
- [ ] **DB-06** `db/migrations/006_rls_policies.sql` — enable RLS, anon SELECT policies, function grants
- [ ] **DB-07** `db/migrations/007_cron_jobs.sql` — `cron.schedule('cleanup-expired-games', '0 * * * *', ...)`
- [ ] **DB-08** `db/seed/genres.sql` — initial genre list (rock, pop, hiphop, classical, soundtrack, jazz, electronic, ...)
- [ ] **DB-09** `db/migrate.sh` — applies migrations in order via `psql`; supports `local`/`preview`/`prod` targets
- [ ] **DB-10** `.github/workflows/db-migrate.yml` — manual-dispatch workflow that applies migrations to chosen environment

## Backend — Python (FastAPI)

- [ ] **PY-01** `backend/pyproject.toml` with deps: `fastapi`, `uvicorn[standard]`, `supabase`, `pydantic`, `python-multipart` (for CSV upload), `slowapi`, `sentry-sdk[fastapi]`; dev: `pytest`, `pytest-asyncio`, `httpx`, `testcontainers[postgres]`, `ruff`, `mypy`
- [ ] **PY-02** `backend/Dockerfile` — multi-stage, non-root user, uvicorn entry on `$PORT`
- [ ] **PY-03** `backend/app/main.py` — FastAPI app, CORS for `soundclash.org`, mounts routers, `/health` endpoint, Sentry init, slowapi init
- [ ] **PY-04** `backend/app/db/supabase_client.py` — singleton client using service-role key
- [ ] **PY-05** `backend/app/routers/games.py` per `api-contracts.md` §2:
  - `POST /games` (admin-gated)
  - `POST /games/{code}/teams`
  - `POST /games/{code}/select-song` (admin-gated; calls `start_round` RPC)
  - `POST /games/{code}/award-points` (admin-gated; calls `award_points` RPC)
  - `POST /games/{code}/end` (admin-gated; calls `end_game` RPC)
  - `DELETE /games/{code}/teams/{team_id}` (admin-gated)
- [ ] **PY-06** `backend/app/routers/admin_songs.py` — admin-gated GET/POST/PUT/DELETE; bulk CSV import endpoint with idempotency on `youtube_id`
- [ ] **PY-07** `backend/app/routers/genres.py` — public GET `/genres`
- [ ] **PY-08** `backend/app/services/game_code.py` — generator: 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; collision retry
- [ ] **PY-09** `backend/app/services/song_picker.py` — random song with `selected_genres` filter and "no repeats per game" enforcement
- [ ] **PY-10** Pydantic request/response models matching `api-contracts.md`
- [ ] **PY-11** Validation: YouTube ID regex `^[A-Za-z0-9_-]{11}$`; team name 1–30 chars
- [ ] **PY-12** Error handler middleware mapping Postgres P0001/P0002 → HTTP 4xx codes
- [ ] **PY-13** Confirm zero WebSocket code: `grep -ri 'websocket\|socket.io' backend/` returns nothing

## Realtime / Frontend

- [ ] **FE-01** `frontend/package.json` — React 18, TypeScript 5, Vite 5, `@supabase/supabase-js`, `react-router-dom`, `vitest`, `@testing-library/react`, `@sentry/react`
- [ ] **FE-02** `frontend/.env.example` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_SENTRY_DSN`
- [ ] **FE-03** `frontend/src/lib/supabase.ts` — exported singleton client
- [ ] **FE-04** `frontend/src/lib/api.ts` — typed REST client for FastAPI; sends `X-Admin-Password` from session for admin calls
- [ ] **FE-05** `frontend/src/hooks/useGameChannel.ts` — Realtime subscription with reducer pattern (per `realtime-design.md` §5–6); subscribes then fetches initial state
- [ ] **FE-06** `frontend/src/hooks/useBuzzer.ts` — `supabase.rpc('buzz_in', ...)`; exposes `{ buzz, isLocking, lockedTeam, lockedAt }`; Sentry transaction wrap
- [ ] **FE-07** `frontend/src/hooks/useServerTime.ts` — measures server-client clock offset on first event; exposes `serverTimeNow()` (per `realtime-design.md` §8)
- [ ] **FE-08** `frontend/src/hooks/usePlayerReady.ts` — gates round-active UI behind YouTube IFrame player readiness (per `realtime-design.md` §9)
- [ ] **FE-09** Refactor `TeamGameplay.tsx`: use `useGameChannel` + `useBuzzer`; persist team identity in `localStorage` (per `game-rules.md` §7)
- [ ] **FE-10** Refactor `ManagerConsole.tsx`: live state from `useGameChannel`; control actions call FastAPI; YouTube IFrame Player retained; player-ready gate
- [ ] **FE-11** Refactor `DisplayScreen.tsx`: live state from `useGameChannel`; YouTube IFrame Player retained; large-screen styling
- [ ] **FE-12** Decision + impl: team page omits YouTube embed (recommended; per `game-rules.md` §12)
- [ ] **FE-13** Delete legacy WebSocket code: `frontend/src/services/websocket/` and any `socket.io` references
- [ ] **FE-14** Reconnection banner: while `channel` not subscribed, show "reconnecting…" non-blocking banner; disable buzz button
- [ ] **FE-15** Game-expired handler: detect Realtime DELETE on `active_games`; redirect to "game expired" screen
- [ ] **FE-16** Kicked-team handler: detect Realtime DELETE on own `game_teams` row; redirect to join screen
- [ ] **FE-17** Keep `AuthContext.tsx` admin password gate; verify `ProtectedRoute` still works
- [ ] **FE-18** Routes: `/`, `/manager/create`, `/manager/lobby/:code`, `/manager/game/:code`, `/team/join`, `/team/:code`, `/display/join`, `/display/:code`, `/admin/songs`
- [ ] **FE-19** `_headers` file with CSP (per `security-rls.md` §7)
- [ ] **FE-20** Sentry init in `main.tsx` with `beforeSend` scrubbing team names
- [ ] **FE-21** Confirm zero legacy WebSocket client code: `grep -ri 'WebSocket\|socket.io' frontend/src/` returns nothing app-level

## Testing

- [ ] **TEST-01** `tests/db/test_buzz_in_race.py` — testcontainers Postgres + 10 concurrent `buzz_in` calls; exactly one wins; **must pass 100 consecutive runs** (Phase 3 exit criterion)
- [ ] **TEST-02** `tests/db/test_buzz_in_edge_cases.py` — buzz when game waiting; buzz when game ended; buzz with bad UUID; lock-already-held returns false
- [ ] **TEST-03** `tests/db/test_rls_policies.py` — connects as `anon`; asserts allowed SELECTs and denied mutations
- [ ] **TEST-04** `tests/db/test_cron_cleanup.py` — insert game with past `expires_at`; manually invoke `cleanup_expired_games()`; assert deletion + cascade
- [ ] **TEST-05** `tests/db/test_award_points_idempotency.py` — call `award_points` twice on same round; second call raises `round_already_ended`
- [ ] **TEST-06** `tests/backend/test_games_router.py` — full happy path: create → join × 2 → start round × 3 → award × 3 → end
- [ ] **TEST-07** `tests/backend/test_admin_auth.py` — 401 without header; 200 with correct; 401 with wrong; constant-time comparison
- [ ] **TEST-08** `tests/backend/test_rate_limits.py` — exceed `POST /games` rate limit; assert 429
- [ ] **TEST-09** `tests/backend/test_admin_songs.py` — full CRUD + bulk import idempotency
- [ ] **TEST-10** `tests/backend/test_validation.py` — bad YouTube IDs, oversized team names, empty genres list
- [ ] **TEST-11** `frontend/src/hooks/useBuzzer.test.ts` — vitest with mocked Supabase client
- [ ] **TEST-12** `frontend/src/hooks/useGameChannel.test.ts` — vitest; subscribe → event applied → state updated
- [ ] **TEST-13** `frontend/src/components/*.test.tsx` — at least 5 component tests covering critical UI states
- [ ] **TEST-14** `tests/e2e/playwright.config.ts` — multi-context base, runs against preview Supabase
- [ ] **TEST-15** `tests/e2e/buzzer_race.spec.ts` — 4 contexts (manager, team1, team2, display); race the buzz; deterministic outcome and < 200ms p95 latency
- [ ] **TEST-16** `tests/e2e/full_game.spec.ts` — 3-round happy path
- [ ] **TEST-17** `tests/e2e/reconnection.spec.ts` — team disconnects mid-game; rejoin; state correct
- [ ] **TEST-18** `tests/e2e/admin_flows.spec.ts` — admin login + song CRUD via UI
- [ ] **TEST-19** `tests/e2e/expiration.spec.ts` — game with `expires_at` set to 1 sec in past; trigger cron manually; verify all clients redirect
- [ ] **TEST-20** Coverage: `pytest --cov=app` (backend), `vitest --coverage` (frontend); upload to Codecov free tier

## CI/CD

- [ ] **CI-01** `.github/workflows/backend.yml` — on PR + main: `ruff check`, `ruff format --check`, `mypy`, `pytest`; on main only: trigger `RENDER_DEPLOY_HOOK`
- [ ] **CI-02** `.github/workflows/frontend.yml` — on PR + main: `npm ci`, `tsc --noEmit`, `eslint`, `vitest run`, `npm run build`; on main only: `wrangler pages deploy`
- [ ] **CI-03** `.github/workflows/e2e.yml` — on PR (label `run-e2e`) + main: Playwright against `Sound-Clash-Preview` Supabase project
- [ ] **CI-04** `.github/workflows/db-migrate.yml` — manual dispatch; runs migrations against chosen environment (preview / prod)
- [ ] **CI-05** Branch protection on `main`: require backend + frontend workflows green; require 1 review (or admin override for solo work)
- [ ] **CI-06** Dependabot config for `pip` and `npm` (weekly; auto-merge low-severity patch updates)
- [ ] **CI-07** Add Codecov badges to README
- [ ] **CI-08** Pre-commit hook: ruff + prettier (frontend); on each commit
- [ ] **CI-09** Verification step in `frontend.yml`: build artifact must not contain `service_role` (catches accidental leak)

## Deployment / Cutover

- [ ] **DEPLOY-01** First production deploy of backend to Render; verify `/health` 200
- [ ] **DEPLOY-02** First production deploy of frontend to Cloudflare Pages; verify static load
- [ ] **DEPLOY-03** Run `db-migrate` workflow against prod Supabase; verify schema and seed
- [ ] **DEPLOY-04** Run data import (Phase 2 scripts) against prod; verify song count
- [ ] **DEPLOY-05** Manual smoke test: create game → 2 teams join → 3 rounds → end → verify scoreboard → wait for cron sweep → verify game row deleted
- [ ] **DEPLOY-06** `tests/smoke/post_deploy.sh` — automated smoke test for use after every deploy
- [ ] **DEPLOY-07** DNS cutover: switch apex `soundclash.org` from CloudFront to Cloudflare Pages
- [ ] **DEPLOY-08** Monitor 24h: error rates on Render, Supabase logs, Sentry, browser console reports from real game sessions
- [ ] **DEPLOY-09** AWS teardown — execute `docs/aws-teardown-checklist.md`:
  - [ ] `cdk destroy` on `infrastructure-ondemand/` in `Sound-Clash-legacy`
  - [ ] `cdk destroy` on `infrastructure/` if anything still up
  - [ ] empty + delete S3 buckets `ondemand-frontend-*`, `soundclash-songs-data`
  - [ ] delete ECR repos `ondemand/game-management`, `ondemand/song-management`, `ondemand/websocket-service`
  - [ ] disable + delete CloudFront distribution `E2NIDUY011R5N4`
  - [ ] delete ACM cert
  - [ ] delete CloudWatch log groups
  - [ ] confirm in AWS Cost Explorer: $0 forecast for next month
- [ ] **DEPLOY-10** `Sound-Clash-legacy`: confirm `LEGACY.md` is in place
- [ ] **DEPLOY-11** Add monitoring: Render health alert email; Supabase email alerts; Sentry alerts (per `runbook.md` §4 thresholds)
- [ ] **DEPLOY-12** Run capacity-planning worksheet (`free-tier-budget.md` §9) for the first scheduled tournament

## Documentation

- [ ] **DOC-01** `README.md` — what the project is, quick start, links to runbook + architecture
- [ ] **DOC-02** `docs/architecture.md` — copy from `Sound-Clash-Plan/architecture.md`
- [ ] **DOC-03** `docs/realtime-design.md` — copy from plan
- [ ] **DOC-04** `docs/data-model.md`, `docs/rpc-functions.md`, `docs/security-rls.md`, `docs/api-contracts.md`, `docs/game-rules.md`, `docs/tech-stack.md`, `docs/free-tier-budget.md`, `docs/local-development.md`, `docs/runbook.md` — copy from plan
- [ ] **DOC-05** `docs/aws-teardown-checklist.md` — explicit, dated checklist for the cutover
- [ ] **DOC-06** Architecture diagram as PNG/SVG in `docs/diagrams/` (Excalidraw or Mermaid)
- [ ] **DOC-07** `CONTRIBUTING.md` — coding style, PR template, test requirements
- [ ] **DOC-08** PR template `.github/pull_request_template.md` — sections: what changed, why, test plan, doc updates

---

## Quick Reference: Files Created vs Deleted (vs `Sound-Clash-legacy`)

**Deleted entirely** (no analog in new repo):
- `backend/websocket-service/`
- `frontend/src/services/websocket/`
- `infrastructure/`, `infrastructure-ondemand/`
- `scripts/ondemand/`

**Carried over (with adaptation)**:
- Game-management REST endpoints → `backend/app/routers/games.py`
- Song-management REST endpoints → `backend/app/routers/admin_songs.py` + `genres.py`
- React pages (`TeamGameplay`, `ManagerConsole`, `DisplayScreen`) — refactored for Supabase Realtime
- `AuthContext.tsx` admin password pattern
- YouTube IFrame Player component
- Song data (migrated via Phase 2 scripts)

**New** (no analog in legacy):
- `db/migrations/` — Postgres-as-code (RPC functions are the new heart of the system)
- `db/seed/` — static seed data
- `tests/db/`, `tests/e2e/`, `tests/smoke/` — comprehensive test suite (none in legacy)
- `.github/workflows/` — actual CI/CD (none in legacy)
- `_headers` (CSP) on frontend
- `slowapi` rate limits on FastAPI
- Sentry instrumentation
