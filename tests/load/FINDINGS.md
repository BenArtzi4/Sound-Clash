# Load-test findings log

Every issue, anomaly, or capacity ceiling surfaced by a load-test run gets an
entry here — including WARNs that turned out benign (write down *why* they're
benign). This file is the durable memory of what the stack can and cannot
take; the per-run `results/<label>/report.md` files are gitignored, so
anything worth keeping must be copied into an entry below.

Rules (mirrors `.claude/rules/lessons-learned.md` discipline):

- One entry per distinct finding, newest first. Update an existing entry
  instead of duplicating it if a later run adds evidence.
- A run with verdict PASS and nothing surprising still gets a one-line entry
  in the **Run ledger** table so coverage is auditable.
- If a finding is a real product bug, note the GitHub issue number once filed.

## Entry template

```markdown
### YYYY-MM-DD — <check label> — <short title>
- **Severity:** blocker | major | minor | info
- **Symptom:** what the report/monitor showed (verdict line, numbers)
- **Evidence:** key figures from report.md/report.json, console log lines,
  Grafana/Loki queries + results, Supabase dashboard observations,
  pg_stat snapshots — enough that someone can re-derive the conclusion
- **Diagnosis:** root cause (or best current hypothesis, marked as such)
- **Action:** issue filed (#N) / fix shipped (PR #N) / accepted as capacity
  limit / harness bug fixed / none needed (why)
- **Status:** open | resolved | accepted
```

## Monitoring notes for load runs (read before diagnosing)

- **Synthetic runs emit no Faro telemetry.** The harness is protocol-level
  (no browsers), so Grafana Loki `{service_name="sound-clash-web"}` and Tempo
  traces will NOT show the synthetic traffic. During a load run, Loki is
  useful for one thing: spotting impact on *real* users (e.g.
  `stale_buzz_lock_resynced` warns or error spikes from a live party in the
  same window).
- **Supabase-side metrics** (Realtime concurrent connections, DB CPU/IO,
  connection pool) live in the Supabase dashboard (Reports → Database /
  Realtime). As of 2026-07-14 there is no Supabase metrics scrape into
  Grafana Cloud (that wiring is a known owed item) — check
  `list_datasources` before assuming.
- **DB-side ground truth** is available read-only and ungated:
  `supabase db query --linked "select state, count(*) from pg_stat_activity group by state"`
  before/during/after a run shows backend+PostgREST pool pressure (note:
  Realtime *WebSocket* client count is NOT visible in pg_stat_activity — the
  dashboard is the only place to read it).
- The harness's own `report.json` (latency distributions, Realtime delivery
  misses, subscribe failures, 429 counts) is the primary instrument; external
  monitoring corroborates.

## Run ledger

