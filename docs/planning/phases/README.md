# Execution Roadmap — Phases

This sequences the backlog (`../01`–`../04`) into ordered phases. Each phase file lists tasks → subtasks and a **per-phase Full-Game Exit Gate**. Read [../execution-playbook.md](../execution-playbook.md) for the session/git/gate mechanics first.

## ▶ How to start a phase (short prompt)

Paste this into a fresh session, swapping the phase number/file:

> **Start Phase 1 of the Sound Clash plan. Follow `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-1-perf-load.md`.**

The [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md) carries everything reusable — model policy, the per-PR branch→CI→merge loop, the merge authorization, flag-before-doing, and the exit gate. Each phase file's own `## ▶ Kickoff` block carries the model, the PR split, and the phase-specific flags. That's all a session needs.

Phase-file quick reference for the paste:
- Phase 1 → `phase-1-perf-load.md`  ·  Phase 2 → `phase-2-perf-smoothness.md`  ·  Phase 3 → `phase-3-perf-backend-realtime.md`  ·  Phase 4 → `phase-4-resilience.md`
- Phase 5 → `phase-5-security.md`  ·  Phase 6 → `phase-6-correctness-docs.md`  ·  Phase 7 → `phase-7-tech-debt.md`  ·  Phase 8 → `phase-8-features.md`

## Ordering logic

Performance and smoothness come first because they are the stated goal and are almost entirely **low-risk, autonomous, frontend/config** work — fast wins that make the app *feel* production-ready immediately. Resilience follows. Correctness/docs and tech-debt interleave as steady cleanup. Security and Features carry the big decisions (`../05`) and are gated on your calls, though each has autonomous sub-items that can proceed.

```
Phase 1  Perf: Load & time-to-playable        ── autonomous ──┐
Phase 2  Perf: Perceived smoothness & buttons  ── autonomous ──┤ can run mostly in parallel
Phase 3  Perf: Backend-path & Realtime         ── autonomous* ─┘ (*touches RPCs; buzz-race gate)
Phase 4  Resilience: mid-game failure modes    ── autonomous + I-Expiry decision-light
Phase 5  Security & abuse hardening            ── DECISIONS D-1..D-4 (D-1 first!)
Phase 6  Correctness & docs/data-model hygiene ── autonomous (+ D-8 for youtube_id)
Phase 7  Tech-debt & test hardening            ── autonomous (+ D-7 scoring; CI flags)
Phase 8  Features                              ── DECISIONS D-5,D-6,D-9; Tier-1 mostly autonomous
```

**Recommended immediate path:** D-1 (decide) → **Phase 1** → **Phase 2** → **Phase 3** → **Phase 4**, then interleave 6/7 while 5/8 unblock. Phases 1–2 are independent enough to run as **parallel sessions in separate git worktrees** (Phase 1 = config/index.html/main.tsx/vite; Phase 2 = components/CSS/hooks) — minimal file overlap.

## Phase index

| Phase | File | Theme | Blocking? | Ultracode? |
|---|---|---|---|---|
| 1 | [phase-1-perf-load.md](phase-1-perf-load.md) | Load & time-to-playable | No | Mostly single-session; one sweep worth a workflow |
| 2 | [phase-2-perf-smoothness.md](phase-2-perf-smoothness.md) | Perceived smoothness & buttons | No | Single-session |
| 3 | [phase-3-perf-backend-realtime.md](phase-3-perf-backend-realtime.md) | Backend-path & Realtime economics | No* | Single-session (careful RPC edits) |
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
