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

## Findings

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
- **Status:** open (behavior to watch during remaining checks 2/3/5; checks 1 & 4 clean)
