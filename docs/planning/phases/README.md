# Execution Roadmap — Phases

This sequences the backlog (`../01`–`../04`) into ordered phases. Each phase file lists tasks → subtasks and a **per-phase Full-Game Exit Gate**. Read [../execution-playbook.md](../execution-playbook.md) for the session/git/gate mechanics first.

**Phases 1–3 are ✅ complete** (shipped to prod; their per-phase files were removed once done — the detail lives in git history, `CHANGELOG.md`, and the status snapshot in [../README.md](../README.md)). Headline results:
- **Phase 1 — Load & time-to-playable** (PRs #150–#158): parallel hydrate, immutable asset caching, deferred Sentry/Faro, prefetch/prewarm, DR catalog backup. Exit gate passed 2026-07-05. *One code-free leftover:* T1.7 Grafana Realtime alerts (needs maintainer dashboard access).
- **Phase 2 — Perceived smoothness & buttons** (PRs #159–#165): provisional buzz-lock from the RPC, instant press feedback, composited animations, no-layout-shift banners, dropped the silent `busy` gate. Exit gate passed on prod 2026-07-05.
- **Phase 3 — Backend-path & Realtime economics** (PRs #166–#174; migrations 035–038 live on prod): dropped the dead `buzz_in` write, collapsed `award_attempt` to one UPDATE, took `game_round_attempts` off the Realtime publication, trimmed the resync, peek-metadata in-gesture. **−27.5% Realtime messages** on a scripted 6-team/5-round game. Exit gate passed on prod 2026-07-05.

## ▶ How to start a phase (short prompt)

Paste this into a fresh session, swapping the phase number/file:

> **Start Phase 4 of the Sound Clash plan. Follow `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-4-resilience.md`.**

The [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) carries everything reusable — model policy, the per-PR branch→CI→merge loop, the merge authorization, flag-before-doing, and the exit gate. Each phase file's own `## ▶ Kickoff` block carries the model, the PR split, and the phase-specific flags. That's all a session needs. (See also [../NEXT-SESSION.md](../NEXT-SESSION.md) for the current, ready-to-paste handoff.)

Phase-file quick reference for the paste (remaining phases):
- Phase 4 → `phase-4-resilience.md`  ·  Phase 5 → `phase-5-security.md`
- Phase 6 → `phase-6-correctness-docs.md`  ·  Phase 7 → `phase-7-tech-debt.md`  ·  Phase 8 → `phase-8-features.md`

## Ordering logic

Performance and smoothness came first (Phases 1–3, done) because they are the stated goal and were almost entirely low-risk autonomous frontend/config work. Resilience follows. Correctness/docs and tech-debt interleave as steady cleanup. Security and Features carry the big decisions (`../05`) and are gated on your calls, though each has autonomous sub-items that can proceed.

```
Phase 1  Perf: Load & time-to-playable        ── ✅ DONE (PRs #150–#158)
Phase 2  Perf: Perceived smoothness & buttons  ── ✅ DONE (PRs #159–#165)
Phase 3  Perf: Backend-path & Realtime         ── ✅ DONE (PRs #166–#174; −27.5% msgs)
Phase 4  Resilience: mid-game failure modes    ── ⏳ NEXT · autonomous + I-Expiry decision-light
Phase 5  Security & abuse hardening            ── DECISIONS D-1..D-4 (D-1 already shipped via mig 034)
Phase 6  Correctness & docs/data-model hygiene ── autonomous (+ D-8 for youtube_id)
Phase 7  Tech-debt & test hardening            ── autonomous (+ D-7 scoring; CI flags)
Phase 8  Features                              ── DECISIONS D-5,D-6,D-9; Tier-1 mostly autonomous
```

**Recommended path from here:** **Phase 4** → then interleave 6/7 while 5/8 unblock. See `../NEXT-SESSION.md` for the concrete next-session plan (including the orphaned P0 **F-P0-3** deploy-blank fix, folded into Phase 4 as T4.0).

## Phase index (remaining)

| Phase | File | Theme | Blocking? | Ultracode? |
|---|---|---|---|---|
| 1 | ✅ done (git history) | Load & time-to-playable | — | — |
| 2 | ✅ done (git history) | Perceived smoothness & buttons | — | — |
| 3 | ✅ done (git history) | Backend-path & Realtime economics | — | — |
| 4 | [phase-4-resilience.md](phase-4-resilience.md) | Mid-game failure modes | No | Single-session per fix |
| 5 | [phase-5-security.md](phase-5-security.md) | Security & abuse hardening | **Yes (D-1..D-4)** | Workflow for the audit re-verify |
| 6 | [phase-6-correctness-docs.md](phase-6-correctness-docs.md) | Correctness & docs/data-model | No (+D-8) | **Workflow** for the 76-item docs-drift sweep |
| 7 | [phase-7-tech-debt.md](phase-7-tech-debt.md) | Tech-debt & test hardening | No (+D-7, CI flags) | Workflow for test generation |
| 8 | [phase-8-features.md](phase-8-features.md) | Features | **Partly (D-5,D-6,D-9)** | Per-feature sessions |

## When to reach for an ultracode workflow (recap)

Per the playbook §5, orchestrate a multi-agent workflow when the work is "N independent instances of the same shape" or "needs adversarial confidence":
- **Phase 6 docs sweep** — 76 drift items across 7 docs; fan out per doc, verify each against code.
- **Phase 5 security re-verify** — after fixes, re-run the adversarial security hunt to confirm the holes are closed.
- **Phase 7 test generation** — write DB-race + e2e specs across many scenarios in parallel, then consolidate.
- **Post-phase gate audits** — re-verify the phase didn't regress the full-game flow.

Everything else is a normal single-agent session.

## Global exit gate (every phase)

No phase closes until the **Full-Game Exit Gate** (playbook §6.2) passes: full local suites green, buzz-race test green, e2e green, prod smoke green, and a **manual three-tab game on production** (create → join×2 → start → song plays → buzz locks others → Correct Song → Continue → artist → Next round → Bonus → End → export) with Hebrew titles rendering and zero console errors. Latency spot-check: buzz feels instant from a second device; manager clicks give immediate feedback.
