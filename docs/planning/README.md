# Sound Clash — Improvement Plan

This directory is the durable plan for taking Sound Clash from "a nice game that works" to **production-perfect: fast, smooth, resilient, and lag-free**. It is the memory that carries across Claude Code sessions — and since the 2026-07 reorg it is also the **only** roadmap (the original build roadmap/tasks shipped 100% and were removed; they live in git history).

Built 2026-07-03/04 from a multi-agent review (11 subsystem maps + adversarial verification; 267 findings + 241 ideas consolidated here), re-validated against the code on 2026-07-07.

## The north star

Make the game **load fast, respond instantly, and never lag** — every button, every screen, every round — and be genuinely production-ready. The hard `<200ms` buzz-to-lock is network-bound (Supabase Frankfurt + Realtime fan-out), so "speed" work is really **time-to-playable** and **perceived smoothness** — which is what a user feels as fast. Items are tagged `buzz-latency` / `load` / `smoothness` so a paint fix is never mis-sold as a latency fix.

## Files

| File | What it holds |
|---|---|
| [NEXT-SESSION.md](NEXT-SESSION.md) | **Start here** — ready-to-paste handoff for the next session (current state + next tasks + env traps) |
| [phases/EXECUTION-CONTRACT.md](phases/EXECUTION-CONTRACT.md) | **Process** (the single process doc): session protocol, per-PR loop, merge authorization, exit gates, workflow policy |
| [00-current-state.md](00-current-state.md) | How the whole system works + the review's conclusions (dated snapshot, 2026-07-04) |
| [01-fixes.md](01-fixes.md) | Confirmed bugs, ranked P0/P1/P2, with evidence + fix sketch |
| [02-improvements.md](02-improvements.md) | Resilience + ops improvements (perf sections §A–§C shipped and were pruned) |
| [03-features.md](03-features.md) | New feature candidates, ranked by party-night impact vs cost (+ the maintainer-led catalog work) |
| [04-tech-debt.md](04-tech-debt.md) | Code quality, tests, CI, residual docs drift, repo hygiene |
| [05-decisions-needed.md](05-decisions-needed.md) | **Decision log — all resolved**; don't re-litigate |
| [phases/README.md](phases/README.md) | The execution roadmap: ordered phases, each with tasks → subtasks → exit gate |
| `phases/phase-N-*.md` | Per-phase detail (phases 1–3 done and removed) |

`01`–`04` are the **backlog by category** (what + why + evidence). `phases/` **sequences** that backlog into execution order with exit gates. The phase file is the source of truth for *when* and *done-ness*.

## Status snapshot

_Updated: 2026-07-08 (planning reorg — every claim below re-verified against code/git)._

| Phase | Theme | State |
|---|---|---|
| — | Planning + review | ✅ done |
| 1 | Perf: load & time-to-playable | ✅ done (PRs #150–#158; exit gate passed 2026-07-05) |
| 2 | Perf: perceived smoothness & buttons | ✅ done (PRs #159–#165; exit gate passed 2026-07-05) |
| 3 | Perf: backend-path & Realtime economics | ✅ done (PRs #166–#174; mig 035–038 live; −27.5% Realtime msgs) |
| 4 | Resilience: mid-game failure modes | ⏳ **in progress** — T4.0 ✅ #185, T4.2 ✅ #187, T4.1 de-scoped #186, T4.9 pre-shipped #163; **T4.3 next**, then T4.4–T4.11 |
| 5 | Security & abuse hardening | ready — critical D-1 already shipped (mig 034); T5.3 done; rest is small guards + owed docs + maintainer ops (T5.6) |
| 6 | Correctness & docs hygiene | ready — scope shrank on re-verify: one small doc-sync PR + two migrations (T6.2/T6.3) |
| 7 | Tech-debt & test hardening | ready — T-KeepWarm/T-DocRPC turned out done; the rest verified open |
| 8 | Features | ready — Tier 1–3 in scope (X-Skip declined); D-5/D-6 out of scope |

**Pre-event validation (2026-07-05/06):** a 10-team/40-person live-prod pass + a DB-verified 10-team/30-round e2e found two display-scaling bugs, both fixed and shipped (PRs #176/#178). No open blockers. The reusable checklist now lives at [`docs/pre-event-checklist.md`](../pre-event-checklist.md).

**Maintainer-only carryovers (can't be closed by a coding session):** T1.7 Grafana Realtime alerts (+ I-Vitals dashboard); D-3/T5.6 Cloudflare edge + WAF; optional DB-password/`sb_secret_` rotation; merging the open Dependabot PRs (#133, #114, #147, #182); finishing the song-curation batch (Hebrew + soundtracks — see `03-features.md` §Content).

**Next action:** Phase 4 **T4.3** (hydrate/queue robustness — the highest-value remaining bug). See [NEXT-SESSION.md](NEXT-SESSION.md) for the ready-to-paste kickoff, or run the local `/next-task` skill.

## The one rule

Every phase ends with the **Full-Game Exit Gate** ([EXECUTION-CONTRACT.md](phases/EXECUTION-CONTRACT.md) §5): no phase is "done" until a complete game plays end-to-end — create → join → buzz → score → bonus → end → export — on real production, with Hebrew titles rendering and no console errors. This is a live app; a broken Saturday-night game outweighs any missing feature.
