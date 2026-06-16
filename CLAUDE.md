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
@.claude/rules/changelog.md

## Project status

Sound Clash is a real-time multiplayer music-trivia buzzer game, live at `https://soundclash.org`. The DB (Postgres + PL/pgSQL), FastAPI backend, and React frontend are all shipped and in production.

**PL/pgSQL functions in `db/migrations/`**: `buzz_in` (mig 005, called direct from the browser), `award_attempt` (mig 016/021 — multi-buzz scoring, takes a manager-token argument and is called direct from the manager browser), `release_buzz_lock` (mig 018/021 — Continue round, also direct from the browser), `select_next_song` (mig 022 — picks an unplayed song from `selected_genres`, closes the prior round, and inserts the new one in one call; direct from the browser), `peek_next_song` (mig 029 — read-only twin of `select_next_song`'s random picker that returns a candidate next song WITHOUT advancing the round, so the manager browser can prebuffer the next YouTube video; direct from the browser, anon-callable, token-gated, returns zero rows when the pool is exhausted), `start_round` and `end_round` (service-role only, no HTTP caller — invoked from inside `select_next_song`), `award_bonus` (mig 014, FastAPI-routed), `end_game` (mig 005, FastAPI-routed), `cleanup_expired_games` (mig 005, pg_cron). Migration 020 explicitly REVOKEs anon EXECUTE on the backend-only RPCs as defense-in-depth against hosted-Supabase's auto-grant. Migration 023 retired the un-tokenised legacy overloads of `award_attempt`/`release_buzz_lock` once the new direct-RPC path was stable.

**FastAPI app under `backend/app/`**: routers `health`, `genres`, `games` (only `POST /games`, `POST /games/.../teams`, `POST /games/.../bonus`, `POST /games/.../end`, `DELETE /games/.../teams/.../`), `admin_songs`. The supabase-py service-role client wrapper, slowapi rate limits, the bulk-CSV importer (idempotent on `youtube_id`). The `/select-song`, `/end-round`, and `/attempt` REST endpoints are gone — those flows are direct-RPC from the browser now. Auth has two flavours: `require_admin` (constant-time `X-Admin-Password` check, gates `/admin/songs/*` only) and `require_manager_token` (per-game uuid stored on `active_games`, presented as `X-Manager-Token`, gates the host-only REST endpoints that remain).

**React + Vite SPA under `frontend/src/`**: anon-key Supabase client (`lib/supabase.ts`), three-table Realtime subscription with idempotent reducer (`hooks/useGameChannel.ts`), browser-direct PostgREST RPCs (`hooks/useBuzzer.ts`, `hooks/useManagerActions.ts`, `hooks/useSelectNextSong.ts`), `usePlayerReady` / `useServerTime` helpers, the `BuzzButton` / `Scoreboard` / `YouTubePlayer` components, the six pages (Home, JoinTeam, TeamGameplay, ManagerCreateGame, ManagerConsole, Display), per-game manager-token storage (`lib/managerToken.ts`, localStorage), the typed REST wrapper in `lib/api.ts` for the remaining FastAPI calls, and the `_headers` CSP + `_redirects` SPA-routing files in `frontend/public/`. The manager scoring buttons (Correct Song / Correct Artist / Wrong) and the Next Round / Start Game button all fire an optimistic toast before awaiting the RPC, so click-to-feedback latency is effectively zero. `frontend/index.html` ships `<link rel="preconnect">` hints to `www.youtube.com` and `i.ytimg.com` so DNS/TLS to YouTube is warm by the time the player mounts.

**CI gates**: buzz race test (10 concurrent calls → 1 winner, 100×) is the headline DB-side gate; backend gate is line coverage ≥ 90% on `backend/app/`; frontend gate is `vitest run --coverage` plus a Playwright multi-context smoke and a manual three-tab smoke. Phases are tracked in `docs/roadmap.md`; never assume a feature exists in code just because docs describe it.

## Architecture: the one thing to understand first

The system has a hard requirement of **<200ms buzzer latency on free hosting**, and we extend that to every per-round manager click. Render's free tier has 2–30s cold starts, so **Python is deliberately not in any user-perceived hot path**. Instead:

- The buzzer is a **Postgres PL/pgSQL function** (`buzz_in`) called directly from the browser via Supabase PostgREST RPC. Postgres performs the atomic conditional UPDATE; Supabase Realtime fans the row change out to all clients over WebSocket.
- The manager scoring buttons (Correct Song / Correct Artist / Wrong / Continue round) call `award_attempt` / `release_buzz_lock` direct via PostgREST too — the functions validate the per-game `manager_token` argument (mig 021).
- "Next round" / "Start game" calls `select_next_song` direct via PostgREST (mig 022); the function picks an unplayed song, closes any open prior round via `start_round`, and inserts the new one in one round-trip.
- **FastAPI on Render** only handles cold-start-tolerant work that happens at most once or twice per game: `POST /games` (create), `POST /games/.../teams` (join), `POST /games/.../bonus`, `POST /games/.../end`, `DELETE /games/.../teams/...`, and the admin song catalog (`/admin/songs/*`). It uses the Supabase service-role key server-side.
- **Browsers** use the Supabase anon key. Five RPCs are anon-callable (`buzz_in`, `award_attempt`, `release_buzz_lock`, `select_next_song`, `peek_next_song`); each validates either the game-code or the `manager_token` inside the SECURITY DEFINER function body. The remaining RPCs are revoked from anon by migration 020 as defense-in-depth. Hosting is open: `POST /games` is unauthenticated and returns the per-game `manager_token`; the host's browser stores it in localStorage and presents it as `X-Manager-Token` on the few host-only REST endpoints (Bonus / End game / Kick team) and as the `p_manager_token` argument on the manager direct-RPCs. The single env-var admin password (`X-Admin-Password`) gates only the durable song catalog. No JWTs, no user accounts.
- **Ephemerality**: `active_games`, `game_teams`, `game_rounds` auto-delete 4 hours after game start via `pg_cron`. `songs`, `genres`, `song_genres` are durable.
- **Audio is YouTube-only**: the catalog stores `youtube_id` + `start_time`; the browser uses the YouTube IFrame Player. No object storage.

Any change that puts Python in the buzzer path, or that adds a state-management library / object storage / user-account system, contradicts the architecture; flag it before implementing. Full reasoning in `docs/realtime-design.md`; component map in `docs/architecture.md`.

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
- `uvicorn app.main:app --reload --port 8000`: dev server.
- `ruff check .` / `ruff format .`: lint / format.
- `mypy app`: type-check (strict mode is on).
- `pytest`: runs `tests/backend` and `tests/db` (per `pyproject.toml` `testpaths`).
- `pytest -k <pattern>`: single test/subset. `pytest -m "not slow"` skips slow tests. `pytest -m stress` runs the race-test stress loop.
- `pytest --cov=app --cov-branch --cov-report=term-missing`: coverage. CI bans `# pragma: no cover` in `app/`.

Frontend (`cd frontend`):
- `npm run dev`: Vite dev server on :5173.
- `npm run lint` / `npm run format` / `npm run typecheck`.
- `npm run test` (watch) / `npm run test:run` (single) / `npm run test:coverage`.
- `npm run test:e2e`: runs Playwright from `tests/e2e/` (requires local stack running).
- `npm run build`: runs `tsc -b` then `vite build`.

Database / Supabase (repo root):
- `supabase start` / `supabase stop` / `supabase db reset`: local stack via Docker.
- `./db/migrate.sh local`: apply migrations to running local Supabase. Migrations **must be idempotent** (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS ... ; CREATE POLICY ...`).

E2E (`cd tests/e2e`, one-time `npm install && npx playwright install`):
- `npm test`: full suite. `npm test -- --ui` interactive. `npm test <spec>` single.

## Conventions enforced by CI

- Backend: `ruff check`, `ruff format --check`, `mypy app`, `pytest --cov-fail-under=<phase threshold>` (currently 0; ratchets up at phase boundaries; see `docs/testing-strategy.md` §5).
- Banned in `app/`: `# pragma: no cover`. Banned in `frontend/src/`: `it.skip` / `test.skip`.
- Frontend: `eslint`, `tsc --noEmit`, `vitest run --coverage`. No state-management libraries (React state + Supabase Realtime only). No CSS-in-JS. `any` requires a `// reason` comment.
- Migrations rerun by CI to verify idempotency. Schema/RPC/RLS changes must update `docs/data-model.md` / `docs/rpc-functions.md` / `docs/security-rls.md` in the same PR.

## Documentation as spec

`docs/` is authoritative; code disagreeing with docs is a bug in one or the other. Useful starting points:
- `docs/architecture.md`: overview + links to depth.
- `docs/realtime-design.md`: buzzer hot path, race correctness, latency budget.
- `docs/rpc-functions.md`: the PL/pgSQL functions (`buzz_in`, `award_attempt`, `release_buzz_lock`, `select_next_song`, `start_round`, `end_round`, `award_bonus`, `end_game`, `cleanup_expired_games`).
- `docs/api-contracts.md`: REST + Realtime wire format.
- `docs/security-rls.md`: auth, RLS, threat model.
- `docs/local-development.md`: full dev setup + Windows notes + troubleshooting.
- `docs/testing-strategy.md`: what to test, where, and the CI gates.
- `docs/roadmap.md`: phase boundaries and exit criteria.
