# Sound Clash — Migration Roadmap

Eight phases (Phase 0 + seven core) from naming/account setup to production cutover. Each phase has a goal, deliverables, exit criteria, dependencies, estimated time, and known risks.

The estimates assume one developer working part-time. They are loose.

The new code lives in **`Sound-Clash`** (GitHub). The current AWS-based code is renamed to **`Sound-Clash-legacy`** (kept read-only for reference).

---

## Phase 0 — Naming & Repo Hygiene

**Goal**: Free up the name `Sound-Clash` for the new codebase by renaming the existing repo to `Sound-Clash-legacy`.

**Deliverables**
- GitHub: rename `BenArtzi4/Sound-Clash` → `BenArtzi4/Sound-Clash-legacy` (Settings → General → Repository name).
- Update local clone's remote URL: `git remote set-url origin https://github.com/BenArtzi4/Sound-Clash-legacy.git`
- Add a `LEGACY.md` to the renamed repo's root: "this is the AWS-based version of Sound Clash. Active development continues at https://github.com/BenArtzi4/Sound-Clash."

**Exit criteria**
- Old URL `github.com/BenArtzi4/Sound-Clash` redirects to `Sound-Clash-legacy` (GitHub does this automatically).
- Local `git pull` works on the renamed remote.

**Dependencies**: none

**Estimated time**: 15 minutes

**Risks**: Anyone with a hardcoded old-URL clone needs to update their remote. Low blast radius for a solo project.

---

## Phase 1 — Infrastructure Setup

**Goal**: Provision the free-tier accounts and skeleton the new repo. No code yet.

**Deliverables**
- New GitHub repo: **`Sound-Clash`** (public to get unlimited Actions minutes)
- Skeleton repo layout:
  - `backend/` — FastAPI app placeholder
  - `frontend/` — React + Vite placeholder
  - `db/migrations/` — empty
  - `tests/` — empty
  - `.github/workflows/` — empty
  - `docs/` — copies of relevant planning docs from `Sound-Clash-Plan/`
  - `README.md`, `.gitignore`, `.env.example`
- Supabase project `Sound-Clash` created (region: matching primary user geography — see `tech-stack.md` §3)
- Render web service created with `Dockerfile` autodetect
- Cloudflare Pages project created, linked to GitHub repo
- DNS records (Cloudflare): `soundclash.org` → Pages; `api.soundclash.org` CNAME → Render
- GitHub repo secrets configured (full list in `local-development.md` §4 and `runbook.md` §3)
- cron-job.org keepalive pinging `https://api.soundclash.org/health` every 14 min (see `tech-stack.md` §8)

**Exit criteria**
- Pushing an empty commit to `main` triggers a green CI run (workflow shell only)
- `https://soundclash.org` resolves and serves a Pages placeholder page
- `https://api.soundclash.org/health` returns 200 from Render

**Dependencies**: Phase 0

**Estimated time**: 1 day

**Risks**: DNS propagation delay; Render service link to GitHub may need a manual redeploy after secret changes

---

## Phase 2 — Data Migration

**Goal**: Move the song catalog from the existing AWS RDS / S3 CSV (in `Sound-Clash-legacy`) into Supabase Postgres.

**Deliverables**
- `scripts/export-songs.py` — re-uses the existing export logic from `Sound-Clash-legacy/scripts/`; outputs `songs.json` and `genres.json`
- `scripts/import-songs.py` — reads the JSON, inserts into Supabase via `supabase-py` using the service-role key
- `db/seed/genres.sql` — manual seed of canonical genres (rock, pop, hiphop, classical, soundtrack, ...)
- `docs/data-migration.md` describing how to re-run the import

**Exit criteria**
- All songs from the legacy system exist in Supabase `songs` table with correct `youtube_id`, `start_time`, and genre links
- `SELECT count(*) FROM songs` matches the source-of-truth count
- Spot-check: 5 random songs play correctly via `https://www.youtube.com/watch?v=<youtube_id>&t=<start_time>`

**Dependencies**: Phase 1 (Supabase project must exist)

**Estimated time**: 1 day

**Risks**: schema mismatch (the legacy system stores `is_soundtrack` differently per service — reconcile during export); duplicate songs in source data

---

## Phase 3 — Postgres Logic

**Goal**: Land the schema, RPC functions, RLS, and pg_cron job. **The buzzer race correctness is proven here, before any frontend.**

