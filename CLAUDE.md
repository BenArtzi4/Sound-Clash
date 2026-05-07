# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@.claude/rules/git-workflow.md
@.claude/rules/pull-requests.md
@.claude/rules/commit-messages.md
@.claude/rules/releases.md
@.claude/rules/ci-and-repo-config.md
@.claude/rules/dependencies.md
@.claude/rules/binary-assets.md
@.claude/rules/lessons-learned.md

## Project status

Sound Clash is a real-time multiplayer music-trivia buzzer game. **Phases 3 (Postgres logic), 4 (FastAPI backend), and 5 (React frontend) are complete.** Phase 3 shipped the schema, the original five PL/pgSQL functions (`buzz_in`, `start_round`, `award_points`, `end_game`, `cleanup_expired_games`), RLS policies, and the pg_cron sweeper — all in `db/migrations/`. Migration 014 reshaped scoring: `award_points` now applies a wrong-buzz penalty (mutually exclusive with title/artist), source/timeout penalties are gone, and a sixth function `award_bonus` lets the host grant +4 to any team independent of round state. Phase 4 shipped the FastAPI app under `backend/app/`: routers (`health`, `genres`, `games`, `admin_songs`), the supabase-py service-role client wrapper, slowapi rate limits, the `award_points` boolean→integer translator, and the bulk-CSV importer (idempotent on `youtube_id`). Auth has two flavours: `require_admin` (constant-time `X-Admin-Password` check, gates `/admin/songs/*` only) and `require_manager_token` (per-game uuid stored on the `active_games` row, presented as `X-Manager-Token` to gate `select-song` / `award-points` / `end` / `kick-team`). Phase 5 shipped the React + Vite SPA under `frontend/src/`: anon-key Supabase client (`lib/supabase.ts`), three-table Realtime subscription with idempotent reducer (`hooks/useGameChannel.ts`), browser-direct PostgREST RPC for the buzzer (`hooks/useBuzzer.ts`), `usePlayerReady` / `useServerTime` helpers, the `BuzzButton` / `Scoreboard` / `YouTubePlayer` components, the six pages (Home, JoinTeam, TeamGameplay, ManagerCreateGame, ManagerConsole, Display), the per-game manager-token storage (`lib/managerToken.ts` — localStorage, mirrors the team-storage pattern; the host can refresh freely), the typed REST wrapper in `lib/api.ts`, and the `_headers` CSP + `_redirects` SPA-routing files in `frontend/public/`. The buzz race test (10 concurrent calls → 1 winner, 100×) is the Phase-3 headline gate; the Phase-4 gate is line coverage ≥ 90% on `backend/app/`; the Phase-5 gate is `vitest run --coverage` plus the three-tab manual smoke. Phases are tracked in `docs/roadmap.md`; never assume a feature exists in code just because docs describe it.

## Architecture: the one thing to understand first

The system has a hard requirement of **<200ms buzzer latency on free hosting**. Render's free tier has 2–30s cold starts, so **Python is deliberately not in the buzzer path**. Instead:

- The buzzer is a **Postgres PL/pgSQL function** (`buzz_in`) called directly from the browser via Supabase PostgREST RPC. Postgres performs the atomic conditional UPDATE; Supabase Realtime fans the row change out to all clients over WebSocket.
- **FastAPI on Render** only handles cold-start-tolerant work: game creation, song selection, admin/song CRUD. It uses the Supabase service-role key server-side.
- **Browsers** use the Supabase anon key; **RLS policies** gate what's allowed (anon can SELECT game-scoped rows + EXECUTE `buzz_in`, nothing else). Hosting is open: `POST /games` is unauthenticated and returns a per-game `manager_token` that the host's browser stores in localStorage and presents as `X-Manager-Token` on host-only endpoints. The single env-var admin password (`X-Admin-Password`) gates only the durable song catalog (`/admin/songs/*`). No JWTs, no user accounts.
- **Ephemerality**: `active_games`, `game_teams`, `game_rounds` auto-delete 4 hours after game start via `pg_cron`. `songs`, `genres`, `song_genres` are durable.
- **Audio is YouTube-only** — the catalog stores `youtube_id` + `start_time`; the browser uses the YouTube IFrame Player. No object storage.