| date | check | verdict | report highlights | findings |
|---|---|---|---|---|
| 2026-07-14 | smoke #1 (1×3×11, fast, prod) | WARN | buzz_in p95 94ms; 2/220 RT misses; lock_set p95 2177ms | 1 (harness bug, fixed) |
| 2026-07-14 | smoke #2 (1×3×11, fast, prod) | PASS | buzz_in p95 93ms; select p95 82ms; RT p95 ~610-630ms; 0/220 misses; all invariants green | 0 |
| 2026-07-14 | smoke #3 (1×3×11, --rt-budget 3, prod) | FAIL | one device's channel had a multi-second delivery gap: 6/129 misses, fake 6-7s lock_set tail | 2 (1 harness bug fixed; 1 info below) |
| 2026-07-14 | smoke #4 (--rt-budget 3) + #5 (full) | PASS | after matcher hardening: 0 misses both, RT p95 ~560-640ms, 0 reconnects | 0 |
| 2026-07-14 | check1-5x10 (5×10×15, realistic, prod) | PASS | buzz_in p95 116ms / award p95 86ms / select p95 97ms; RT p95 ~611–619ms; 0/3555 RT misses; 60/0 subscribe; 0 violations; score_update p99 1688ms/max 2105ms tail (still 0 misses); pg_stat 13→28 backends | 0 |
| 2026-07-14 | check4-1x30 (1×30×15, realistic, prod) | PASS | buzz_in p95 269ms (30-way race contention, vs 116ms @10-way) / award p95 94ms / select p95 220ms; RT lock_set p95 611ms / round_insert 880ms / score_update 579ms; 0/1888 RT misses; 32/0 subscribe; 0 violations; check1 score_update tail did NOT recur (p99 608ms); pg_stat flat 28→28 backends; Loki clean (no real users overlapped) | 0 |
| 2026-07-14 | check2-10x10 (10×10×15, realistic, prod) — run 1/2 | FAIL (crashed) | harness node process died SILENTLY at round 84/150 during play (~10:36:50 UTC, ~5m45s in); no report, empty stderr, no Windows crash event, no OOM msg; errorCount 0 / violations 0 at last heartbeat; setup fully completed (10/10 games, 100/100 teams, 120 RT sockets); DB backends flat 29→29→29; Loki empty (no real users); 10 leftover games cleaned up HTTP 200 | 1 (below) |
| 2026-07-14 | check2-10x10 (10×10×15, realistic, prod) — run 2/2 (retry) | PASS | full completion at 120 sockets: buzz_in p95 102ms / award p95 81ms / select p95 84ms; RT lock_set p95 627ms / round_insert 653ms / score_update 688ms; 0/7752 RT misses; 120/0 subscribe; 0 violations; 10/10 games; score_update tail recurred (p99 1883ms/max 2021ms) — same as check1, still 0 misses; pg_stat 12→28→29; Loki clean → run-1 crash was a transient fluke, NOT a 120-socket ceiling | 0 |
| 2026-07-14 | check3-20x10 (20×10×15, realistic, prod, --rt-budget 180) | PASS | biggest concurrent-games window: 240 devices / 180 subscribed (60 shed by budget — 20 displays+20 managers+20 teams), 0 subscribe failures; buzz_in p95 102ms / award p95 82ms / select p95 88ms; RT lock_set p95 719ms / round_insert 721ms / score_update 750ms; 0/11313 RT misses; 180/0 subscribe; 0 violations; 20/20 games; score_update tail p99 1288ms/max 2451ms (did NOT grow with game count, still 0 misses); 0 reconnects/channel_errors; pg_stat 22→29→29; Loki clean (no real users) | 0 |
| 2026-07-14 | check5-soak-3x10x60 (3×10×60, realistic, prod) | PASS | soak/drift check, ~14min continuous play (180 rounds / 3 concurrent games): NO drift — round throughput flat ~12–13 rounds/min start→finish, select_next_song stayed tight (p95 111ms/p99 149ms/max 262ms over 180 calls) even as each game's played-set grew to 60 songs; buzz_in p95 117ms / award p95 98ms; RT lock_set p95 608ms / round_insert 630ms / score_update 643ms; 0/9012 RT misses; 36/0 subscribe; 0 violations; 3/3 games 60/60 rounds, all late rounds (40–60) verified; score_update tail p99 1650ms/max 2192ms (same bounded ~1.3–1.9s band, still 0 misses, did NOT worsen over soak); 0 reconnects/channel_errors; pg_stat flat 29→29→29; Loki clean (no real users) | 0 |

## Findings

### 2026-07-14 — check2-10x10 — harness node process died silently at round 84/150 (120-socket scale) — one-off, did not reproduce
- **Severity:** minor (transient one-off harness/client crash; the immediate
  clean retry proves it is NOT a reproducible 120-socket ceiling — the product
  and stack handle 10 games / 120 sockets fine, see the run-2 PASS below)
- **Symptom:** the detached `loadtest.mjs run` process terminated abnormally
  and silently ~5m45s into the run, at **round 84/150** in the **play** phase.
  No `report.md`/`report.json` was written (`status.json` frozen at
  `done=false`, `roundsDone=84`, `now=2026-07-14T10:36:49.985Z`). The Monitor
  flagged it as STALLED (status.json silent for 135s); investigation confirmed
  the process was gone (no `node ... loadtest.mjs` in the process table — only
  the unrelated Playwright-MCP node processes remained). All three of the
  harness's independent `setInterval` timers (2s status heartbeat, 15s console
  progress, sweeper) stopped firing at the same instant → the process died, it
  did not merely pause.
