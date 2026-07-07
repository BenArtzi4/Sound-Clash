# Execution Roadmap — Phases

This sequences the backlog (`../01`–`../04`) into ordered phases. Each phase file lists tasks → subtasks and a **per-phase Full-Game Exit Gate**. Read [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) — the single process doc — first.

**Phases 1–3 are ✅ complete** (shipped to prod; their per-phase files were removed once done — the detail lives in git history, `CHANGELOG.md`, and the status snapshot in [../README.md](../README.md)). Headline results:
- **Phase 1 — Load & time-to-playable** (PRs #150–#158): parallel hydrate, immutable asset caching, deferred Sentry/Faro, prefetch/prewarm, DR catalog backup, D-1 token relocation. Exit gate passed 2026-07-05. *One code-free leftover:* T1.7 Grafana Realtime alerts (needs maintainer dashboard access).
- **Phase 2 — Perceived smoothness & buttons** (PRs #159–#165): provisional buzz-lock from the RPC, instant press feedback, composited animations, no-layout-shift banners, dropped the silent `busy` gate, CONNECTING/RECONNECTING states. Exit gate passed on prod 2026-07-05.
- **Phase 3 — Backend-path & Realtime economics** (PRs #166–#174; migrations 035–038 live on prod): dropped the dead `buzz_in` write, collapsed `award_attempt` to one UPDATE, took `game_round_attempts` off the Realtime publication (mig 037, + RLS), trimmed the resync, peek-metadata in-gesture. **−27.5% Realtime messages** on a scripted 6-team/5-round game. Exit gate passed on prod 2026-07-05.

**Phase 4 is ⏳ in progress** — T4.0 (deploy-safe chunks, PR #185) and T4.2 (resume-on-visible, PR #187) shipped; T4.1 de-scoped (PR #186); T4.9 turned out already-shipped (PR #163). **Next task: T4.3.**

## ▶ How to start a session (short prompt)

Paste this into a fresh session (or just run the local `/next-task` skill):

> **Continue the Sound Clash plan. Read `docs/planning/NEXT-SESSION.md` first, then follow `docs/planning/phases/EXECUTION-CONTRACT.md` and the active phase file.**

The [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) carries everything reusable — model policy, the per-PR branch→CI→merge loop, the merge authorization, flag-before-doing, and the exit gate. Each phase file's own `## ▶ Kickoff` block carries the PR split and phase-specific flags.

## Phase index

| Phase | File | Theme | State |
|---|---|---|---|
| 1 | ✅ done (git history) | Load & time-to-playable | shipped |
| 2 | ✅ done (git history) | Perceived smoothness & buttons | shipped |
| 3 | ✅ done (git history) | Backend-path & Realtime economics | shipped |
| 4 | [phase-4-resilience.md](phase-4-resilience.md) | Mid-game failure modes | ⏳ **in progress — T4.3 next** |
| 5 | [phase-5-security.md](phase-5-security.md) | Security & abuse hardening | ready (decisions resolved; T5.3/T5.5 already shipped) |
| 6 | [phase-6-correctness-docs.md](phase-6-correctness-docs.md) | Correctness & docs/data-model | ready (scope shrank — one sync PR + two migrations) |
| 7 | [phase-7-tech-debt.md](phase-7-tech-debt.md) | Tech-debt & test hardening | ready |
| 8 | [phase-8-features.md](phase-8-features.md) | Features | ready (Tier 1–3; D-5/D-6 out of scope) |

**Recommended path:** finish **Phase 4** (T4.3 → T4.11) → **6** (small now) → **7** → **5** → **8**. Ordering logic: resilience protects live games first; 6 is now cheap and unblocks honest docs; 7 de-risks the bigger refactors; 5's remaining items are mostly documentation + small guards (its critical fix already shipped); 8 builds features on the hardened base. Interleave freely — 6/7 items are independent cleanup.

## Global exit gate (every phase)

No phase closes until the **Full-Game Exit Gate** ([EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) §5) passes: full local suites green, buzz-race test green, e2e green, prod smoke green, and a **manual three-tab game on production** with Hebrew titles rendering and zero console errors.
