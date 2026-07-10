# Phase 5 — Security & Abuse Hardening

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md). **Decisions resolved:** D-1 = secret table (✅ **shipped**, mig 034/PR #156), D-3 = Cloudflare edge + WAF (**infra/DNS, mostly outside git — plan as an ops hand-off**), D-4 = accept + same-name reclaim, D-2 = accept + document.
**PR/task order:** T5.1 CSV guard, T5.2 name filter, T5.7 same-name reclaim + document spoofing, T5.8 document answer-leak, T5.4 history retention; T5.6 Cloudflare = ops task with the maintainer. (T5.3 and T5.5 already shipped — see below.)
**Workflow:** run the **ultracode security re-verify** (adversarial abuse hunt) against the patched code at the gate to confirm D-1 is closed and accepted risks are documented.

**Goal:** the one critical hole (`manager_token` leak) is **closed** (D-1/T5.5, mig 034). What remains: implement the small hardening items, write the accepted-tradeoff documentation the D-2/D-4 resolutions promised (still absent from `security-rls.md` — verified 2026-07-07), and hand the Cloudflare edge to the maintainer as ops.

**Backlog refs:** F-P2-1, F-P2-4 (`01`), the security hunt findings, D-1..D-4 (all resolved — see `05`).

**Session shape:** the fixes are single-session. After they land, run an **ultracode workflow to re-verify** the holes are closed (re-run the adversarial security hunt against the patched code).

---

## Autonomous sub-items (no decision needed)

### T5.1 · CSV formula-injection guard `[S]` — F-P2-4
- [ ] In both `add-songs.html:420` and `review.js:403` `csvCell`: prefix a leading `'` (or force-quote) when a cell starts with `= + - @ \t \r`. Mirrored one-liner. Tooling-only.

### T5.2 · Team-name guard on join `[S]` — extra_idea
- [ ] Basic profanity/emoji filter in `join_team` before insert (the 1–30 length cap already exists via the pydantic `TeamName` constraint). Names show on the projector and persist durably in `game_history`; a lightweight guard prevents ugly display + permanent inappropriate records.

### T5.3 · `game_round_attempts` RLS `[S]` — T-AttemptsRLS
- [x] ✅ **Shipped in Phase 3** (mig 037 / PR #168): RLS enabled, anon/authenticated revoked, table dropped from the Realtime publication; RLS suite covers it.

### T5.4 · `game_history` retention/PII `[S–M]` — extra_finding
- [ ] Add a retention sweep or anonymize team names on archive (they're currently kept indefinitely, unlike the 4h ephemeral tables). Decide retention window with the maintainer if non-obvious.

## Decision-resolved tasks (per §05, 2026-07-04)

### T5.5 · Fix the `manager_token` leak `[M]` — **D-1 = A** (the one CRITICAL)
- [x] ✅ **Shipped in Phase 1** (mig 034 / PR #156): `game_secrets(game_id, manager_token)` with no anon grant; `POST /games` reads the token via service-role; `useGameChannel` selects explicit columns; `security-rls.md` updated. The exit-gate sniff test (anon key can't reach the token via REST or Realtime) still runs at the phase gate as regression proof.

### T5.6 · Cloudflare edge + WAF in front of Supabase `[infra]` — **D-3 = A**
- [ ] Front the Supabase REST + Realtime hostnames with the existing Cloudflare edge (proxy or Worker): per-IP rate limits, a WAF rule blocking bulk `select=*` on `active_games`/`game_teams`/`game_rounds`, DDoS mitigation.
- [ ] Keep I-Alert (Phase 1) as the cheap first layer + Realtime connection caps on Supabase.
- [ ] **Infra + DNS work, largely outside git** — plan it as an ops task; validate that buzz latency is unaffected by the extra hop (measure buzz p95 before/after — the proxy must not blow the <200ms budget).

### T5.7 · Document the accepted buzz-spoofing tradeoff `[S]` — **D-4 = accept**
- [x] ✅ No per-team tokens. Documented in `security-rls.md` §4 ("Accepted design tradeoffs") that buzzing is unauthenticated by design (casual play) and the host is the integrity check.
- [x] ✅ Implemented the lightweight **same-name reclaim** for F-P2-1: `_join_team_blocking` SELECTs the existing `(game_code, name)` row and returns it (same id, preserved score) before inserting, so a rejoin resumes the same team instead of 409/duplicating. No frontend change needed — the returned team row flows through the existing store-and-redirect path unchanged. Backend tests + docs (`api-contracts.md`, `security-rls.md` §4, `game-rules.md`) updated.

### T5.8 · Pre-reveal answer leak `[architecture]` — **D-2 = accept + document**
- [x] ✅ Documented the tradeoff in `security-rls.md` §4 ("Accepted design tradeoffs") — the clip is audible to the room anyway; a DB-reading cheat is narrow and self-defeating. No code redesign.

---

## Exit gate (Phase 5)
- [ ] `/security-review` (or the security skill) run on the diff — no new findings.
- [ ] RLS test suite green (isolated), extended to the new/changed tables.
- [ ] Sniff test: with only the anon key, `manager_token` is unreachable via REST and Realtime.
- [ ] Cloudflare WAF/rate-limit rules live; a bulk `select=*` on the ephemeral tables is blocked; buzz p95 unaffected by the edge hop.
- [ ] **Ultracode re-verify workflow:** re-run the adversarial abuse/security hunt against the patched code; confirm D-1 closed and the accepted risks (D-2, D-4) are documented, not silently ignored.
- [ ] **Full-Game Exit Gate** — host actions still work end to end with the relocated token; buzzing + same-name reclaim work; the edge proxy doesn't break Realtime or the buzz path.
