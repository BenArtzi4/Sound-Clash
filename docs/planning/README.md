# Sound Clash — Improvement Plan

This directory is the durable plan-and-status memory that carries across Claude Code sessions. The original build roadmap shipped 100%, and the improvement plan's completed artifacts — the per-category backlog files, the phase files for phases 1–7, and the `phases/` directory itself — were removed once every item in them was verified shipped (2026-07-14, 5-agent code audit). Their detail lives in git history and `CHANGELOG.md`.

## The north star

Make the game **load fast, respond instantly, and never lag** — every button, every screen, every round — and be genuinely production-ready. The hard `<200ms` buzz-to-lock is network-bound (Supabase Frankfurt + Realtime fan-out), so "speed" work is really **time-to-playable** and **perceived smoothness**.

## Files

| File | What it holds |
|---|---|
| [NEXT-SESSION.md](NEXT-SESSION.md) | **Start here** — ready-to-paste handoff for the next session (current state + what's next + env traps) |
| [TASKS.md](TASKS.md) | **The backlog** — every open item: features awaiting green-light, small residuals, maintainer-gated work |
| [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) | **Process** (the single process doc): session protocol, per-PR loop, merge authorization, exit gates |
| [DECISIONS.md](DECISIONS.md) | **Decision log — all resolved**; don't re-litigate |

## Status snapshot

_Updated: 2026-07-14 (phases 1–7 ✅ done and live on prod; every claim below re-verified against code/git by a 5-agent audit on 2026-07-14)._

| Phase | Theme | State |
|---|---|---|
| — | Planning + review | ✅ done |
| 1–3 | Perf: load, smoothness, backend-path & Realtime economics | ✅ done (PRs #150–#174; migs 034–038; −27.5% Realtime msgs; exit gates passed 2026-07-05) |
| 4 | Resilience: mid-game failure modes | ✅ done (PRs #185–#197; exit gate passed 2026-07-10) |
| 5 | Security & abuse hardening | ✅ code done; only Cloudflare WAF (infra) + CSV guard (off-limits tooling) remain — [TASKS.md](TASKS.md) §C |
| 6 | Correctness & docs hygiene | ✅ done (#199, #200/#203, #216) |
| 7 | Tech-debt & test hardening | ✅ done (T7.1–T7.6; exit gate passed 2026-07-11) |
| 8 | Features | 🟡 in progress — X-Presets (#241), X-Recovery, X-Extend, team rejoin (#183/PR #260) shipped; the rest is [TASKS.md](TASKS.md) §A |

**Everything still open — features, residuals, and maintainer-gated work — is in [TASKS.md](TASKS.md)** (features also tracked as GitHub issues #243–#247).

## The one rule

Every feature/task cluster ends with the **Full-Game Exit Gate** ([EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) §5): nothing is "done" until a complete game plays end-to-end — create → join → buzz → score → bonus → end → export — on real production, with Hebrew titles rendering and no console errors. This is a live app; a broken Saturday-night game outweighs any missing feature.