- **Evidence:**
  - `results/check2-10x10-console.err.log` is **0 bytes** — the process wrote
    nothing to stderr. The harness's normal error path
    (`loadtest.mjs:481-483`, `.catch` → log + `process.exit(2)`) writes to
    stderr, so this was **not** a caught `LoadError`. There is no
    `unhandledRejection`/`uncaughtException` handler in the harness.
  - `console.log` ended cleanly at `[+05:45] progress: phase=play rounds=80/150
    errors=0 violations=0`; setup had completed fully at `[+03:45] setup
    complete: 10/10 games ready` and `120 devices subscribe to Realtime (no
    --rt-budget cap)`.
  - No Windows **Application Error (1000)** / **Windows Error Reporting (1001)**
    event for `node.exe` in the window (checked the Application log ±20 min) →
    no recorded native crash / access violation. No `FATAL ERROR ... heap out
    of memory` line anywhere → no logged Node OOM.
  - **DB was never the bottleneck:** `pg_stat_activity` was flat across the
    whole run — baseline 10:30:46 (idle 19 / null 8 / active 2 = 29), mid-run
    10:35:14 (identical 29), post-run 10:41 (identical 29). No backend-pool
    growth, matching checks 1 & 4 (PostgREST pooling keeps backend count flat).
  - **Loki `{service_name="sound-clash-web"}` empty** 10:29–10:44 UTC → no real
    party overlapped; the crash was not confounded by real users, and the run
    had zero real-user impact. No Supabase/Prometheus metrics datasource exists
    (only 3 Loki sources), so the Realtime concurrent-connection count could not
    be read from Grafana — check the Supabase dashboard's Realtime report for
    the 10:31–10:37 UTC window if a connection-quota event is suspected.
  - **Scale context:** this is the **first check at 120 concurrent Realtime
    sockets** (10 games × (10 teams + manager + display)). Check1 passed at 60
    sockets, check4 at 32 — both clean, 0 misses. 120 is 2× the largest
    previously-validated socket count and under the free-tier ~200 quota.
- **Diagnosis (best current hypothesis):** a **client-side abnormal termination
  of the harness Node process at the 120-socket scale**, not a backend capacity
  failure. Supporting the client-side read: DB backends stayed flat, the last
  heartbeat showed `errorCount=0`, and a genuine server capacity limit (Realtime
  quota, rate-limit, DB pool) would have surfaced as in-report subscribe
  failures / errors — not a process death. The specific cause is undetermined
  from the corpse (empty stderr, no WER event, no core): candidates are a native
  fault in the borrowed supabase-js Realtime / `ws` / `undici` layer under 120
  concurrent sockets, or an unlogged Node OOM from growing per-device delivery-
  expectation structures across 84 rounds × 10 concurrent games. Cannot yet
  distinguish transient fluke from a reproducible 120-socket ceiling — that needs
  one controlled re-run.
