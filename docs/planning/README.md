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

_Updated: 2026-07-10 (Phase 4 ✅ done — exit gate passed; every other claim below re-verified against code/git during the 2026-07-08 reorg)._

| Phase | Theme | State |
|---|---|---|
| — | Planning + review | ✅ done |
| 1 | Perf: load & time-to-playable | ✅ done (PRs #150–#158; exit gate passed 2026-07-05) |
| 2 | Perf: perceived smoothness & buttons | ✅ done (PRs #159–#165; exit gate passed 2026-07-05) |
| 3 | Perf: backend-path & Realtime economics | ✅ done (PRs #166–#174; mig 035–038 live; −27.5% Realtime msgs) |
| 4 | Resilience: mid-game failure modes | ✅ done (PRs #185–#197; T4.1 de-scoped, T4.9 pre-shipped; exit gate passed 2026-07-10) |
| 5 | Security & abuse hardening | ✅ code done (D-1/mig034, T5.3, T5.7, T5.2/#229, T5.4/#230); only **T5.6** Cloudflare (infra) + **T5.1** CSV guard (off-limits tooling) remain — both maintainer-gated |
| 6 | Correctness & docs hygiene | ✅ done (T6.1/#199, T6.2/#200/#203, T6.3/#216) |
| 7 | Tech-debt & test hardening | ✅ done (T7.1–T7.6; exit gate passed 2026-07-11; T7.6/#232) |
| 8 | Features | ready — Tier 1–3 in scope (X-Skip declined); D-5/D-6 out of scope — **needs maintainer direction + honors the standing vetoes** |

**Pre-event validation (2026-07-05/06):** a 10-team/40-person live-prod pass + a DB-verified 10-team/30-round e2e found two display-scaling bugs, both fixed and shipped (PRs #176/#178). No open blockers. The reusable checklist now lives at [`docs/pre-event-checklist.md`](../pre-event-checklist.md).

**Maintainer-only carryovers (can't be closed by a coding session):** T1.7 Grafana Realtime alerts (+ I-Vitals dashboard); D-3/T5.6 Cloudflare edge + WAF; optional DB-password/`sb_secret_` rotation; merging the open Dependabot PRs (#133, #114, #147, #182); finishing the song-curation batch (Hebrew + soundtracks — see `03-features.md` §Content).

**Next action:** **Phases 1–7 are ✅ complete.** What remains is **not autonomously closable** by a coding session: **Phase 8** features (needs maintainer direction + the standing vetoes) and maintainer-gated infra/ops (T5.6 Cloudflare, T1.7 Grafana, T5.1 CSV guard on off-limits tooling, song curation, secret rotation). See **[MAINTAINER-GATED-TASKS.md](MAINTAINER-GATED-TASKS.md)** for the full breakdown and [NEXT-SESSION.md](NEXT-SESSION.md) for the latest handoff.

## The one rule

Every phase ends with the **Full-Game Exit Gate** ([EXECUTION-CONTRACT.md](phases/EXECUTION-CONTRACT.md) §5): no phase is "done" until a complete game plays end-to-end — create → join → buzz → score → bonus → end → export — on real production, with Hebrew titles rendering and no console errors. This is a live app; a broken Saturday-night game outweighs any missing feature.
