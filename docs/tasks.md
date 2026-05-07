# Sound Clash — Task List

Granular, checkboxed tasks grouped by area. Tasks within an area are roughly ordered, but cross-area parallelism is fine where dependencies allow. Each task should be small enough to ship as one PR.

The new repo is **`Sound-Clash`** (GitHub). The legacy AWS-based repo is **`Sound-Clash-legacy`**.

> **Status note (2026-05-07):** Phases 0 → 7 are shipped (production cutover complete; see `roadmap.md`). The boxes below have been reconciled against the live code; `[x]` means "in `main` and live at `https://soundclash.org`". The only remaining `[ ]` is **DOC-06** (architecture diagram). Post-launch work tracked separately under "Scoring revamp (post-Phase 7)".

## Phase 0 — Naming

- [x] **NAME-01** Rename GitHub repo `BenArtzi4/Sound-Clash` → `BenArtzi4/Sound-Clash-legacy` (Settings → General → Repository name). GitHub auto-redirects the old URL.
- [x] **NAME-02** Update local clone's remote: `git remote set-url origin https://github.com/BenArtzi4/Sound-Clash-legacy.git`
- [x] **NAME-03** Add `LEGACY.md` at the root of the renamed repo: "AWS-based Sound Clash. Active development at https://github.com/BenArtzi4/Sound-Clash."

## Infrastructure

- [x] **INFRA-01** Create new GitHub repo **`Sound-Clash`** (public, MIT license)
- [x] **INFRA-02** Add baseline files: `.gitignore`, `.env.example`, `README.md`, `LICENSE`, `CODEOWNERS`
- [x] **INFRA-03** Skeleton directory layout: `backend/`, `frontend/`, `db/migrations/`, `db/seed/`, `tests/`, `scripts/`, `docs/`, `.github/workflows/`
- [x] **INFRA-04** Copy planning docs from `Sound-Clash-Plan/` into new repo's `docs/` (architecture, realtime-design, data-model, rpc-functions, security-rls, api-contracts, game-rules, tech-stack, runbook, free-tier-budget, local-development)
- [x] **INFRA-05** Create Supabase project `Sound-Clash` (region: closest to primary users — see `tech-stack.md` §3); record project URL + anon key + service-role key
- [x] **INFRA-06** Enable Postgres extensions in Supabase: `pg_cron`, `pgcrypto`
- [x] **INFRA-07** Create dedicated `Sound-Clash-Preview` Supabase project for E2E (see `local-development.md` §12)
- [x] **INFRA-08** Create Render web service, link to GitHub repo, autodetect Dockerfile in `backend/`
- [x] **INFRA-09** Create Cloudflare Pages project, link to GitHub repo; build command `npm run build`, output `frontend/dist`
- [x] **INFRA-10** Add DNS records in Cloudflare: apex `soundclash.org` → Pages; `api.soundclash.org` CNAME → Render
- [x] **INFRA-11** Add GitHub repo secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PREVIEW_URL`, `SUPABASE_PREVIEW_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `RENDER_DEPLOY_HOOK`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `SENTRY_DSN_FRONTEND`, `SENTRY_DSN_BACKEND`
- [x] **INFRA-12** Add Render env vars: same secrets minus CF_*; plus `LOG_LEVEL`, `CORS_ORIGINS`
- [x] **INFRA-13** Add Cloudflare Pages env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_SENTRY_DSN`
- [x] **INFRA-14** cron-job.org: register, add a job pinging `https://api.soundclash.org/health` every 14 min
- [x] **INFRA-15** Sentry: create project `sound-clash`; record DSNs (frontend + backend separately)
- [x] **INFRA-16** Configure Supabase email alerts: free-tier dashboards → set thresholds per `free-tier-budget.md` §4

## Auth & Security

- [x] **AUTH-01** Implement `backend/app/middleware/admin_auth.py`: header check `X-Admin-Password` vs env var, **constant-time comparison** (`secrets.compare_digest`)
- [x] **AUTH-02** Auth gates in their final, post-open-hosting shape (reshape landed 2026-05-06, `migrations/012_manager_token.sql`):
  - `require_admin` (`X-Admin-Password`) gates **only** `/admin/songs/*` (the durable song catalog).
  - `require_manager_token` (`X-Manager-Token`, per-game uuid stored on `active_games`) gates the host-only game endpoints: `POST /games/{code}/select-song`, `award-points`, `bonus`, `end`, and `DELETE /games/{code}/teams/{team_id}`.
  - `POST /games` is **open hosting** (no auth) and returns the per-game `manager_token` in the response body.
