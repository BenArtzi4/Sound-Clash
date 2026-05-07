# Sound Clash — Architecture Overview

This is the executive summary of the system. It points to the deeper docs rather than restating them.

- For the central design decision (no-Python-in-the-buzzer-path), see **`realtime-design.md`**.
- For the concrete service choices and free-tier limits, see **`tech-stack.md`**.
- For schema and RPC functions, see **`data-model.md`** and **`rpc-functions.md`**.
- For security model and RLS, see **`security-rls.md`**.
- For game rules and edge cases, see **`game-rules.md`**.
- For wire-level API contracts, see **`api-contracts.md`**.
- For operational procedures, see **`runbook.md`**.
- For local dev, see **`local-development.md`**.
- For free-tier capacity planning, see **`free-tier-budget.md`**.
- For visual diagrams (component map + service map + sequences), see **`diagrams/internal.md`** and **`diagrams/external.md`**.
- For dev/CI tooling reference (workflows, CodeQL, Dependabot, Codecov, …), see **`tooling.md`**.

## 1. Goals

- **100% free tier** (excluding the `soundclash.org` domain).
- **Python primary** for backend (FastAPI).
- **< 200ms buzzer latency** end-to-end.
- **Ephemeral game data** — auto-deleted 4 hours after game start.
- **Professional standards** — automated tests, CI/CD, clear service boundaries.

## 2. The System in One Diagram

