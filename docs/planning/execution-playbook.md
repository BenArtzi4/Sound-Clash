# Execution Playbook

How we execute the improvement plan in `docs/planning/`: session protocol, git mechanics, quality gates, and when to use multi-agent (ultracode) workflows. This file is process-only; the *what* lives in the numbered list files and `phases/`.

## 1. The one rule that overrides everything

Every phase ends with the **Full-Game Exit Gate** (§6). No phase is "done" — regardless of how green its individual tasks look — until a complete game can be played end-to-end and the gate checklist passes. The gate exists because this is a live production app at `https://www.soundclash.org` with real party-night users; a regression that breaks a Saturday-night game is worse than any missing feature.

## 2. Plan file map

| File | Contents |
|---|---|
| `README.md` | Index + current status snapshot; read first in every session |
| `00-current-state.md` | Architecture + review summary as of 2026-07-03 (evidence base for everything else) |
| `01-fixes.md` | Confirmed bugs, ranked P0/P1/P2, each with evidence and fix sketch |
| `02-improvements.md` | Improvements to existing behavior (UX, resilience, performance) |
| `03-features.md` | New feature candidates, ranked by party-night impact vs cost |
| `04-tech-debt.md` | Code quality, tests, CI, docs drift, repo hygiene |
| `05-decisions-needed.md` | Big changes that need the user's call before any code |
| `phases/phase-N-*.md` | Ordered execution: tasks → subtasks → per-phase exit gate |
| `execution-playbook.md` | This file |

Statuses are tracked with checkboxes inside the phase files. When a task ships, tick it in the same PR (phase files are docs; no changelog entry needed for the tick itself).

## 3. Session protocol

Work happens in Claude Code sessions. Context windows are finite; the plan is the durable memory between sessions.

**Every session starts the same way:**
1. Read `docs/planning/README.md` (status snapshot) and the active phase file.
2. `git fetch && git status` — confirm clean state, note any in-flight branches/PRs.
3. Pick the next unblocked task(s) in phase order. Never start a task whose listed dependency isn't merged.

**Session sizing.** One session = one task cluster (a task plus its subtasks), or several small independent tasks. Do not span a phase boundary inside one session. If a task turns out bigger than expected, land what's safely shippable, update the phase file with what remains, and stop cleanly — the next session picks it up from the plan, not from memory.

