# Phase 3 — Performance: Backend-path & Realtime Economics

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md). **Touches PL/pgSQL — the buzz-race test is the hard gate after every RPC edit.** One idempotent migration per change; update `rpc-functions.md` + `data-model.md` in the same PR.
**PR split:** (A) drop the dead `game_rounds` UPDATE from `buzz_in`; (B) collapse `award_attempt` writes + `RETURNING`; (C) drop `game_round_attempts` from the Realtime publication + add its RLS; (D) trim the 20s resync + teardown-on-`gone`; (E) keep-warm timing + the T-KeepWarm decision.
**Measure:** Realtime message count for a scripted 6-team/5-round game before/after. **Workflow:** only the gate audit.

**Goal:** remove every wasted write, event, and query on the hot path — halving buzz-path Realtime fan-out and cutting per-click DB work — without touching the atomic buzz core's correctness.

**Why:** free-tier quotas and per-client re-render cost scale with events. These are pure-waste removals with high leverage. **Careful:** touches PL/pgSQL — gated by the buzz-race test every step.

**Backlog refs:** `02-improvements.md §C` + schema items T-AttemptsPub / (T-AttemptsRLS pairs here).

**Session shape:** single session, but each RPC edit is its own idempotent migration + `CREATE OR REPLACE`, tested against a local `supabase start` stack and the buzz-race test before the next. Docs (`rpc-functions.md`, `data-model.md`) updated in the same PR (repo rule).

---

## Tasks

### T3.1 · Drop the dead `game_rounds` UPDATE from `buzz_in` `[S]` — `I-Buzz1UPDATE`
- [ ] New migration: `CREATE OR REPLACE FUNCTION buzz_in(...)` identical minus the `UPDATE game_rounds SET buzzed_team_id = ...` (mig 011 mirror). Signature unchanged (PostgREST routing stable).
- [ ] Confirm no consumer reads `game_rounds.buzzed_team_id` (grep: only `roundEqual` compares it — safe once we stop writing it; adjust the comparison if needed).
- [ ] Update `docs/rpc-functions.md:46-47` and `data-model.md`.
- [ ] **Buzz-race test must stay green** (10 concurrent → 1 winner, looped). This is the headline gate.

### T3.2 · Collapse `award_attempt` writes `[S]` — `I-Award1UPDATE`
- [ ] `CREATE OR REPLACE`: merge the title/artist/wrong/free_guess `UPDATE game_rounds` statements into one combined UPDATE computed from branch vars; skip the `free_guess` write when unchanged.
- [ ] Replace the two trailing `SELECT`s (`021:194`) with `UPDATE … RETURNING`.
- [ ] Keep the 6-arg tokenised signature exactly (no DEFAULT — see the mig-021 overload lesson).
- [ ] Tests: `tests/db/test_award_attempt.py` scenarios (title, artist, soundtrack, wrong, free-guess) still assert correct scores + returned row.

### T3.3 · Remove `game_round_attempts` from the Realtime publication `[S]` — `I-AttemptsPub`
- [ ] Migration: `ALTER PUBLICATION supabase_realtime DROP TABLE game_round_attempts;` (idempotent guard).
- [ ] While here: `ENABLE ROW LEVEL SECURITY` + revoke anon on the table (T-AttemptsRLS) and extend RLS tests (T-RLSFix scope).
- [ ] Note in `03-features.md` X-Streaks that re-adding it to the publication is part of *that* feature, done deliberately.

### T3.4 · Trim the REST re-sync `[S]` — `I-Resync`
- [ ] `useGameChannel`: lengthen the 20s cadence (~60s) or only resync when `status==='reconnecting'`.
- [ ] Tear down the interval + `removeChannel` once `status==='gone'` (stops an overnight display polling forever).
- [ ] Test the teardown and the reconnect-triggered resync.

### T3.5 · Keep-warm timing `[S]` — `I-Warm` (+ decide T-KeepWarm)
- [ ] Ping `/health` on mount and on `visibilitychange → visible`.
- [ ] **Decide** (T-KeepWarm): given the 24/7 cron keepalive, either delete the hook or keep it as a documented fallback. Implement the chosen option; document why in the hook + `free-tier-budget.md`.

### T3.6 · (optional) `award_attempt` RETURNING cleanup `[S/low]`
- [ ] Fold the response-building SELECTs into RETURNING (subsumed by T3.2 if done together).

---

## Decisions touched
- **T-KeepWarm** (T3.5) is a small design call, not a blocker — recommend keeping as a documented visibility-aware fallback.
- **D-7 (scoring authority)** is *related* to `award_attempt` but is deferred to Phase 7 so we don't overload this phase's RPC edits. If you'd rather touch `award_attempt` once, we can pull D-7 forward into T3.2 — ask.

## Exit gate (Phase 3)
- [ ] **Buzz-race test green** (the non-negotiable gate) after T3.1.
- [ ] `tests/db` full pass; `award_attempt` scenarios green after T3.2; RLS suite (isolated) green after T3.3.
- [ ] Migrations idempotent (CI applies twice).
- [ ] Docs (`rpc-functions.md`, `data-model.md`) match the new function bodies in the same PR.
- [ ] **Measurable:** capture Realtime message count for a scripted 6-team, 5-round game before/after — expect a clear drop (fewer events per buzz + per award).
- [ ] **Full-Game Exit Gate** on production, buzz still feels instant.
