# Sound Clash — Documentation

Design and operational documentation for Sound Clash. Each file has a single, distinct purpose; cross-references use bare filenames so links work on GitHub, in an IDE, or as plain Markdown.

## Read in this order

1. **[architecture.md](architecture.md)** — executive summary; one-page overview with links to depth.
2. **[realtime-design.md](realtime-design.md)** — THE central design decision: why no Python in the buzzer path; how <200ms is achieved on free hosting.
3. **[tech-stack.md](tech-stack.md)** — the concrete services (Supabase, Render, Cloudflare Pages, …) with free-tier limits and alternatives considered.
4. **[game-rules.md](game-rules.md)** — gameplay flow, state machine, scoring, edge cases. Read this first if you don't know what Sound Clash is.
5. **[data-model.md](data-model.md)** — schema, indexes, ER diagram.
6. **[rpc-functions.md](rpc-functions.md)** — the six PL/pgSQL functions that hold the system's logic.
7. **[security-rls.md](security-rls.md)** — auth model, RLS policies, threat model, rate limits, CSP.
8. **[api-contracts.md](api-contracts.md)** — REST + Realtime wire-format contracts.
9. **[testing-strategy.md](testing-strategy.md)** — test types, coverage gates, CI enforcement; the doc CI gates against.
10. **[free-tier-budget.md](free-tier-budget.md)** — quota analysis; how many games/month before any service runs out.
11. **[local-development.md](local-development.md)** — how to run the stack on your laptop.
12. **[runbook.md](runbook.md)** — day-2+ operations: deploy, rollback, secrets, incidents.
13. **[roadmap.md](roadmap.md)** — eight-phase migration plan with exit criteria.
14. **[tasks.md](tasks.md)** — granular checkboxed task list grouped by area.
15. **[aws-teardown-checklist.md](aws-teardown-checklist.md)** — step-by-step Phase 7 cutover script for tearing down the legacy AWS stack.

## Suggested reading paths

### "I'm reviewing the design"
1. `architecture.md` (overview + links)
2. `realtime-design.md` (validate the central trick)
3. `security-rls.md` (audit the auth model)
4. `free-tier-budget.md` (sanity-check capacity claims)

### "I'm about to start implementing"
1. `architecture.md`
2. `roadmap.md` (find your phase)
3. `local-development.md` (set up dev env)
4. `tasks.md` (find your tickets)
5. Open the doc each task links to (`rpc-functions.md`, `api-contracts.md`, etc.) as you go.

### "I just need to know how to run it locally"
1. `local-development.md` only.

### "I need to operate it in production"
1. `runbook.md`
2. `free-tier-budget.md` (alert thresholds)
3. `security-rls.md` §3 (secret inventory) and §10 (auth failures)

### "I'm doing the AWS cutover"
1. `aws-teardown-checklist.md` (top to bottom)
2. `runbook.md` §2.4 (DNS rollback if needed)

### "I want to know what's NOT in scope"
- `architecture.md` §10 — pointer index of what each doc doesn't cover
- `roadmap.md` "Out of Scope" section
- `game-rules.md` §13 (NOT a game rule)
- Each doc has a "doesn't cover" or "out of scope" section near the end

## Conventions

- **Bold service names** (`**Render**`, `**Supabase**`) for first reference.
- ``code`` formatting for file paths, env vars, function names, and SQL identifiers.
- Latency budgets always given as ranges with explicit units (ms).
- Free-tier limits cited inline with the alert threshold from `free-tier-budget.md`.
- Cross-links use bare filenames so docs work on GitHub, in an IDE, or as plain Markdown.

## Updating these docs

These docs ARE the spec. If you change behavior in code that contradicts a doc, **update the doc in the same PR**. CONTRIBUTING.md enforces this:

| Code change | Doc to update |
|---|---|
| New REST endpoint | `api-contracts.md` |
| New table or column | `data-model.md` |
| New PL/pgSQL function | `rpc-functions.md` |
| New env var or secret | `runbook.md`, `local-development.md` |
| New gameplay rule | `game-rules.md` |

Out-of-date docs are worse than missing ones.

## File summary

| File | Purpose |
|---|---|
| `README.md` (this file) | Index and reading guide |
| `architecture.md` | Executive summary + links |
| `realtime-design.md` | Buzzer hot-path, race correctness, failure modes |
| `tech-stack.md` | Service list with free-tier limits |
| `game-rules.md` | Gameplay, state machine, edge cases |
| `data-model.md` | Schema + indexes + ER |
| `rpc-functions.md` | The 5 PL/pgSQL functions |
| `security-rls.md` | RLS, threat model, rate limits, CSP |
| `api-contracts.md` | REST + Realtime contracts |
| `testing-strategy.md` | Test categories + CI gates |
| `free-tier-budget.md` | Quota analysis + alert thresholds |
| `local-development.md` | Dev setup + troubleshooting |
| `runbook.md` | Operational procedures |
| `roadmap.md` | 8-phase migration plan |
| `tasks.md` | Granular task checklist |
| `aws-teardown-checklist.md` | Phase 7 step-by-step cutover script |