**Every session ends the same way:**
1. All work is on a branch, pushed, with a PR open (never merged by Claude — merging is the user's call).
2. The phase file reflects reality: ticked boxes, new sub-tasks discovered mid-work, blockers noted.
3. If the session discovered a new bug/idea, append it to the right list file (`01`–`04`) rather than fixing it ad hoc out of order (exception: P0 production breakage — fix immediately, then record).

**Parallel sessions.** Independent tasks may run as parallel sessions/agents, each in its **own git worktree** (`git worktree add ../sc-<task> -b <branch>`) so working trees never collide. Anything touching the same files stays serialized in one session.

## 4. Git + PR mechanics (repo rules, restated operationally)

- Branch per task: `fix/<short-name>` or `feature/<short-name>`. Never commit to `main`.
- Commits: single line, no body, no AI attribution of any kind.
- Push freely; open PRs freely (`## Summary` + `## Test plan`); **never merge, approve, or request reviewers** — the user merges.
- One task = one PR whenever possible. A PR should be reviewable in one sitting.
- Schema/RPC/RLS change ⇒ update `docs/data-model.md` / `docs/rpc-functions.md` / `docs/security-rls.md` **in the same PR**. User-visible change ⇒ `CHANGELOG.md` entry under `[Unreleased]` **before** the PR opens.
- Migrations: numbered, idempotent (CI applies twice), applied to prod only via `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/<NNN>.sql` — and only after the PR is merged and the user says go, unless the user pre-authorizes.
- `.github/workflows/` and repo settings: never change without flagging first.
- New dependencies: flag before installing, every time.
- Before debugging anything, check `.claude/rules/lessons-learned.md` — most environment traps on this Windows machine are already recorded there (venv repointing, pytest rootdir, testcontainers flakes, e2e click-race).

## 5. When to use ultracode / dynamic workflows

Use a **plain session** (single agent) for: single-file fixes, one component, one migration, doc syncs. This is most tasks.

Use an **ultracode dynamic workflow** (multi-agent fan-out) when the task is one of:
- **Sweeps**: apply the same change across many files (e.g., centralizing scoring constants, error-handling normalization) — fan out per file with worktree isolation, verify each.
- **Audits/verification**: post-phase validation, docs-drift re-checks, security re-review — parallel finders + adversarial verify (the same pattern that produced this plan).
- **Test generation at scale**: writing DB-level race tests or e2e specs across many scenarios — one agent per scenario, then a consolidation pass.
- **Design shootouts**: when `05-decisions-needed.md` items get approved and the design space is wide — N independent design attempts, judge panel, synthesize.

Rule of thumb: if the task is "N independent instances of the same shape" or "needs adversarial confidence", orchestrate; otherwise stay single-agent. Every workflow's final outputs still go through the normal branch → PR → gate path.

## 6. Exit gates

### 6.1 Per-task gate (every PR, before opening it)

- [ ] Touched-layer checks pass locally:
  - Backend: `ruff check . && ruff format --check . && mypy app` + `pytest` (full suite from `backend/`, no path args; see lessons-learned for subset syntax)
  - Frontend: `npm run lint && npm run typecheck && npm run test:run`
  - DB: migration applied twice against local `supabase start` stack without error
- [ ] New behavior has a test at the right layer (DB race → `tests/db`, contract → `tests/backend`, UI state → vitest, cross-client → e2e)
- [ ] Docs-as-spec rule satisfied; CHANGELOG updated if user-visible
- [ ] `/verify`-style check: the affected flow was actually exercised end-to-end at least once (dev stack or prod), not just unit-tested
- [ ] CI green on the PR

### 6.2 Per-phase Full-Game Exit Gate

Run after the phase's last PR merges and deploys (Render + Pages auto-deploy from `main`):

- [ ] **Full local suites green**: backend+db pytest (rerun `tests/db/test_rls_anon.py` in isolation if it fails in-suite — known contamination), frontend vitest w/ coverage, `tsc`, eslint, ruff, mypy.
- [ ] **Buzz race integrity**: the DB race test (10 concurrent buzz_in → exactly 1 winner, looped) passes.
- [ ] **E2E**: Playwright suite against a local `supabase start` stack — at minimum `full_game.spec.ts`, `multi_buzz_round.spec.ts`, `buzzer_race.spec.ts`, plus any spec covering the phase's changes. (Use the committed-state-not-optimistic-flag waiting pattern from lessons-learned on this machine.)
- [ ] **Prod smoke**: `./tests/smoke/post_deploy.sh https://api.soundclash.org` passes; `tests/e2e/smoke/prod_realtime.spec.ts` passes against production.
- [ ] **Manual three-tab game** (Playwright MCP browser or by hand, against prod): create game → display shows QR → two teams join → start game → song plays → buzz locks others out → score Correct Song → Continue → score artist → Next round → Bonus → End game → end screen + song export. Hebrew song titles render correctly on all three screens.
- [ ] **Latency spot-check**: buzz-to-lock feels instant from a second device; manager clicks give immediate feedback.
- [ ] **No console errors** on any of the three screens during the manual game.
- [ ] **CI green on `main`**; Sentry shows no new production errors from the smoke window.
- [ ] Phase file updated: all boxes ticked or explicitly moved to a later phase with a note.

If any gate item fails: the phase is not done. File the failure as a P0/P1 in `01-fixes.md`, fix it, re-run the gate.

## 7. Decision protocol (big changes)

Anything in `05-decisions-needed.md` — and anything discovered mid-work that (a) changes the architecture (new service, new dependency, auth model, state library, non-YouTube audio), (b) changes game rules/scoring, (c) costs money or leaves free tier, (d) touches CI/repo settings, or (e) is hard to reverse — gets asked before implementation, with a concrete recommendation. Everything else: implement autonomously per this playbook.
