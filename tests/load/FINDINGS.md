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
