# Load-check run prompts

Copy-paste prompts for running each load check in a **fresh Claude Code
session**. One check at a time — never two concurrently (they'd confound each
other's measurements and share the one-IP rate-limit buckets).

**Session settings for every check:** model **Opus 4.8** (`/model opus`),
default (medium) effort. The harness does the heavy lifting; the session just
launches, watches, and reads the report. Keep Fable for design/analysis work.

**Recommended order & rough duration** (realistic pace, includes the
rate-limit-paced setup):

| # | check | duration | why this order |
|---|---|---|---|
| 1 | `check1-5x10` — 5 games × 10 teams | ~10 min | baseline, matches a real multi-room event |
| 2 | `check4-1x30` — 1 game × 30 teams | ~8 min | single-game fan-out + 30-way buzz races |
| 3 | `check2-10x10` — 10 games × 10 teams | ~12 min | scale step |
| 4 | `check3-20x10` — 20 games × 10 teams | ~18 min | ceiling probe (240 Realtime sockets — may exceed the Supabase plan's connection quota by design) |

Run during a quiet window (the harness warns if a real game is `playing`).

---

## Template (all four checks use this; only the ARGS line differs)

```
Run the Sound Clash load check against production using the committed harness in tests/load/ (read tests/load/README.md first if anything is unclear). Do exactly this:

1. Confirm the harness exists in the working tree (tests/load/loadtest.mjs). If it is missing, `git checkout feature/load-test-harness` first (or fetch main if the PR merged).

1b. Baseline snapshot BEFORE launching (both are read-only and safe):
   - `supabase db query --linked "select state, count(*) from pg_stat_activity group by state order by 2 desc"` (Bash, dangerouslyDisableSandbox: true) — save the output for comparison.
   - Note the current time (UTC) so the Grafana/Loki window in step 4b is exact.

2. Launch the run DETACHED — it runs longer than foreground Bash allows, and background Bash tasks get reaped on this machine. Use the PowerShell tool with dangerouslyDisableSandbox: true (the sandbox blocks egress to Supabase/Render):

   Start-Process -FilePath "node" -ArgumentList <ARGS> -WorkingDirectory "C:\Users\yulin\GBA\Sound-Clash" -RedirectStandardOutput "C:\Users\yulin\GBA\Sound-Clash\tests\load\results\<LABEL>-console.log" -RedirectStandardError "C:\Users\yulin\GBA\Sound-Clash\tests\load\results\<LABEL>-console.err.log" -WindowStyle Hidden

   (Create tests\load\results first if missing. Console logs live NEXT TO the run dir, not inside it — the harness archives/recreates results/<LABEL>/ at start.)

3. Watch it with the Monitor tool (persistent: false, timeout_ms: 3600000):

   dir="C:/Users/yulin/GBA/Sound-Clash/tests/load/results/<LABEL>"
   prevkey=""
   nofile=0
   while true; do
     if [ ! -f "$dir/status.json" ]; then
       nofile=$((nofile+1))
       if [ "$nofile" -gt 8 ]; then echo "STARTUP FAILED: status.json never appeared after ~2 min — read tests/load/results/<LABEL>-console.err.log"; break; fi
     else
       nofile=0
       line=$(node -e "const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log('phase='+s.phase+' rounds='+s.roundsDone+'/'+s.roundsTotal+' errors='+s.errorCount+' violations='+s.violationCount+' done='+s.done+' verdict='+s.verdict)" "$dir/status.json" 2>/dev/null || echo parse-retry)
       key=$(echo "$line" | sed 's/rounds=[0-9]*/rounds=/')
       if [ "$key" != "$prevkey" ]; then echo "$line"; prevkey="$key"; fi
       case "$line" in *"done=true"*) break;; esac
       now=$(date +%s); mt=$(stat -c %Y "$dir/status.json" 2>/dev/null || echo "$now")
       if [ $((now-mt)) -gt 120 ]; then echo "STALLED: status.json silent for $((now-mt))s — process likely died, check the console log"; break; fi
     fi
     sleep 15
   done

   The setup phase is deliberately slow (REST create/join paced under the backend's per-IP rate limits) — a long "phase=setup" is expected, not a hang.

   While the monitor runs, take one MID-RUN snapshot during the play phase:
   `supabase db query --linked "select state, count(*) from pg_stat_activity group by state order by 2 desc"` — this shows DB connection pressure at peak.

4. When done=true: Read tests/load/results/<LABEL>/report.md. Give me a plain-language summary: overall verdict, the latency table, the Realtime delivery table (including miss rate and subscription failures), invariant violations, and the per-game completion table. If the verdict is FAIL — or anything looks off — read report.json and the console log, and diagnose before summarizing.

4b. Monitoring corroboration (read tests/load/FINDINGS.md "Monitoring notes" first — synthetic runs emit NO Faro telemetry, so don't expect the harness traffic in Loki/Tempo):
   - Grafana MCP: query Loki `{service_name="sound-clash-web"}` over the run window for errors and `stale_buzz_lock_resynced` — anything there means a REAL user/party overlapped the run; note it.
   - Grafana MCP: `list_datasources` — if a Supabase/Prometheus metrics datasource exists (it did not as of 2026-07-14), pull Realtime connection + DB metrics for the window.
   - Compare the pg_stat_activity snapshots (before/mid-run) and include the delta in your summary.
   - The Supabase dashboard's Realtime connection graph can't be read from here; if subscribe failures were reported, tell the user to check the dashboard's Realtime report for the window.

5. Document the outcome in tests/load/FINDINGS.md (this is REQUIRED, even on a clean PASS):
   - Append a row to the "Run ledger" table (date, check, verdict, highlights, findings count).
   - For EVERY violation, unexpected error, WARN-level check, capacity ceiling (e.g. subscribe failures), stall, or harness bug: add a full entry using the file's template, including the report.json figures and any Grafana/pg_stat evidence.
   - Commit on branch `feature/load-test-findings` (create from the current branch if missing, reuse and push if it exists), push, and open a PR titled "Load-test findings: <LABEL>" if none is open for that branch yet (one PR accumulates all four checks). Never commit to main; never merge.

6. If the run STALLED or crashed: read the console/err logs, then run `node tests/load/loadtest.mjs cleanup --dir tests/load/results/<LABEL>` (PowerShell or Bash, sandbox disabled) so no synthetic games linger, document the crash as a finding per step 5, and report the failure.

Do not start any other load check in parallel. Do not modify the harness; if it has a bug, document it in FINDINGS.md and report it.
```

---

## Check 1 — 5 parallel games × 10 teams × 15 rounds

`<LABEL>` = `check1-5x10`, `<ARGS>` =

```
"tests/load/loadtest.mjs","run","--label","check1-5x10","--games","5","--teams","10","--rounds","15","--seed","101","--kick"
```

## Check 2 — 10 parallel games × 10 teams × 15 rounds

`<LABEL>` = `check2-10x10`, `<ARGS>` =

```
"tests/load/loadtest.mjs","run","--label","check2-10x10","--games","10","--teams","10","--rounds","15","--seed","202"
```

## Check 3 — 20 parallel games × 10 teams × 15 rounds

`<LABEL>` = `check3-20x10`, `<ARGS>` =

```
"tests/load/loadtest.mjs","run","--label","check3-20x10","--games","20","--teams","10","--rounds","15","--seed","303"
```

Note for the summary: this check opens 240 Realtime sockets. On the Supabase
free tier the concurrent-connection quota is 200, so subscription failures
here are the expected capacity finding — report how many failed and whether
game correctness still held (it should: game control is RPC-driven, Realtime
is fan-out only).

## Check 4 — 1 game × 30 teams × 15 rounds

`<LABEL>` = `check4-1x30`, `<ARGS>` =

```
"tests/load/loadtest.mjs","run","--label","check4-1x30","--games","1","--teams","30","--rounds","15","--seed","404"
```

Note for the summary: the interesting numbers are the 30-way buzz-race
invariant (exactly one winner, every round) and lock-propagation p95 across
32 subscribed devices.
