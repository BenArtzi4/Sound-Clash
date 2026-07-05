# Sound Clash — Improvement Plan

This directory is the durable plan for taking Sound Clash from "a nice game that works" to **production-perfect: fast, smooth, resilient, and lag-free**. It is the memory that carries across Claude Code sessions.

Built 2026-07-03/04 from a multi-agent review: 11 subsystem maps + cross-cutting performance/concurrency/resilience/security/quality hunts + adversarial verification + a completeness critic. Raw evidence base: 267 findings + 241 ideas, consolidated here.

## The north star

The maintainer's stated goal: make the game **load fast, respond instantly, and never lag** — every button, every screen, every round — and be genuinely production-ready. Performance and smoothness are the top theme; correctness, resilience, and security are the guardrails that make "fast" also mean "trustworthy on a Saturday night."

**One honest reframing from the review** (drives how we prioritize): the hard `<200ms` buzz-to-lock is bounded by network round-trip to Supabase (Frankfurt) + Realtime fan-out — it is *not* paint/JS/bundle bound. So most of our "speed" wins are really **time-to-playable (load)** and **perceived smoothness (buttons/animations/no-jank)**, which is exactly what a user *feels* as "fast" or "laggy." We label each item as `buzz-latency`, `load`, or `smoothness` so we never mis-sell a paint fix as a latency fix.

## Files

| File | What it holds |
|---|---|
| [execution-playbook.md](execution-playbook.md) | **Process**: session protocol, git/PR mechanics, when to use ultracode workflows, the exit-gate definitions |
| [00-current-state.md](00-current-state.md) | How the whole system works today + the review's headline conclusions |
| [01-fixes.md](01-fixes.md) | Confirmed bugs, ranked P0/P1/P2, with evidence + fix sketch |
| [02-improvements.md](02-improvements.md) | Performance (load + smoothness + backend-path) and resilience improvements |
| [03-features.md](03-features.md) | New feature candidates, ranked by party-night impact vs cost |
| [04-tech-debt.md](04-tech-debt.md) | Code quality, tests, CI, docs drift, repo hygiene |
| [05-decisions-needed.md](05-decisions-needed.md) | **Big changes that need your call before any code** |
| [phases/README.md](phases/README.md) | The execution roadmap: ordered phases, each with tasks → subtasks → exit gate |
| `phases/phase-N-*.md` | Per-phase detail |

`01`–`04` are the **backlog by category** (what + why + evidence). `phases/` **sequences** that backlog into execution order with exit gates. Same item may appear in both; the phase file is the source of truth for *when* and *done-ness*.

## Status snapshot

_Updated: 2026-07-05 — Phase 3 ✅ COMPLETE (PRs #166–#173; migrations 035–038 applied + verified on prod). Removed every wasted write/event on the hot path: the per-buzz `game_rounds` fan-out is gone and a scripted 6-team/5-round game drops 872 → 632 Realtime messages (−27.5%). Full-Game Exit Gate passed on prod (driven three-tab game TXYK9D: create→join×2→start→buzz-lock→score→Continue→artist→Next→Bonus→End→export; Hebrew rendered on manager + display; zero app-console errors; buzz 154/222 ms). Phase 2 ✅ (PRs #159–#164), Phase 1 ✅ (PRs #150–#158). Phase 4 next._

**Decisions resolved:** D-1 → move token to a secret table; D-3 → Cloudflare edge + WAF; D-4 → accept buzz-spoofing (no per-team tokens; same-name reclaim instead); D-5 & D-6 (win conditions, Hebrew i18n) → out of scope for now; D-2/D-7/D-8/D-9 → proceed on recommendations.

| Phase | Theme | State |
|---|---|---|
| — | Planning + review | ✅ done (this directory) |
| 1 | Performance: load & time-to-playable | ✅ done (PRs #150–#157; D-1 live; exit gate passed 2026-07-05) |
| 2 | Performance: perceived smoothness & buttons | ✅ done (PRs #159–#164; exit gate passed on prod 2026-07-05, incl. maintainer feel-check) |
| 3 | Performance: backend-path & Realtime economics | ✅ done (PRs #166–#173; mig 035–038 live; −27.5% Realtime messages; exit gate passed on prod 2026-07-05) |
| 4 | Resilience: mid-game failure modes | ⏳ ready (autonomous) |
| 5 | Security & abuse hardening | ⏳ ready — decisions resolved; D-1 first |
| 6 | Correctness & docs/data-model hygiene | ⏳ ready (autonomous) |
| 7 | Tech-debt & test hardening | ⏳ ready (autonomous) |
| 8 | Features | ⏳ ready (Tier-1/2/3 in scope; Tier-4 deferred) |

**Next action:** execute **Phase 4** (resilience: mid-game failure modes — autonomous). Phase 3 (backend-path & Realtime economics) shipped as PRs #166–#173 with migrations 035–038 applied + verified on prod, and passed its Full-Game Exit Gate on prod; the item deferred from Phase 2, `I-NextMeta` (peek RPC now returns title/artist/is_soundtrack, rendered in-gesture on the Next-round fast path), landed in PR #172. Recommended order from here: 4, interleaving 6/7; 5 and 8 proceed per the resolved decisions. Carryover maintainer follow-ups from Phase 1 remain (Grafana/Supabase Realtime alerts; optional DB-password/`sb_secret_` rotation).

## The one rule

Every phase ends with the **Full-Game Exit Gate** (see execution-playbook §6): no phase is "done" until a complete game plays end-to-end — create → join → buzz → score → bonus → end → export — on real production, with Hebrew titles rendering and no console errors. This is a live app; a broken Saturday-night game outweighs any missing feature.