Any change that puts Python in the buzzer path, or that adds a state-management library / object storage / user-account system, contradicts the architecture — flag it before implementing. Full reasoning in `docs/realtime-design.md`; component map in `docs/architecture.md`.

## Repo layout

```
backend/         FastAPI app (Python 3.11). Source in app/. Tests live in ../tests/backend.
frontend/        React 18 + TS + Vite SPA.
db/migrations/   Numbered, idempotent SQL files. CI runs them twice to verify idempotency.
db/seed/         One-time seed data (e.g., genres).
tests/db/        pytest + testcontainers-postgres (needs Docker).
tests/backend/   pytest + httpx against FastAPI.
tests/e2e/       Playwright; separate package.json.
tests/smoke/     Post-deploy manual checks.
docs/            The spec. Code that contradicts a doc must update the doc in the same PR.
.github/workflows/  CI. Do not modify without asking (see ci-and-repo-config rule).
```

## Commands

Backend (`cd backend`, venv activated, `pip install -e ".[dev]"` once):
- `uvicorn app.main:app --reload --port 8000` — dev server.
- `ruff check .` / `ruff format .` — lint / format.
- `mypy app` — type-check (strict mode is on).
- `pytest` — runs `tests/backend` and `tests/db` (per `pyproject.toml` `testpaths`).
- `pytest -k <pattern>` — single test/subset. `pytest -m "not slow"` skips slow tests. `pytest -m stress` runs the race-test stress loop.
- `pytest --cov=app --cov-branch --cov-report=term-missing` — coverage. CI bans `# pragma: no cover` in `app/`.

Frontend (`cd frontend`):
- `npm run dev` — Vite dev server on :5173.
- `npm run lint` / `npm run format` / `npm run typecheck`.
- `npm run test` (watch) / `npm run test:run` (single) / `npm run test:coverage`.
- `npm run test:e2e` — runs Playwright from `tests/e2e/` (requires local stack running).
- `npm run build` — runs `tsc -b` then `vite build`.

Database / Supabase (repo root):
- `supabase start` / `supabase stop` / `supabase db reset` — local stack via Docker.
- `./db/migrate.sh local` — apply migrations to running local Supabase. Migrations **must be idempotent** (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS … ; CREATE POLICY …`).

E2E (`cd tests/e2e`, one-time `npm install && npx playwright install`):
- `npm test` — full suite. `npm test -- --ui` interactive. `npm test <spec>` single.

## Conventions enforced by CI

- Backend: `ruff check`, `ruff format --check`, `mypy app`, `pytest --cov-fail-under=<phase threshold>` (currently 0; ratchets up at phase boundaries — see `docs/testing-strategy.md` §5).
- Banned in `app/`: `# pragma: no cover`. Banned in `frontend/src/`: `it.skip` / `test.skip`.
- Frontend: `eslint`, `tsc --noEmit`, `vitest run --coverage`. No state-management libraries (React state + Supabase Realtime only). No CSS-in-JS. `any` requires a `// reason` comment.
- Migrations rerun by CI to verify idempotency. Schema/RPC/RLS changes must update `docs/data-model.md` / `docs/rpc-functions.md` / `docs/security-rls.md` in the same PR.

## Documentation as spec

`docs/` is authoritative; code disagreeing with docs is a bug in one or the other. Useful starting points:
- `docs/architecture.md` — overview + links to depth.
- `docs/realtime-design.md` — buzzer hot path, race correctness, latency budget.
- `docs/rpc-functions.md` — the 6 PL/pgSQL functions (`buzz_in`, `start_round`, `award_points`, `award_bonus`, `end_game`, `cleanup_expired_games`).
- `docs/api-contracts.md` — REST + Realtime wire format.
- `docs/security-rls.md` — auth, RLS, threat model.
- `docs/local-development.md` — full dev setup + Windows notes + troubleshooting.
- `docs/testing-strategy.md` — what to test, where, and the CI gates.
- `docs/roadmap.md` — phase boundaries and exit criteria.

The legacy AWS version lives at https://github.com/BenArtzi4/Sound-Clash-legacy and is reference-only.