- **Action:** leftover games cleaned up immediately
  (`loadtest.mjs cleanup --dir tests/load/results/check2-10x10` → all 10 ended
  HTTP 200; post-cleanup pg_stat confirmed no backend residue). Harness **not**
  modified (per RUN-PROMPTS discipline: document, don't patch mid-check). Then
  **re-ran check2-10x10 unchanged** (same seed 202) — see the RETRY result below.
- **RETRY (2026-07-14, run 2/2):** **PASS**, full completion at the identical
  120-socket scale — all 10 games played 15/15 rounds and ended, **0/7752
  Realtime misses**, **120/120 subscribes OK**, 0 invariant violations, 0
  unexpected errors across 1441 actions. buzz_in p95 102ms / award 81ms / select
  84ms (all healthy, ≈ check1's 10-way numbers). No `realtime:reconnects` /
  `channel_errors` counter emitted (0 with 0 misses). pg_stat 12 (quiet
  baseline) → 28 (mid) → 29 (post), all pooled. Loki empty over 11:39–11:50 UTC
  (no real users). ⇒ **the run-1 crash was a transient one-off, not a
  reproducible 120-socket ceiling.** The stack comfortably handles 10 concurrent
  games / 120 Realtime sockets.
- **Residual (optional, low priority):** the *cause* of the single run-1 crash
  was never captured (empty stderr, no WER event). If it ever recurs, harden the
  harness to catch it next time: add `process.on('uncaughtException' /
  'unhandledRejection', …)` logging + `rss`/`heapUsed` lines in the 2s heartbeat
  + a `--max-old-space-size` bump. Not worth doing pre-emptively for a
  non-reproducing one-off; noted here so a future recurrence has a playbook.
- **Status:** resolved (transient; immediate retry passed clean at the same scale)

### 2026-07-14 — smoke — kicked device counted as false Realtime misses
- **Severity:** minor (harness bug, not a product bug)
- **Symptom:** smoke #1 verdict WARN: 2/220 Realtime deliveries reported as
  misses, lock_set p95 2177ms with a 9316ms outlier.
- **Evidence:** the kick flow closes the kicked team's device mid-run; open
  expectations registered before the kick still counted that device in their
  audience, so its (impossible) deliveries were booked as misses.
- **Diagnosis:** measurement artifact in `lib/driver.mjs` — `kickOne()` closed
  the device without removing it from open expectations' audiences.
- **Action:** fixed in the same PR that added the harness (audience pruned
  before close). Smoke #2 re-ran clean: 0/220 misses, all PASS. The 9.3s
  lock_set outlier did not reproduce; if a similar near-window outlier shows
  up in the real checks, treat it as a genuine Realtime-latency finding, not a
  harness artifact.
- **Status:** resolved

### 2026-07-14 — smoke — transient Realtime per-channel delivery gap on prod (info)
- **Severity:** info
- **Symptom:** smoke #3 (only 3 Realtime connections — nowhere near quota):
  one device missed 4 consecutive `round_insert` events plus 1 lock/score
  event (~a several-second window); nothing in the harness or backend erred.
  Two lock_set "deliveries" of 6.3s/7.7s in the same run turned out to be a
  harness matcher false-match (a later round's buzz by the same winning team
  satisfying the stale expectation), fixed by binding lock_set expectations to
  `current_round_id` — after which reruns were clean (0 misses).
- **Evidence:** `results/smoke-rtbudget-prev-*/report.json` (6/129 misses,
  round_insert missRate 12.9% on a 3-device audience); reruns #4/#5 clean.
- **Diagnosis:** consistent with a brief Supabase Realtime channel hiccup
  (events during a gap are simply not replayed on a channel). The product
  self-heals via hydrate-on-subscribe + 60s backstop resync, so players would
  see at most seconds of staleness — but the raw channel is not lossless.
  The harness now surfaces `realtime:reconnects` / `realtime:channel_errors`
  counters so future gaps are attributable in the report.
- **Action:** harness hardened (round-bound lock_set matcher + channel-health
  counters). Watch the real checks: if misses recur with reconnects > 0,
  that's the same phenomenon; if misses recur with 0 reconnects, dig deeper
  (silent gap without rejoin would be a stronger finding).
- **check1-5x10 (2026-07-14):** clean — 0/3555 Realtime deliveries missed
  across 60 subscribed devices (round_insert 890, lock_set 1362, score_update
  1303), and no `realtime:reconnects` / `realtime:channel_errors` counter was
  emitted (harness omits zero counters), so 0 misses *with* 0 reconnects. No
  channel gap reproduced at the 5-game / 60-socket scale. One benign tail:
  `score_update` p99 1688ms / max 2105ms (vs ~635/707ms for lock_set) — still
  far under the 10s miss window, so not a delivery gap; consistent with a brief
  score-fanout queueing tail under concurrent play, worth watching at higher
  device counts (checks 2–4).
- **check4-1x30 (2026-07-14):** clean at the single-game 32-socket / 30-team
  scale — 0/1888 Realtime deliveries missed (round_insert 480, lock_set 704,
  score_update 704), no `realtime:reconnects` / `realtime:channel_errors`
  counter emitted (0 reconnects *with* 0 misses), 32/32 subscribes OK. The
  check1 `score_update` tail did NOT reproduce here: score_update p99 608ms /
  max 609ms — actually tighter than lock_set (p99 621ms / max 835ms), so the
  30-way single-game fan-out did not queue score events. Separate observation
  (latency, not delivery): `buzz_in` p95 rose to 269ms (p99 287 / max 293) under
  30-way simultaneous races vs 116ms at 10-way — expected lock-contention
  scaling on the one hot `active_games` row, still well under threshold, and 0
  race-winner violations across all 6 race rounds (race_title×4, race_both×1,
  race_wrong_race×1) → the 30-way buzz race still yields exactly one winner every
  time. Loki `{service_name="sound-clash-web"}` was empty over the run window
  (10:18–10:26 UTC), so no real party overlapped to confound the numbers.
- **check2-10x10 (2026-07-14, retry):** the tail **recurred** at the 10-game /
  120-socket scale and is essentially unchanged from check1: `score_update`
  p95 688ms / **p99 1883ms / max 2021ms** (vs check1 p99 1688 / max 2105 at 5
  games / 60 sockets), while lock_set p95 627ms / round_insert p95 653ms stay
  tight. Still **0/7752 misses** — far under the 10s window, so it's a
  queueing/fan-out latency tail, not a delivery gap. Pattern so far: the tail
  appears under **multi-game concurrent score fan-out** (check1 5-game p99 1688,
  check2 10-game p99 1883 — grows only mildly with game count) and is **absent**
  in the single-game check4 (p99 608). So it tracks *number of concurrent games*
  fanning score updates, not raw socket count, and is not degrading materially
  as games double. Benign at current scale; keep watching in check3 (20 games)
  and the check5 soak.
- **check3-20x10 (2026-07-14):** at the **20-game / 180-socket** scale (the
  biggest concurrent-games window) the tail did **NOT** grow with game count —
  `score_update` p95 750ms / **p99 1288ms / max 2451ms**, a *lower* p99 than
  check2's 10-game p99 1883 (max only slightly higher, 2451 vs 2021). lock_set
  p95 719ms / round_insert p95 721ms stayed tight. Still **0/11313 misses**, and
  no `realtime:reconnects` / `realtime:channel_errors` counter emitted (0 misses
  *with* 0 reconnects). **This is the decisive data point:** across 5→10→20
  concurrent games the score_update p99 sits in a bounded **~1.3–1.9s band**
  (check1 1688, check2 1883, check3 1288) rather than climbing with scale —
  confirms the tail is a benign concurrent-fan-out queueing artifact, not a
  degradation. Capacity note: **180/240 devices subscribed** with `--rt-budget
  180` (shed 60: all 20 displays + 20 managers + 20 one-team-per-game),
  `subscribe:ok=180 / failed=0` → **zero free-tier connection-quota pressure at
  180 concurrent Realtime sockets** (the budget was never breached, so no
  finding). pg_stat flat 22→29→29 (PostgREST pooling, no blowout). Loki
  `{service_name="sound-clash-web"}` empty over 12:05–12:19 UTC (no real party
  overlapped). 0 REST 429s despite 240 device creations/joins from one IP.
- **check5-soak-3x10x60 (2026-07-14):** the 60-round soak (180 rounds across 3
  concurrent games, ~14 min of continuous play) is the **time-drift** test, and
  the tail is **stable over time, not accumulating**. `score_update` p95 643ms /
  **p99 1650ms / max 2192ms** — squarely in the same bounded ~1.3–1.9s band as
  checks 1/2/3 (p99 1688/1883/1288), and at 3-game concurrency essentially
  matching check1's 5-game figure. Still **0/9012 misses** (lock_set p95 608ms /
  round_insert p95 630ms stayed tight), no `realtime:reconnects` /
  `realtime:channel_errors` counter emitted (0 reconnects *with* 0 misses),
  36/36 subscribes OK. **Drift verdict (the point of this check):** across the
  ~14-min play window round throughput held flat at ~12–13 rounds/min (console
  cadence 3→180 with no slowdown), `select_next_song` stayed tight (p95 111ms /
  p99 149ms / max 262ms over 180 calls) **even as each game's `game_rounds`
  played-set grew to 60 songs** — so the accumulating played-set does NOT slow
  the random picker — and pg_stat backends were flat 29→29→29
  (baseline 12:25:58 → mid 12:27:45 → late 12:41:36), no connection leak over
  the soak. No late-game failure: all 3 games completed rounds 40–60 and their
  final scores verified. ⇒ the score_update fan-out tail is a per-event
  queueing artifact that neither worsens nor drifts over a long run.
- **Status:** open (behavior to watch; checks 1/2/3/4/5 measured — score_update
  tail present under multi-game fan-out, bounded ~p99 1.3–1.9s across 5/10/20
  games AND across a 60-round soak, 0 misses, not degrading with scale or over
  time; single-game check4 clean)
