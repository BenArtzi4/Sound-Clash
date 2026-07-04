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

_Updated: 2026-07-04 — planning complete; all 9 big-change decisions resolved (§05). Ready to execute._

**Decisions resolved:** D-1 → move token to a secret table; D-3 → Cloudflare edge + WAF; D-4 → accept buzz-spoofing (no per-team tokens; same-name reclaim instead); D-5 & D-6 (win conditions, Hebrew i18n) → out of scope for now; D-2/D-7/D-8/D-9 → proceed on recommendations.

| Phase | Theme | State |
|---|---|---|
| — | Planning + review | ✅ done (this directory) |
| 1 | Performance: load & time-to-playable | ⏳ ready to start (autonomous) |
| 2 | Performance: perceived smoothness & buttons | ⏳ ready (autonomous) |
| 3 | Performance: backend-path & Realtime economics | ⏳ ready (autonomous, touches RPCs) |
| 4 | Resilience: mid-game failure modes | ⏳ ready (autonomous) |
| 5 | Security & abuse hardening | ⏳ ready — decisions resolved; D-1 first |
| 6 | Correctness & docs/data-model hygiene | ⏳ ready (autonomous) |
| 7 | Tech-debt & test hardening | ⏳ ready (autonomous) |
| 8 | Features | ⏳ ready (Tier-1/2/3 in scope; Tier-4 deferred) |

**Next action:** execute Phase 1 (load) — and ship D-1 (token secret table) early alongside it as the one critical fix. Recommended order: 1 → 2 → 3 → 4, interleaving 6/7; 5 and 8 proceed per the resolved decisions.

## The one rule

Every phase ends with the **Full-Game Exit Gate** (see execution-playbook §6): no phase is "done" until a complete game plays end-to-end — create → join → buzz → score → bonus → end → export — on real production, with Hebrew titles rendering and no console errors. This is a live app; a broken Saturday-night game outweighs any missing feature.