**Deliverables**
- `db/migrations/001_extensions.sql` … `008_seed_genres.sql` — see **`data-model.md`** §7 for the full ordering, **`rpc-functions.md`** for the function bodies, **`security-rls.md`** for the RLS policies
- `tests/db/test_buzz_in_race.py` — pytest using `testcontainers-postgres` that fires 10 concurrent `buzz_in` calls; asserts exactly one returns `locked=true`
- `tests/db/test_rls_policies.py` — connects as `anon` role; verifies allowed/denied operations
- `tests/db/test_cron_cleanup.py` — manually invokes `cleanup_expired_games()`; asserts deletion + cascade
- `db/migrate.sh` — applies migrations in order via `psql` (used by GitHub Actions and locally)

**Exit criteria**
- Buzz race test passes 100 times consecutively
- RLS test confirms anon can SELECT but cannot mutate
- pg_cron job is registered and visible in `cron.job` table

**Dependencies**: Phase 1 (Supabase) — does not need Phase 2

**Estimated time**: 2 days

**Risks**: pg_cron behavior on Supabase free tier (verify it actually fires); RLS gotchas with `SECURITY DEFINER` functions

---

## Phase 4 — Backend Port

**Goal**: Single FastAPI app on Render replaces the three-service legacy backend. **WebSocket service is deleted entirely** — Supabase Realtime is the replacement.

**Deliverables**
- `backend/app/main.py` — FastAPI app entry, mounts routers, configures CORS for `soundclash.org`
- `backend/app/middleware/admin_auth.py` — header check `X-Admin-Password` vs env var, constant-time comparison
- `backend/app/routers/games.py` — see **`api-contracts.md`** §2 for the endpoint contract
- `backend/app/routers/admin_songs.py` — admin-gated CRUD + bulk CSV import
- `backend/app/routers/genres.py` — public GET endpoints
- `backend/app/db/supabase_client.py` — thin wrapper around `supabase-py`, holds service-role key
- `backend/Dockerfile` — multi-stage, non-root user, `uvicorn` entrypoint
- `backend/pyproject.toml` — `fastapi`, `uvicorn`, `supabase`, `pytest`, `httpx`, `ruff`, `mypy`
- `.github/workflows/backend.yml` — runs ruff, mypy, pytest; on main triggers Render deploy hook

**Exit criteria**
- `pytest` passes against testcontainers Postgres
- `curl POST https://api.soundclash.org/games` (with admin header) returns a new game code
- Admin-gated endpoints return 401 without the password header
- WebSocket-related code is **not** present (`grep -r websocket backend/` empty)

**Dependencies**: Phase 3

**Estimated time**: 3 days

**Risks**: Render Docker build time + free-tier resource limits; `supabase-py` quirks with service-role auth

---

## Phase 5 — Realtime Wiring & Frontend Port ✅ shipped

**Goal**: React frontend works against Supabase Realtime + the new FastAPI backend. The buzzer makes a direct PostgREST RPC call from the browser.

