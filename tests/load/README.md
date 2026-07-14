# Load tests (`tests/load/`)

Protocol-level load harness that answers: **will the live stack survive a real
event** — several simultaneous games, 10–30 teams each, 15 rounds, every
manager button exercised?

It simulates whole games exactly the way real devices talk to the stack:

- **REST** (FastAPI on Render): create game, join teams, bonus, kick, end.
- **Direct PostgREST RPCs** (the hot path, same anon key + args the browser
  sends): `buzz_in`, `award_attempt`, `release_buzz_lock`, `select_next_song`,
  `peek_next_song`, `extend_game`.
- **Supabase Realtime**: one WebSocket **per simulated device** (each team
  phone + manager + display), subscribing the exact channel the app uses
  (`game:<code>`, three `postgres_changes` bindings filtered by `game_code`),
  with the app's hydrate-on-subscribe reads and 60s backstop resync.

No browsers and no YouTube: video playback is client-local and puts zero load
on the backend, so a protocol harness measures the part that can actually
fall over. Zero new dependencies — supabase-js is borrowed from
`frontend/node_modules` via `createRequire` (needs Node ≥ 22 for the native
WebSocket; this repo's machines run Node 24).

## Commands

```bash
# from the repo root
node tests/load/loadtest.mjs smoke                       # tiny self-check: 1 game, 3 teams, every flow once
node tests/load/loadtest.mjs run --label check1-5x10  --games 5  --teams 10 --rounds 15 --seed 101
node tests/load/loadtest.mjs run --label check2-10x10 --games 10 --teams 10 --rounds 15 --seed 202
node tests/load/loadtest.mjs run --label check3-20x10 --games 20 --teams 10 --rounds 15 --seed 303
node tests/load/loadtest.mjs run --label check4-1x30  --games 1  --teams 30 --rounds 15 --seed 404
node tests/load/loadtest.mjs cleanup --dir tests/load/results/<label>   # end leftover games after a crash
```

Flags: `--pace realistic|fast` (default realistic: human-speed rounds),
`--kick` (exercise the kick-team button late in each game), `--skip-bonus`,
`--skip-resync`, `--genres rock,pop`, `--target prod|local`,
`--create-rate/--join-rate/--mgr-rate` (per-minute REST pacing, defaults sit
just under the backend's per-IP limits — only raise them if the backend's
limits were temporarily raised too).

Endpoints come from `frontend/.env.production` (prod) or `frontend/.env.local`
(local); `LOADTEST_SUPABASE_URL` / `LOADTEST_SUPABASE_ANON_KEY` /
`LOADTEST_API_URL` override.

## What a run does

1. **Preflight** — waits out the Render cold start via `/health`, resolves
   genre UUIDs, checks the song pool covers the round count, and warns if any
   real game is currently `playing` on the target.
2. **Setup** — creates all games and joins all teams, **paced under the
   backend's per-IP rate limits** (create 10/min, join 30/min — from one test
   machine every request shares one bucket, so e.g. the 20-games×10-teams
   check spends ~10 minutes here by design). Then opens every device's
   Realtime socket. Setup finishes for *all* games before any round starts, so
   the play phase is a true N-concurrent-games window.
3. **Play** — each game runs its seeded round loop concurrently: pick a flow
   (see below), `select_next_song`, sometimes `peek_next_song`, listen delay,
   buzz(es), manager verdict(s), think-time delays. `extend_game` fires once
   per game (~⅔ through), bonus is mixed in, kick optionally.
4. **Verify** — final `game_teams` scores are fetched over anon PostgREST and
   compared against the locally-kept expected ledger (which mirrors mig 043
   scoring: title +10, artist +5, both +15, wrong −3, free-guess waiver 0).
5. **Teardown** — every game gets `POST /games/{code}/end`; sockets close.
   Game codes + manager tokens are journaled to `results/<label>/games.json`
   as they're created, so `cleanup` can always end leftovers after a crash.
6. **Report** — `results/<label>/report.md` + `report.json`, plus a
   `status.json` heartbeat (updated every 2s) for detached monitoring.

## Round flows (the "many combinations of buttons")

| flow | what it exercises |
|---|---|
| `race_title` / `race_both` | all teams buzz simultaneously (the race), winner gets Correct Song / both tokens |
| `single_title` / `single_artist` | lone buzz, one verdict |
| `split_title_artist` | Correct Song → Continue → second team buzzes → Correct Artist |
| `wrong_then_title` | Wrong (−3, auto-release) → another team wins the title |
| `wrong_chain` | Wrong → Wrong → third team takes both (+15) |
| `free_guess_waiver` | Correct Song → Continue → Wrong for **0** (mig 017 waiver) → Correct Artist |
| `race_wrong_race` | full race, winner wrong, full re-race, winner scores |
| `no_buzz_skip` | nobody buzzes; Next Round on an open round |
| `bonus_after_title` | scoring + the Bonus REST endpoint |

Flow choice is seeded (`--seed`) → a run is reproducible. `smoke` forces every
flow exactly once.

## Invariants (any violation ⇒ FAIL)

- Every buzz race yields **exactly one** `locked=true` winner; losers see the
  winner's id.
- `award_attempt`'s returned delta and running total match the local ledger at
  every step; final DB scores match exactly; kicked teams are gone.
- `select_next_song` returns exactly `previous+1` round numbers; all rounds
  complete; every game ends cleanly.

## Metrics & verdicts

- **RPC/REST latency** percentiles per operation (from the test machine).
- **Realtime delivery**: action fired → `postgres_changes` event observed at
  each subscribed device, for three families: buzz-lock set, round insert,
  score update. Events not seen within 10s count as **misses**.
- **Subscription outcomes**: sockets established vs failed (failures at high
  device counts usually mean the Supabase plan's concurrent-connection quota —
  a capacity finding, reported as WARN, not a code bug).
- Thresholds are advisory (encoded in `lib/metrics.mjs`); read the
  distributions in the report before reacting to a WARN.

## Caveats

- **One machine, one IP.** REST setup shares the per-IP rate-limit buckets
  (real parties don't), and all latency includes this machine's RTT. Hot-path
  RPCs go straight to PostgREST and are not affected.
- **Realtime quota**: N games × (teams+2) sockets. 240 devices (check 3)
  exceeds the Supabase free-tier concurrent-connection quota (200) by design —
  that check probes the ceiling.
- Runs create real (ephemeral, 4h TTL) games on the target and their swept
  rows land in the durable `game_history` archive; team names are prefixed
  `LT-` so they're recognizable. Every run ends its games; `cleanup` catches
  crashes; the pg_cron sweeper is the final backstop.
- `results/` is gitignored (it contains per-game manager tokens — ephemeral
  secrets for games the harness itself created).

## Findings discipline

Per-run reports are gitignored, so **every** finding — violations, WARNs,
capacity ceilings, harness bugs, and even clean PASSes (one ledger row) — must
be recorded in the committed `tests/load/FINDINGS.md`, with the monitoring
evidence (Grafana/Loki checks, pg_stat snapshots) described there. The run
procedures in `RUN-PROMPTS.md` walk through it step by step.