- [x] **AUTH-03** Frontend: `lib/adminPassword.ts` holds the admin password in localStorage for `/admin/songs`; `lib/managerToken.ts` mirrors it per-game (`game:<code>:manager-token`) for the host. Both are sent as headers via `lib/api.ts`. The legacy `AuthContext` / `RequireAuth` were removed when the manager password gate was retired.
- [x] **AUTH-04** RLS policies SQL — see `security-rls.md` §2
- [x] **AUTH-05** Function grants: `GRANT EXECUTE ON FUNCTION buzz_in TO anon`; revoke all others from PUBLIC
- [x] **AUTH-06** CSP `_headers` file in frontend — see `security-rls.md` §7 (`frontend/public/_headers`)
- [x] **AUTH-07** Backend security headers (HSTS, X-Content-Type-Options) via FastAPI middleware (`backend/app/middleware/cors.py::_security_headers`)
- [x] **AUTH-08** Verify in CI: no `SUPABASE_SERVICE_ROLE_*` env vars are exposed to the frontend bundle. Check enforced in `.github/workflows/frontend.yml` (greps `dist/` for `SUPABASE_SERVICE_ROLE`, fails build if found).
- [x] **AUTH-09** Pre-commit hook scanning for committed JWT-shaped strings (catches accidental key leaks) — `no-jwt-leak` hook in `.pre-commit-config.yaml`
- [x] **AUTH-10** Rate limit config in FastAPI via `slowapi` — see `security-rls.md` §6 for limits (`backend/app/middleware/rate_limit.py`)
- [x] **AUTH-11** Document secret rotation procedure (covered in `runbook.md` §3)

## Database — Postgres

- [x] **DB-01** `db/migrations/001_extensions.sql` — `CREATE EXTENSION IF NOT EXISTS pg_cron, pgcrypto`
- [x] **DB-02** `db/migrations/002_durable_tables.sql` — `songs`, `genres`, `song_genres` (per `data-model.md` §2)
- [x] **DB-03** `db/migrations/003_ephemeral_tables.sql` — `active_games`, `game_teams`, `game_rounds`, deferred FKs
- [x] **DB-04** `db/migrations/004_indexes.sql` — per `data-model.md` §3
- [x] **DB-05** `db/migrations/005_rpc_functions.sql` — `buzz_in`, `start_round`, `award_points`, `end_game`, `cleanup_expired_games` (full bodies in `rpc-functions.md`). Reshaped + extended in `db/migrations/014_scoring_revamp.sql` (wrong-buzz penalty replaces source/timeout; new `award_bonus`).
- [x] **DB-06** `db/migrations/006_rls_policies.sql` — enable RLS, anon SELECT policies, function grants
- [x] **DB-07** `db/migrations/007_cron_jobs.sql` — `cron.schedule('cleanup-expired-games', '0 * * * *', ...)`
- [x] **DB-08** `db/migrations/008_seed_genres.sql` — initial genre list (rock, pop, hip-hop, classical, soundtrack, jazz, electronic, country, R&B, metal); seeded via migration per `data-model.md` §7
- [x] **DB-09** `db/migrate.sh` — applies migrations in order via `psql`
- [x] **DB-10** `.github/workflows/db-migrate.yml` — manual-dispatch workflow that applies migrations to chosen environment

## Backend — Python (FastAPI)

- [x] **PY-01** `backend/pyproject.toml` with deps: `fastapi`, `uvicorn[standard]`, `supabase`, `pydantic`, `python-multipart` (for CSV upload), `slowapi`, `sentry-sdk[fastapi]`; dev: `pytest`, `pytest-asyncio`, `httpx`, `testcontainers[postgres]`, `ruff`, `mypy`
- [x] **PY-02** `backend/Dockerfile` — multi-stage, non-root user, uvicorn entry on `$PORT`
- [x] **PY-03** `backend/app/main.py` — FastAPI app, CORS for `soundclash.org`, mounts routers, `/health` endpoint, Sentry init, slowapi init
- [x] **PY-04** `backend/app/db/supabase_client.py` — singleton client using service-role key
- [x] **PY-05** `backend/app/routers/games.py` per `api-contracts.md` §2:
  - `POST /games` (open hosting; returns `manager_token`)
  - `POST /games/{code}/teams`
  - `POST /games/{code}/select-song` (manager-token gated; calls `start_round` RPC)
  - `POST /games/{code}/award-points` (manager-token gated; calls `award_points` RPC)
  - `POST /games/{code}/bonus` (manager-token gated; calls `award_bonus` RPC) — added in scoring revamp
  - `POST /games/{code}/end` (manager-token gated; calls `end_game` RPC)
  - `DELETE /games/{code}/teams/{team_id}` (manager-token gated)
