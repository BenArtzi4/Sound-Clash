# Phase 5 — Security & Abuse Hardening

**Goal:** close the one critical hole (`manager_token` leak) and decide the realistic posture for the rest, appropriate to a free party game with no PII beyond team names.

**Blocking:** the big items need decisions **D-1..D-4** (`05-decisions-needed.md`). D-1 is the one true critical — decide and ship it first, ideally alongside Phase 1. The autonomous sub-items below can proceed anytime.

**Backlog refs:** F-P0-1, F-P2-4 (`01`), the three security hunt findings, D-1..D-4.

**Session shape:** the fixes are single-session. After they land, run an **ultracode workflow to re-verify** the holes are closed (re-run the adversarial security hunt against the patched code).

---

## Autonomous sub-items (no decision needed)

### T5.1 · CSV formula-injection guard `[S]` — F-P2-4
- [ ] In both `add-songs.html:420` and `review.js:403` `csvCell`: prefix a leading `'` (or force-quote) when a cell starts with `= + - @ \t \r`. Mirrored one-liner. Tooling-only.

### T5.2 · Team-name guard on join `[S]` — extra_idea
- [ ] Length cap + basic profanity/emoji filter in `join_team` (`games.py:104`) before insert. Names show on the projector and persist durably in `game_history`; a lightweight guard prevents ugly display + permanent inappropriate records.

### T5.3 · `game_round_attempts` RLS `[S]` — T-AttemptsRLS (also in Phase 3)
- [ ] `ENABLE ROW LEVEL SECURITY` + revoke anon; extend the RLS test suite. (If Phase 3 ran first, this is done.)

### T5.4 · `game_history` retention/PII `[S–M]` — extra_finding
- [ ] Add a retention sweep or anonymize team names on archive (they're currently kept indefinitely, unlike the 4h ephemeral tables). Decide retention window with the maintainer if non-obvious.

## Decision-gated tasks

### T5.5 · Fix the `manager_token` leak `[M]` — **D-1** (CRITICAL, do first)
- [ ] Per D-1 choice (recommended A): migration moving `manager_token` to a `game_secrets` table with no anon SELECT; `useGameChannel` selects explicit columns (no `*`).
- [ ] Verify the token no longer appears in any anon REST read or Realtime payload (sniff test).
- [ ] Update `security-rls.md` + `data-model.md`.

### T5.6 · Direct-RPC / Realtime abuse protection `[infra]` — **D-3**
- [ ] Per D-3 choice: Cloudflare edge in front of Supabase REST/Realtime (rate limits + WAF blocking bulk `select=*`), and/or Supabase connection caps; plus I-Alert (done in Phase 1).

### T5.7 · Per-team authentication `[M/L]` — **D-4** (+ builds X-Reclaim)
- [ ] Per D-4 choice: per-team join secret validated inside `buzz_in`; enables team reclaim (F-P2-1). Coordinate the join-contract change with the frontend.

### T5.8 · Pre-reveal answer leak `[architecture]` — **D-2** (recommended: accept + document)
- [ ] If accepting: document the tradeoff in `security-rls.md`. If hardening: the SECURITY DEFINER reveal-RPC redesign.

---

## Exit gate (Phase 5)
- [ ] `/security-review` (or the security skill) run on the diff — no new findings.
- [ ] RLS test suite green (isolated), extended to the new/changed tables.
- [ ] Sniff test: with only the anon key, `manager_token` is unreachable via REST and Realtime.
- [ ] **Ultracode re-verify workflow:** re-run the adversarial abuse/security hunt against the patched code; confirm D-1 closed and the accepted risks (D-2/D-3-now) are documented, not silently ignored.
- [ ] **Full-Game Exit Gate** — host actions still work end to end with the relocated token; buzzing still works with per-team auth (if D-4 taken).
