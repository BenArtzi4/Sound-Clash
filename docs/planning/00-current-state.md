# Current State — How Sound Clash Works & What the Review Found

_Snapshot: 2026-07-04. Evidence base: 11 subsystem maps + cross-cutting hunts over the repo at commit `1bbd344`._

## 1. The system in one screen

Sound Clash is a live real-time music-trivia buzzer game at `https://www.soundclash.org`. Three roles, three screens:

- **Host** ("manager") on a phone: creates the game, picks genres/decades, controls playback, scores answers. The host's device is also the **audio source** (connect it to room speakers).
- **Teams** on their phones: one big **BUZZ** button + a live score pill.
- **Display** on a TV/projector: join QR + game code + scoreboard + answer reveal panel + score pills. No audio.

**Architecture (the load-bearing decision):** hard `<200ms` buzzer latency on free hosting. Python (FastAPI/Render, 2–30s cold starts) is deliberately kept out of every per-round hot path. Instead:

- **Buzzer + per-round host actions are PL/pgSQL functions called *directly from the browser*** via Supabase PostgREST RPC (anon key). Postgres does the atomic conditional UPDATE; Supabase **Realtime** fans the row change to all clients over one WebSocket. Functions: `buzz_in`, `award_attempt`, `release_buzz_lock`, `select_next_song`, `peek_next_song` (all anon-EXECUTE, each validates a game-code or `manager_token` in-body).
- **FastAPI handles only once-or-twice-per-game work**: `POST /games` (create, returns the `manager_token`), join team, bonus, end game, kick team, and the admin song catalog. Uses the service-role key server-side.
- **Auth:** no accounts, no JWTs. A per-game `manager_token` uuid (localStorage, `X-Manager-Token` / `p_manager_token`) gates host actions; a single env-var admin password gates only the durable song catalog. Game codes are 6 chars.
- **Data:** ephemeral tables (`active_games`, `game_teams`, `game_rounds`, `game_round_attempts`) auto-delete 4h after game start via `pg_cron`. Durable: `songs` (~1025), `genres`, `song_genres`, and a `game_history` archive (mig 033). Audio is YouTube-only (IFrame player; catalog stores `youtube_id` + `start_time` + `release_year`).
- **Hosting:** Supabase (Frankfurt), Render (US-West, free), Cloudflare Pages, cron-job.org keepalive every 14 min, Grafana Cloud (Faro + OTel) + Sentry for observability.

**Frontend:** React 18 + Vite SPA. `useGameChannel` runs one Realtime subscription over three tables with an idempotent reducer + a 20s REST re-sync backstop. Direct-RPC hooks (`useBuzzer`, `useManagerActions`, `useSelectNextSong`, `usePeekNextSong`). Six pages + admin. `ManagerConsolePage` is the hot seat: two YouTube players (live + hidden prebuffer), optimistic scoring toasts, next-round double-buffer swap.

**Scoring:** +10 title, +5 artist, +15 soundtrack (derived from genre membership), −3 wrong, +4 bonus, a free-guess sweetener after a correct answer, two tokens (title+artist) per song, multi-buzz rounds.

**CI:** four workflows (backend, frontend, e2e, db-migrate) + CodeQL. Headline gate is the DB buzz-race test (10 concurrent → 1 winner, looped). Backend coverage gate, frontend vitest + Playwright.

## 2. Overall health

The codebase is **genuinely well-built** for its scope: the direct-RPC architecture is sound, the Realtime reducer is idempotent, the test pyramid is real (DB race tests, backend contract tests, vitest, Playwright), and the docs are unusually thorough. This is not a rescue job — it is a solid app that needs **polish, hardening, and load/smoothness tuning** to feel production-perfect.

The review surfaced no data-loss bug in the live scoring path and no crash in the buzz race. The issues cluster into five honest themes:

## 3. The five themes (what the review actually found)

1. **Load & time-to-playable (biggest felt "speed" lever).** The player who scans the QR pays: no preconnect to Supabase/api (only YouTube is warmed), Faro telemetry (~58KB gz, and per issue #145 it sends nothing) + Sentry (~22KB gz) shipped eagerly on the join path, hashed assets served `max-age=0` (every load revalidates the whole shell), initial state hydrate gated *behind* the WebSocket handshake, and a blank white screen during route-chunk download. None of these touch the `<200ms` buzz number, but together they are the difference between "instant" and "why is this slow."

2. **Perceived smoothness (what a hand on a phone feels as lag).** The BUZZ button throws away the authoritative RPC result and waits for the Realtime echo to change state; press feedback fades in over 200ms; several infinite CSS animations repaint the whole viewport (`background-position` drift, `box-shadow` pulse, `width`-animated timer bar); manager scoring buttons jump ~70px when a buzz lands (mis-tap hazard); a shared `busy` flag silently drops legitimate rapid host clicks.

3. **Backend-path & Realtime economics.** `buzz_in` fires a second, now-dead `game_rounds` UPDATE nobody reads — doubling hot-path fan-out; `award_attempt` fires 2–3 separate UPDATEs per click; `game_round_attempts` is in the Realtime publication with zero subscribers. All pure waste on free-tier quotas.

4. **Resilience — what breaks a real party.** Dead/region-blocked YouTube video mid-round gives only a transient toast and no skip; host phone lock strands a paused song; a game running past 4h is hard-deleted mid-round with zero warning; `manager_token` loss orphans the whole game; failed hydrate silently drops live events; deploy-during-game blanks the screen (stale chunk → HTML, unhandled).

5. **Security & integrity (realistic severities for a free party game).** **One critical:** `manager_token` is readable by any anon client (table SELECT + full-row Realtime fan-out), so anyone who sees the projector's game code can hijack host controls. Plus: the current song's answer is anon-readable the instant a round starts; anon can enumerate *all* live games via one `select=*`; `buzz_in` doesn't verify team ownership (buzz as any team); no rate limit on direct RPCs; durable `game_history` keeps stranger-entered team names forever.

Plus two cross-cutting production gaps the critic flagged: **the ~1025-song catalog is effectively unrecoverable** (git seed is 7 rows, the S3 fallback CSV is 601, prod is ~1025, free tier keeps 1 day of backups with no PITR — and the runbook's DR claim is stale), and **there is no proactive check for dead YouTube IDs** across an aging catalog.

## 4. What is NOT wrong (so we don't "fix" it)

- The buzz race is correct and fast; don't touch the atomic-UPDATE core except to remove the dead mirror write.
- `select_next_song`'s `ORDER BY random()` picker is well-indexed and runs once/round via peek — fine at current scale; just keep an eye on it past a few thousand songs.
- The cache-nothing service worker is a deliberate correctness call — the fix belongs at the HTTP caching layer, not by making the SW cache.
- REPLICA IDENTITY FULL is required (filtered DELETEs match on `game_code`, not PK) — we can't drop it; we reduce write *count* instead.
- Docs are the spec and are mostly excellent; the drift is concentrated in `data-model.md` §5/§6 and a few contract status codes.

## 5. How the plan is organized from here

The backlog is split by category in `01`–`04`, sequenced into phases in `phases/`. Performance (themes 1–3) comes first because it is the stated goal and is almost entirely low-risk autonomous work. Resilience (4) follows. Security (5) and Features (8) carry the big decisions in `05-decisions-needed.md` and wait on your calls. Correctness/docs (6) and tech-debt (7) are steady autonomous cleanup that can interleave.