- [x] **PY-06** `backend/app/routers/admin_songs.py` — admin-gated GET/POST/PUT/DELETE; bulk CSV import endpoint with idempotency on `youtube_id`
- [x] **PY-07** `backend/app/routers/genres.py` — public GET `/genres`
- [x] **PY-08** `backend/app/services/codes.py` — generator: 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`; collision retry
- [x] **PY-09** `backend/app/services/song_picker.py` — random song with `selected_genres` filter and "no repeats per game" enforcement
- [x] **PY-10** Pydantic request/response models in `backend/app/models/` matching `api-contracts.md`
- [x] **PY-11** Validation: YouTube ID regex `^[A-Za-z0-9_-]{11}$`; team name 1–30 chars
- [x] **PY-12** Error handler middleware mapping Postgres P0001/P0002 → HTTP 4xx codes (`backend/app/middleware/error_handler.py`)
- [x] **PY-13** Confirm zero WebSocket code: `grep -ri 'websocket\|socket.io' backend/` returns nothing

## Realtime / Frontend

- [x] **FE-01** `frontend/package.json` — React 18, TypeScript 5, Vite 5, `@supabase/supabase-js`, `react-router-dom`, `vitest`, `@testing-library/react`, `@sentry/react`
- [x] **FE-02** `frontend/.env.example` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, `VITE_SENTRY_DSN`
- [x] **FE-03** `frontend/src/lib/supabase.ts` — exported singleton client
- [x] **FE-04** `frontend/src/lib/api.ts` — typed REST client for FastAPI; sends `X-Admin-Password` from session for admin calls and `X-Manager-Token` per-game for host calls
- [x] **FE-05** `frontend/src/hooks/useGameChannel.ts` — Realtime subscription with reducer pattern (per `realtime-design.md` §5–6); subscribes then fetches initial state
- [x] **FE-06** `frontend/src/hooks/useBuzzer.ts` — `supabase.rpc('buzz_in', ...)`; exposes `{ buzz, isLocking, lockedTeam, lockedAt }`; Sentry transaction wrap
- [x] **FE-07** `frontend/src/hooks/useServerTime.ts` — measures server-client clock offset on first event; exposes `serverTimeNow()` (per `realtime-design.md` §8)
- [x] **FE-08** `frontend/src/hooks/usePlayerReady.ts` — gates round-active UI behind YouTube IFrame player readiness (per `realtime-design.md` §9)
- [x] **FE-09** Refactor `TeamGameplay.tsx`: use `useGameChannel` + `useBuzzer`; persist team identity in `localStorage` (per `game-rules.md` §7)
- [x] **FE-10** Refactor `ManagerConsole.tsx`: live state from `useGameChannel`; control actions call FastAPI; YouTube IFrame Player retained; player-ready gate
- [x] **FE-11** Refactor `DisplayScreen.tsx`: live state from `useGameChannel`; YouTube IFrame Player retained; large-screen styling
- [x] **FE-12** Decision + impl: team page omits YouTube embed (recommended; per `game-rules.md` §12)
- [x] **FE-13** Delete legacy WebSocket code: `frontend/src/services/websocket/` and any `socket.io` references
- [x] **FE-14** Reconnection banner: while `channel` not subscribed, show "reconnecting…" non-blocking banner; disable buzz button
- [x] **FE-15** Game-expired handler: detect Realtime DELETE on `active_games`; redirect to "game expired" screen
- [x] **FE-16** Kicked-team handler: detect Realtime DELETE on own `game_teams` row; redirect to join screen
- [x] **FE-17** ~~Keep `AuthContext.tsx` admin password gate; verify `ProtectedRoute` still works~~ — superseded 2026-05-06: `AuthContext` and `RequireAuth` were removed when the manager password gate was retired in favour of per-game tokens. Admin password is now stored only via `lib/adminPassword.ts` for the `/admin/songs` page.
- [x] **FE-18** Routes: `/`, `/manager/create`, `/manager/game/:code`, `/team/join`, `/team/:code`, `/display/join`, `/display/:code`, `/admin/songs` (the legacy `/manager/login` and `/manager/lobby/:code` routes were removed in the open-hosting reshape)
- [x] **FE-19** `_headers` file with CSP (per `security-rls.md` §7)
- [x] **FE-20** Sentry init in `main.tsx` with `beforeSend` scrubbing team names
- [x] **FE-21** Confirm zero legacy WebSocket client code: `grep -ri 'WebSocket\|socket.io' frontend/src/` returns nothing app-level

## Testing

- [x] **TEST-01** `tests/db/test_buzz_in_race.py` — testcontainers Postgres + 10 concurrent `buzz_in` calls; exactly one wins; **must pass 100 consecutive runs** (Phase 3 exit criterion)
- [x] **TEST-02** `tests/db/test_buzz_in_edge_cases.py` — buzz when game waiting; buzz when game ended; buzz with bad UUID; lock-already-held returns false
- [x] **TEST-03** `tests/db/test_rls_policies.py` — split into `test_rls_anon.py` (table SELECT/INSERT/UPDATE/DELETE matrix) and `test_rls_function_grants.py` (RPC EXECUTE matrix)
- [x] **TEST-04** `tests/db/test_cron_cleanup.py` — implemented as `test_cleanup_expired_games.py`; insert game with past `expires_at`; manually invoke `cleanup_expired_games()`; assert deletion + cascade
- [x] **TEST-05** `tests/db/test_award_points_idempotency.py` — covered by `test_award_points.py::test_award_points_idempotency_raises_on_second_call`; second call raises `round_already_ended`
- [x] **TEST-06** `tests/backend/test_games_*.py` — split per endpoint (`create`, `join`, `select_song`, `award_points`, `bonus`, `end`, `kick_team`) covering the full happy path and error branches
- [x] **TEST-07** `tests/backend/test_admin_auth.py` — 401 without header; 200 with correct; 401 with wrong; constant-time comparison. Also `test_manager_token.py` for the per-game host gate.
- [x] **TEST-08** `tests/backend/test_rate_limits.py` — exceed `POST /games` rate limit; assert 429
- [x] **TEST-09** `tests/backend/test_admin_songs_crud.py` + `test_admin_songs_bulk_import.py` — full CRUD + bulk import idempotency
- [x] **TEST-10** `tests/backend/test_validation.py` — bad YouTube IDs, oversized team names, empty genres list
- [x] **TEST-11** `frontend/src/hooks/useBuzzer.test.ts` — vitest with mocked Supabase client
- [x] **TEST-12** `frontend/src/hooks/useGameChannel.test.ts` — vitest; subscribe → event applied → state updated
- [x] **TEST-13** `frontend/src/components/*.test.tsx` + `frontend/src/pages/*.test.tsx` — covers BuzzButton, ConfirmDialog, EndScreen, Scoreboard, YouTubePlayer plus all six pages
- [x] **TEST-14** `tests/e2e/playwright.config.ts` — multi-context base, runs against preview Supabase
- [x] **TEST-15** `tests/e2e/buzzer_race.spec.ts` — 4 contexts (manager, team1, team2, display); race the buzz; deterministic outcome and < 200ms p95 latency
- [x] **TEST-16** `tests/e2e/full_game.spec.ts` — 3-round happy path
- [x] **TEST-17** `tests/e2e/reconnection.spec.ts` — team disconnects mid-game; rejoin; state correct
- [x] **TEST-18** `tests/e2e/admin_songs_crud.spec.ts` — song CRUD via admin API (the original admin-login spec was retired with the manager password gate; the `/admin/songs` UI is a deferred Phase 5 carve-out, the backend contract is exercised end-to-end)
- [x] **TEST-19** `tests/e2e/expiration.spec.ts` — game with `expires_at` set to 1 sec in past; trigger cron manually; verify all clients redirect
- [x] **TEST-20** Coverage: `pytest --cov=app` (backend), `vitest --coverage` (frontend); upload to Codecov free tier — wired in `backend.yml` + `frontend.yml`

## CI/CD

- [x] **CI-01** `.github/workflows/backend.yml` — on PR + main: `ruff check`, `ruff format --check`, `mypy`, `pytest`; on main only: trigger `RENDER_DEPLOY_HOOK`
- [x] **CI-02** `.github/workflows/frontend.yml` — on PR + main: `npm ci`, `tsc --noEmit`, `eslint`, `vitest run`, `npm run build`; on main only: `wrangler pages deploy`
- [x] **CI-03** `.github/workflows/e2e.yml` — on PR (label `run-e2e`) + main: Playwright against `Sound-Clash-Preview` Supabase project
- [x] **CI-04** `.github/workflows/db-migrate.yml` — manual dispatch; runs migrations against chosen environment (preview / prod)
- [x] **CI-05** Branch protection on `main`: require backend + frontend workflows green; require 1 review (or admin override for solo work)
- [x] **CI-06** Dependabot config for `pip` and `npm` (`.github/dependabot.yml`)
- [x] **CI-07** Add Codecov badges to README
- [x] **CI-08** Pre-commit hook: ruff + prettier (frontend); on each commit (`.pre-commit-config.yaml`)
- [x] **CI-09** Verification step in `frontend.yml`: build artifact must not contain `service_role` (catches accidental leak)

## Deployment / Cutover

- [x] **DEPLOY-01** First production deploy of backend to Render; verify `/health` 200
- [x] **DEPLOY-02** First production deploy of frontend to Cloudflare Pages; verify static load
- [x] **DEPLOY-03** Run `db-migrate` workflow against prod Supabase; verify schema and seed
- [x] **DEPLOY-04** Run data import (Phase 2 scripts) against prod; verify song count
- [x] **DEPLOY-05** Manual smoke test: create game → 2 teams join → 3 rounds → end → verify scoreboard → wait for cron sweep → verify game row deleted
- [x] **DEPLOY-06** `tests/smoke/post_deploy.sh` — automated smoke test for use after every deploy
- [x] **DEPLOY-07** DNS cutover: switch apex `soundclash.org` from CloudFront to Cloudflare Pages
- [x] **DEPLOY-08** Monitor 24h: error rates on Render, Supabase logs, Sentry, browser console reports from real game sessions
- [x] **DEPLOY-09** AWS teardown — execute `docs/aws-teardown-checklist.md`:
  - [x] `cdk destroy` on `infrastructure-ondemand/` in `Sound-Clash-legacy`
  - [x] `cdk destroy` on `infrastructure/` if anything still up
  - [x] empty + delete S3 buckets `ondemand-frontend-*`, `soundclash-songs-data`
  - [x] delete ECR repos `ondemand/game-management`, `ondemand/song-management`, `ondemand/websocket-service`
  - [x] disable + delete CloudFront distribution `E2NIDUY011R5N4`
  - [x] delete ACM cert
  - [x] delete CloudWatch log groups
  - [x] confirm in AWS Cost Explorer: $0 forecast for next month
- [x] **DEPLOY-10** `Sound-Clash-legacy`: confirm `LEGACY.md` is in place
- [x] **DEPLOY-11** Add monitoring: Render health alert email; Supabase email alerts; Sentry alerts (per `runbook.md` §4 thresholds)
- [x] **DEPLOY-12** Run capacity-planning worksheet (`free-tier-budget.md` §9) for the first scheduled tournament

## Documentation

- [x] **DOC-01** `README.md` — what the project is, quick start, links to runbook + architecture (pivoted to a player-facing pitch on 2026-05-07; PR #41)
- [x] **DOC-02** `docs/architecture.md` — copy from `Sound-Clash-Plan/architecture.md`
- [x] **DOC-03** `docs/realtime-design.md` — copy from plan
- [x] **DOC-04** `docs/data-model.md`, `docs/rpc-functions.md`, `docs/security-rls.md`, `docs/api-contracts.md`, `docs/game-rules.md`, `docs/tech-stack.md`, `docs/free-tier-budget.md`, `docs/local-development.md`, `docs/runbook.md` — copy from plan
- [x] **DOC-05** `docs/aws-teardown-checklist.md` — explicit, dated checklist for the cutover
- [ ] **DOC-06** Architecture diagram as PNG/SVG in `docs/diagrams/` (Excalidraw or Mermaid). Still missing — `architecture.md` §2 has the ASCII diagram, but no rendered image.
- [x] **DOC-07** `CONTRIBUTING.md` — coding style, PR template, test requirements
- [x] **DOC-08** PR template `.github/pull_request_template.md` — sections: what changed, why, test plan, doc updates

## Scoring revamp (post-Phase 7)

PR #38 / branch `feature/scoring-revamp`. Fixes the latent free-spam-buzz bug, drops the soundtrack-source mechanic, and adds a host-discretion bonus.

- [x] **SCORE-01** `db/migrations/014_scoring_revamp.sql` — drops `source_points` and `timeout_penalty` columns, adds `wrong_buzz_penalty`, replaces `award_points` (5th param renamed `p_source` → `p_wrong_buzz`; timeout subtraction removed), adds `award_bonus(p_game_code, p_team_id, p_points DEFAULT 4)`. Idempotent. Includes a `DROP FUNCTION IF EXISTS` guard added to `005_rpc_functions.sql` so the param rename survives reruns.
- [x] **SCORE-02** Backend `scoring.py` — constants reshaped to `TITLE_POINTS=10`, `ARTIST_POINTS=5`, `WRONG_BUZZ_PENALTY=3`, `BONUS_POINTS=4`. `to_rpc_points` enforces the title/artist/wrong-buzz/timeout mutex.
- [x] **SCORE-03** Backend models — `AwardPointsRequest.wrong_buzz` replaces `source_correct`; new `AwardBonusRequest`.
- [x] **SCORE-04** Backend router — `POST /games/{code}/bonus` endpoint; `is_soundtrack` lookup removed from `_award_blocking`.
- [x] **SCORE-05** Frontend `ManagerConsolePage` — checkboxes replaced with four toggle buttons (`Correct Song +10` / `Correct Artist +5` / `Wrong -3` / `Bonus +4`); Wrong is mutually exclusive with the positives; "Skip" + "Award points" merged into a single "End round" button; bonus opens an inline team picker.
- [x] **SCORE-06** Frontend lib — `AwardBonusRequest`/`Response` types, `awardBonus()` API wrapper.
- [x] **SCORE-07** Tests — `test_award_points.py` rewritten for new signature; new `test_award_bonus.py`. Backend `test_games_award_points.py` updated; new `test_games_bonus.py`. Frontend `ManagerConsolePage.test.tsx` updated with wrong-buzz + bonus flow tests.
- [x] **SCORE-08** Docs — `api-contracts.md §2.5` rewritten + new §2.6 for bonus; `rpc-functions.md` updated `award_points` + new §3a for `award_bonus`; `game-rules.md §4` rewritten + new §4a; `data-model.md` reflects column changes; `README.md` and `CLAUDE.md` say "six functions".
- [x] **SCORE-09** Migration applied to `Sound-Clash-Preview` Supabase via `supabase db query --linked --file …`. Verified on the live DB: column reshape, function signatures, runtime wrong-buzz `-3`, runtime bonus `+4`, mutex `P0001`, ended-game guard `P0001`, idempotency rerun.
- [x] **SCORE-10** All local gates green: `ruff`, `ruff format`, `mypy`, `tsc`, `eslint`, `vitest run` (22 files / 183 tests).
- [x] **SCORE-11** PR #38 CI green (backend + frontend workflows).
- [x] **SCORE-12** Merge PR #38 to `main` — triggers Render redeploy of new backend. Watch for the redeploy to finish.
- [x] **SCORE-13** Apply `014_scoring_revamp.sql` to **prod** Supabase (`Sound-Clash` Frankfurt, `jvfddxuaqcsrguibkymp`). Verified 2026-05-07 via `pg_get_function_arguments` — `award_bonus` exists and `award_points` carries the new `p_wrong_buzz` arg. Migration is idempotent and was applied during the original PR #38 deploy.
- [x] **SCORE-14** Three-tab manual smoke against prod — substituted by automated smokes: `tests/smoke/post_deploy.sh https://api.soundclash.org` and `tests/e2e/smoke/prod_realtime.spec.ts`. Smoke initially surfaced a separate prod regression in `_award_blocking` (PostgREST list-shape handling); fixed in PR #40.
- [x] **SCORE-15** Re-link CLI back to preview (`supabase link --project-ref vriljyhpxfcwpqwshajv`) so future ad-hoc DB ops don't accidentally hit prod. Done 2026-05-07.

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
- ~~`AuthContext.tsx` admin password pattern~~ — removed in the open-hosting reshape; admin password persistence moved to `lib/adminPassword.ts`
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
- Per-game `manager_token` (uuid stored on `active_games`) replacing the global manager password gate
