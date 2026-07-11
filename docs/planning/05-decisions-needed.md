# 05 — Decision log (all resolved — do not re-litigate)

Every big call the plan needed is **decided** (2026-07-04). This file is the durable record of what was chosen and why, so future sessions don't reopen settled questions. The full option-by-option deliberations live in this file's git history.

| # | Decision | Outcome | Where it lands |
|---|---|---|---|
| D-1 | `manager_token` leak (the one CRITICAL) | ✅ **A** — moved to `game_secrets` table | ✅ shipped: mig 034 / PR #156 |
| D-2 | pre-reveal answer leak | **Accept + document** — the clip is audible to the room anyway; a DB-reading cheat is narrow and self-defeating | Phase 5 T5.8 — `security-rls.md` write-up ✅ **shipped (#208)** |
| D-3 | RPC/Realtime abuse protection | **A** — Cloudflare edge + WAF in front of Supabase REST/Realtime; I-Alert as the cheap first layer | Phase 5 T5.6 — maintainer ops, outside git |
| D-4 | per-team auth (buzz-spoofing) | **Accept the tradeoff** — no per-team tokens; friends don't grief each other, the host is the integrity check | Phase 5 T5.7 — `security-rls.md` write-up ✅ **shipped (#208)** + same-name reclaim (#210) replaces F-P2-1's token fix |
| D-5 | win conditions (target score / round limit) | ❌ **Out of scope for now** — revisit later; would be an optional additive setting (nullable columns mirroring `selected_decades`) | (deferred; rationale in `03-features.md` Tier 4) |
| D-6 | Hebrew (RTL) UI | ❌ **Out of scope for now** — touches all six pages + a translation workflow; revisit if growing the Hebrew audience becomes a goal | (deferred; rationale in `03-features.md` Tier 4) |
| D-7 | scoring authority into the DB | **Yes, carefully** — `award_attempt` takes booleans, computes points server-side; removes the client-typo corruption footgun | Phase 7 T7.1 (own PR, behind the buzz-race gate) |
| D-8 | catalog dedup key | **`UNIQUE(youtube_id)` now**, ISRC as a separate later enrichment | Phase 6 T6.3 (dedup pass first) |
| D-9 | binary assets (SFX, recap card, hero re-encode) | **Small optimized assets in-repo** (`frontend/public/sfx/` etc.) — still confirm each binary at commit time per the repo rule | Phase 8 (X-SFX, X-Recap) |

## Consequences already folded into the plan

- **D-4** killed X-Reclaim (the token version); the lightweight **same-name reclaim** (join with the same name → return the existing team row) replaces it in Phase 5 T5.7.
- **D-2 and D-4 "accept + document" — ✅ document halves shipped.** The `security-rls.md` buzz-spoofing (D-4) and pre-reveal-leak (D-2) tradeoff write-ups landed in T5.7/T5.8 (#208, #210). Both decisions are fully closed.
- **D-1 is fully closed** (mig 034); Phase 5's remaining items build on it.

## Still needs a flag before doing (repo rules, not decisions)

CI/workflow edits (T-RLSCI, T-BundleBudget, T-e2eGate), new dependencies, binary-asset commits (D-9 confirms per commit), prod infra changes, and prod migrations — quick heads-up in the PR / to the maintainer, per `.claude/rules/` and the [EXECUTION-CONTRACT](phases/EXECUTION-CONTRACT.md).

**Everything else in `01`–`04`: autonomous** — branch, build, test, PR, gate.