**Deliverables**
- `frontend/src/lib/supabase.ts` — `createClient(SUPABASE_URL, SUPABASE_ANON_KEY)`, exported singleton
- `frontend/src/hooks/useGameChannel.ts` — subscribes to `active_games`, `game_teams`, `game_rounds` for a `game_code`; reducer pattern (see **`realtime-design.md`** §5)
- `frontend/src/hooks/useBuzzer.ts` — calls `supabase.rpc('buzz_in', ...)`; exposes `{ buzz, isLocking, lockedTeam, lockedAt }`
- Refactored pages: `TeamGameplay.tsx`, `ManagerConsole.tsx`, `DisplayScreen.tsx` — all use the new hooks
- **Deleted**: `frontend/src/services/websocket/` from legacy code
- `frontend/src/context/AuthContext.tsx` — kept (admin-password gate UX preserved)
- `frontend/src/components/YouTubePlayer.tsx` — kept; gated by `playerReady` (see **`realtime-design.md`** §9)
- `frontend/.env.example` — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`
- `frontend/vitest.config.ts` + component tests with mocked Supabase client
- `_headers` file with CSP (see **`security-rls.md`** §7)
- `.github/workflows/frontend.yml` — `npm ci`, `vitest run`, `npm run build`, `wrangler pages deploy` on main

**Exit criteria**
- Local dev: 3 browser tabs (manager + 2 teams + display) play a full game end-to-end
- Buzzer race in browser: both teams click within ~50ms; exactly one wins; UI agrees across all 4 contexts
- Admin login works with env-var password

**Dependencies**: Phase 4

**Estimated time**: 5 days

**Risks**: Realtime subscription lifecycle bugs; React strict-mode double-effect; YouTube IFrame Player race with Realtime "round start" events

---

## Phase 6 — End-to-End Testing

**Goal**: Automated proof that the full system works under realistic concurrency, on a real Supabase project, with measured latency.

**Status**: cores landed (`buzzer_race.spec.ts`, `full_game.spec.ts`, Playwright config with local `webServer`, `db/seed/songs.sql`, `data-testid` hooks on the manager console). Remaining specs (`reconnection`, `expiration`, `admin_login`, `admin_songs_crud`, `kick_team`, `mobile_team`) and the multi-browser matrix are follow-up PRs. Creating the `Sound-Clash-Preview` Supabase project + setting GitHub secrets is an out-of-band setup step (see `tests/e2e/README.md`).

**Deliverables**
- `tests/e2e/playwright.config.ts` — multi-context test runner
- `tests/e2e/buzzer_race.spec.ts` — 4 browser contexts (manager, team1, team2, display); race the buzz; assertions per **`realtime-design.md`** §3
- `tests/e2e/full_game.spec.ts` — happy-path 3-round game end-to-end
- `tests/e2e/admin_flows.spec.ts` — admin login + song CRUD via UI
- `.github/workflows/e2e.yml` — runs Playwright against a dedicated `Sound-Clash-Preview` Supabase project; gates merges to main
- A separate `Sound-Clash-Preview` Supabase project for E2E isolation

**Exit criteria**
- Buzzer race test: 100 consecutive runs, 0 failures, p95 latency < 200ms when run from a region close to the Supabase project
- Full-game test passes
- All workflows green on main

**Dependencies**: Phase 5

**Estimated time**: 3 days

**Risks**: Playwright timing flakiness; CI runners far from Supabase region inflate measured latency

---

## Phase 7 — Deploy & Cutover

**Goal**: `soundclash.org` traffic moves from the AWS stack (in `Sound-Clash-legacy`) to the new system; AWS resources are torn down; bill goes to $0.

**Deliverables**
- `docs/runbook.md` — copied from `Sound-Clash-Plan/runbook.md`; ops procedures
- `docs/aws-teardown-checklist.md` — explicit steps:
  - `cdk destroy` on `infrastructure-ondemand/` (in `Sound-Clash-legacy`)
  - `cdk destroy` on `infrastructure/` if anything still up
  - empty + delete S3 buckets: `ondemand-frontend-…`, `soundclash-songs-data` (only after Supabase has the songs)
  - delete ECR repos: `ondemand/game-management`, `ondemand/song-management`, `ondemand/websocket-service`
  - disable + delete CloudFront distribution `E2NIDUY011R5N4` (~15 min)
  - delete ACM cert
  - delete CloudWatch log groups
- DNS cutover: change apex `soundclash.org` from CloudFront to Cloudflare Pages
- Smoke test: `tests/smoke/post_deploy.sh` — curl health endpoints, confirm a synthetic game can be created and a round can run

**Exit criteria — Definition of Done**
- [ ] `https://soundclash.org` serves the new frontend
- [ ] `https://api.soundclash.org/health` returns 200
- [ ] A real end-to-end game playable from a clean browser session
- [ ] Smoke-test script passes
- [ ] AWS Cost Explorer shows $0 forecasted for next month
- [ ] All AWS resources from the teardown checklist are confirmed deleted
- [ ] `Sound-Clash-legacy` README updated with `LEGACY.md` pointing at `Sound-Clash`
- [ ] `Sound-Clash` README has setup, dev, deploy, runbook links
- [ ] Monitoring active: Render health alerts + Supabase email alerts + Sentry
- [ ] Rollback plan documented (DNS revert to CloudFront within 24h)

**Dependencies**: Phase 6

**Estimated time**: 1–2 days (plus 24h post-cutover watch period)

**Risks**: DNS propagation; undocumented dependency on the legacy AWS stack; CloudFront teardown takes ~15min

---

## Total

~17–19 working days end to end, parallelizable: Phase 2 can overlap with Phase 3; Phase 5 frontend work can start once Phase 4 API contracts are stable.

## Companion Documents

| Doc | Used in phase(s) |
|---|---|
| `architecture.md` | All — read first |
| `realtime-design.md` | 3, 5, 6 — central design reference |
| `tech-stack.md` | 1 — provisioning checklist |
| `data-model.md` | 2, 3 — schema source of truth |
| `rpc-functions.md` | 3 — function spec |
| `security-rls.md` | 3, 4, 5 — RLS + auth |
| `api-contracts.md` | 4, 5 — frontend/backend pact |
| `game-rules.md` | 4, 5 — gameplay flow |
| `local-development.md` | All — dev setup |
| `free-tier-budget.md` | 1, 6, 7 — capacity + alerts |
| `runbook.md` | 7 onward — ops |
| `tasks.md` | All — granular tasks |

## Out of Scope (NOT in roadmap)

- Multi-tenant (per-host accounts) — future work; data model leaves room
- Game history / leaderboards — ephemeral by user choice
- Direct audio uploads — YouTube-only by design
- Mobile app — web-only
- Internationalization — single language for now
- Frontend state-machine library / Redux — local React state is enough at this scope