```
                        ┌──────────────────────────────────┐
                        │        soundclash.org            │
                        │     (Cloudflare Pages CDN)       │
                        │  React + TS + Vite SPA           │
                        │  Roles: team / manager / display │
                        └─────┬─────────────────┬──────────┘
                              │                 │
                 (anon key,   │                 │  (X-Manager-Token per-game,
                  RLS-gated)  │                 │   X-Admin-Password for
                              │                 │   /admin/songs only)
                              ▼                 ▼
┌─────────────────────────────────────┐   ┌────────────────────────┐
│           Supabase                  │   │   FastAPI on Render    │
│  ┌───────────────────────────────┐  │   │       (free tier)      │
│  │ Postgres 15                   │  │   │                        │
│  │  • tables (songs, games...)   │◄─┼───┤  POST /games           │
│  │  • PL/pgSQL RPC (buzz_in...)  │  │   │  POST /games/.../song  │
│  │  • RLS policies               │  │   │  CRUD /admin/songs     │
│  │  • pg_cron 4h cleanup         │  │   │                        │
│  └──────────────┬────────────────┘  │   │   uses service-role    │
│                 │ logical repl.     │   │   key (server-only)    │
│                 ▼                   │   └────────────────────────┘
│  ┌───────────────────────────────┐  │
│  │ Realtime broadcast            │  │
│  │ (row UPDATEs → subscribers)   │──┼──→ all browser clients
│  └───────────────────────────────┘  │   via WebSocket
│  ┌───────────────────────────────┐  │
│  │ PostgREST                     │◄─┼─── browser RPC
│  │ /rest/v1/rpc/buzz_in          │  │    (the <200ms path)
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

Three browser roles (team / manager / display) connect to:
- **Supabase** — for live game state (Realtime subscriptions) and the buzzer (PostgREST RPC). The browser uses the **anon key**; RLS gates what's allowed.
- **FastAPI on Render** — for game creation (open to all), the host's per-game manager actions (gated by `X-Manager-Token`), and the durable song catalog (gated by `X-Admin-Password`). FastAPI uses the **service-role key** server-side.

The system has two networking paths but one source of truth (Postgres). Everything either reads from or writes to the Supabase database.

## 3. The Central Architectural Insight

A **<200ms buzzer** + **free Python hosting** is impossible if Python sits in the buzzer path (cold starts of 2–30s).

**Resolution**: take Python out of the buzzer path. The buzzer is a Postgres PL/pgSQL function (`buzz_in`) that browsers call directly via PostgREST RPC. Postgres does the atomic conditional UPDATE. Realtime fans out the result. Python (Render) keeps only the cold-start-tolerant operations.

Latency budget: ~80–180ms total, comfortably inside 200ms. Full walkthrough in **`realtime-design.md`**.

## 4. Component Responsibilities

| Component | Responsibility | Why here |
|---|---|---|
| Browser (React) | UI, Realtime subscriptions, direct RPC for buzzing | Only place clients run |
| Supabase Postgres | Storage, atomic state transitions (RPC functions), 4h TTL via pg_cron | Authoritative state |
| Supabase Realtime | Broadcast row changes to all browser subscribers | Native; no Python needed |
| Supabase PostgREST | HTTP entry to RPC functions (used by browser for `buzz_in`) | Always-on, no cold starts |
| FastAPI on Render | Game creation, song selection logic, admin/song CRUD | Cold-start tolerant; needs Python for app logic |
| Cloudflare Pages | Frontend static hosting, CDN | Unlimited bandwidth |

## 5. Auth Model (summary)

Three credentials, no accounts:

- **Anonymous (players + display)** — Supabase anon key in the browser; RLS allows SELECT on game-scoped tables and EXECUTE on `buzz_in` RPC. Nothing else.
- **Per-game manager token** — random uuid generated by Postgres at game creation, returned to the host's browser, stored in `localStorage`, presented as `X-Manager-Token` to gate `select-song` / `award-points` / `end` / `kick-team`. Hosting is open: anyone can create a game, but only the host's browser holds the token for that specific game.
- **Catalog admin password** — single env var on FastAPI; presented as `X-Admin-Password` to gate `/admin/songs/*` only. This is the operator key for editing the durable song library.

No user accounts, no JWTs, no password hashing. The service-role key is server-only and bypasses RLS for FastAPI's writes. Full details and threat model in **`security-rls.md`**.

## 6. Ephemerality

- `active_games.expires_at` = `started_at + interval '4 hours'` (fixed).
- pg_cron sweeps hourly: `DELETE FROM active_games WHERE expires_at < now()`.
- Cascades to `game_teams` and `game_rounds`.
- `songs`, `genres`, `song_genres` are durable.

Mid-game truncation (>4h sessions) is an accepted limitation.

## 7. YouTube-Only Audio

The catalog stores only `youtube_id` and `start_time`. The browser embeds the YouTube IFrame Player. No object storage involved. This eliminates an entire infrastructure concern (no R2, no Uploadcare, no S3).

## 8. Trade-offs Accepted

| Trade-off | Why we accept it |
|---|---|
| 30s cold start on Render after idle | Only affects game creation, not gameplay; mitigated by 14-min keepalive ping |
| Single-region Postgres | Free tier limitation; pick region matching primary user geography |
| No game history persistence | By user choice; matches today's on-demand mode |
| Per-game manager token + single-tenant catalog admin password | Hosting is open (anyone can run a game); the catalog stays gated. Supabase Auth is the multi-tenant escape hatch if accounts ever ship |
| 200 concurrent Realtime peers | Comfortable for 1–10 parallel games; Pro tier gives 500 if needed |
| 4h fixed TTL truncates marathons | Accepted; future "sliding TTL" is a low-priority enhancement |

## 9. Scale-Out Path

If free tier is outgrown, the design upgrades cleanly without architecture changes:

1. **Supabase Pro** ($25/mo) — first upgrade; raises Realtime peers, DB size, adds PITR.
2. **Render Starter** ($7/mo) — eliminates idle sleep; useful for tournament days.
3. **Migrate FastAPI to Fly.io machines** — multi-region if user base globalizes.
4. **Sentry Team** ($26/mo) — if error volume grows past 5k/mo.

Total possible spend if everything is upgraded: ~$58/mo. Still cheap relative to the ~$1,260/yr always-on AWS baseline.

## 10. What This Document Doesn't Cover

- Concrete service URLs, free-tier limits, alternatives considered → **`tech-stack.md`**
- Buzzer flow, race correctness, latency budget → **`realtime-design.md`**
- Schema, indexes, ER → **`data-model.md`**
- PL/pgSQL function bodies → **`rpc-functions.md`**
- Auth mechanics, RLS policies, threat model → **`security-rls.md`**
- Gameplay rules and state machine → **`game-rules.md`**
- HTTP and Realtime contracts → **`api-contracts.md`**
- Day-to-day ops → **`runbook.md`**
- Local dev setup → **`local-development.md`**
- Capacity planning → **`free-tier-budget.md`**
- Phased migration plan → **`roadmap.md`**
- Granular task list → **`tasks.md`**

This file is the entry point. Read it first; follow the links for depth.
