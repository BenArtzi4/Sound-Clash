# Phase 5 — Security & Abuse Hardening

**Goal:** close the one critical hole (`manager_token` leak) and decide the realistic posture for the rest, appropriate to a free party game with no PII beyond team names.

**Decisions resolved (2026-07-04):** D-1 → **A** (secret table), D-3 → **A** (Cloudflare edge + WAF), D-4 → **accept** (no per-team tokens), D-2 → **accept + document**. D-1 is the one true critical — ship it first, ideally alongside Phase 1. The autonomous sub-items below can proceed anytime.

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

## Decision-resolved tasks (per §05, 2026-07-04)

### T5.5 · Fix the `manager_token` leak `[M]` — **D-1 = A** (CRITICAL, do first)
- [ ] Migration moving `manager_token` to a `game_secrets(game_id, manager_token)` table with no anon SELECT/grant; keep `active_games` clean of the token.
- [ ] `POST /games` writes/reads the token via the service-role client; `useGameChannel` selects explicit columns (no `select('*')`).
- [ ] Verify the token no longer appears in any anon REST read or Realtime payload (sniff test with only the anon key).
- [ ] Update `security-rls.md` + `data-model.md`.

### T5.6 · Cloudflare edge + WAF in front of Supabase `[infra]` — **D-3 = A**
- [ ] Front the Supabase REST + Realtime hostnames with the existing Cloudflare edge (proxy or Worker): per-IP rate limits, a WAF rule blocking bulk `select=*` on `active_games`/`game_teams`/`game_rounds`, DDoS mitigation.
- [ ] Keep I-Alert (Phase 1) as the cheap first layer + Realtime connection caps on Supabase.
- [ ] **Infra + DNS work, largely outside git** — plan it as an ops task; validate that buzz latency is unaffected by the extra hop (measure buzz p95 before/after — the proxy must not blow the <200ms budget).

### T5.7 · Document the accepted buzz-spoofing tradeoff `[S]` — **D-4 = accept**
- [ ] No per-team tokens. Document in `security-rls.md` that buzzing is unauthenticated by design (casual play) and the host is the integrity check.
- [ ] Implement the lightweight **same-name reclaim** for F-P2-1: `join_team` returns the existing team row when the same name rejoins the same game (no new token). Coordinate with the frontend redirect logic.

### T5.8 · Pre-reveal answer leak `[architecture]` — **D-2 = accept + document**
- [ ] Document the tradeoff in `security-rls.md` (the clip is audible to the room anyway; a DB-reading cheat is narrow and self-defeating). No code redesign for now.

---

## Exit gate (Phase 5)
- [ ] `/security-review` (or the security skill) run on the diff — no new findings.
- [ ] RLS test suite green (isolated), extended to the new/changed tables.
- [ ] Sniff test: with only the anon key, `manager_token` is unreachable via REST and Realtime.
- [ ] Cloudflare WAF/rate-limit rules live; a bulk `select=*` on the ephemeral tables is blocked; buzz p95 unaffected by the edge hop.
- [ ] **Ultracode re-verify workflow:** re-run the adversarial abuse/security hunt against the patched code; confirm D-1 closed and the accepted risks (D-2, D-4) are documented, not silently ignored.
- [ ] **Full-Game Exit Gate** — host actions still work end to end with the relocated token; buzzing + same-name reclaim work; the edge proxy doesn't break Realtime or the buzz path.
