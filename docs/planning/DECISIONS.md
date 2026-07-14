# Decision log (all resolved — do not re-litigate)

Every big call the plan needed is **decided** (2026-07-04). This file is the durable record of what was chosen and why, so future sessions don't reopen settled questions. The full option-by-option deliberations live in this file's git history (as `05-decisions-needed.md`).

| # | Decision | Outcome | Where it landed |
|---|---|---|---|
| D-1 | `manager_token` leak (the one CRITICAL) | ✅ **A** — moved to `game_secrets` table | ✅ shipped: mig 034 / PR #156 |
| D-2 | pre-reveal answer leak | **Accept + document** — the clip is audible to the room anyway; a DB-reading cheat is narrow and self-defeating | ✅ shipped: `security-rls.md` write-up (#208) |
| D-3 | RPC/Realtime abuse protection | **A** — Cloudflare edge + WAF in front of Supabase REST/Realtime; I-Alert as the cheap first layer | open — maintainer ops, outside git ([TASKS.md](TASKS.md) §C) |
| D-4 | per-team auth (buzz-spoofing) | **Accept the tradeoff** — no per-team tokens; friends don't grief each other, the host is the integrity check | ✅ shipped: `security-rls.md` write-up (#208) + same-name reclaim (#210) + host-only rejoin (#260) |
| D-5 | win conditions (target score / round limit) | ❌ **Out of scope for now** — revisit later; would be an optional additive setting (nullable columns mirroring `selected_decades`) | deferred; rationale in [TASKS.md](TASKS.md) §A |
| D-6 | Hebrew (RTL) UI | ❌ **Out of scope for now** — touches all six pages + a translation workflow; revisit if growing the Hebrew audience becomes a goal | deferred; rationale in [TASKS.md](TASKS.md) §A |
| D-7 | scoring authority into the DB | **Yes, carefully** — `award_attempt` takes booleans, computes points server-side; removes the client-typo corruption footgun | ✅ shipped: migs 043/044 / PRs #218/#220 |
| D-8 | catalog dedup key | **`UNIQUE(youtube_id)` now**, ISRC as a separate later enrichment | ✅ shipped: mig 042 / PR #216 (prod was already dupe-free) |
| D-9 | binary assets (SFX, recap card, hero re-encode) | **Small optimized assets in-repo** (`frontend/public/sfx/` etc.) — still confirm each binary at commit time per the repo rule | open — applies to X-SFX / X-Recap ([TASKS.md](TASKS.md) §A) |

## Consequences already folded into the plan

- **D-4** killed X-Reclaim (the player-held token version); the lightweight **same-name reclaim** (#210) plus the **host-only** secure rejoin (#183/PR #260, mig 046 `team_secrets`) replaced it — D-4's posture unchanged.
- **D-2 and D-4 "accept + document" — ✅ document halves shipped** (`security-rls.md`, #208/#210). Both decisions are fully closed.
- **D-1 is fully closed** (mig 034).

## Still needs a flag before doing (repo rules, not decisions)

CI/workflow edits, new dependencies, binary-asset commits (D-9 confirms per commit), prod infra changes, and prod migrations — quick heads-up in the PR / to the maintainer, per `.claude/rules/` and the [EXECUTION-CONTRACT](EXECUTION-CONTRACT.md).

**Everything else: autonomous** — branch, build, test, PR, gate.
