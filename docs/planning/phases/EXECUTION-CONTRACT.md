# Execution Contract — how to run any phase

The single process doc for executing the plan (it absorbed the old `execution-playbook.md` in the 2026-07 reorg). **To start a session, paste a short prompt like:**

> Continue the Sound Clash plan. Read `docs/planning/NEXT-SESSION.md` first, then follow `docs/planning/phases/EXECUTION-CONTRACT.md` and the active phase file.

Everything below applies to **every** phase. The phase file supplies the tasks, the PR split (its `## ▶ Kickoff` block), and the phase-specific exit-gate bullets.

---

## 0 · What you're working on
A **live production** party game at `https://www.soundclash.org` — never break a running game. Read `docs/planning/00-current-state.md` for the architecture if needed. **Do NOT touch the uncommitted `tools/song-curation/` files** (maintainer's in-flight work). Stage by explicit path; never `git add .`.

## 1 · Read first (every session)
1. `docs/planning/README.md` (status snapshot) + `docs/planning/NEXT-SESSION.md` (current handoff)
2. this file
3. `docs/planning/phases/phase-<N>-*.md` — the phase's `## ▶ Kickoff`, tasks, and exit gate
4. `docs/planning/05-decisions-needed.md` — decisions are **resolved**; don't re-litigate
5. `.claude/rules/lessons-learned.md` — Windows env traps (venv repoint; `pytest -c pyproject.toml --rootdir=. -p no:cov` for subsets; testcontainers flake; e2e committed-state-not-optimistic-flag waiting; prod testing needs the sandbox disabled)

Then `git fetch && git status` — confirm clean state, note in-flight branches/PRs — and pick the next unblocked task in phase order.

## 2 · Session sizing & model policy
- **Session model: Opus 4.8** unless the phase Kickoff says otherwise (strong coder; conserves the Fable/Mythos budget).
- One session = one task cluster, or several small independent tasks. Don't span a phase boundary in one session. If a task balloons: land what's safely shippable, update the phase file with what remains, stop cleanly — the next session picks up from the plan, not from memory.
- Implement interdependent code in **one coherent session** — don't fan parallel agents onto overlapping files. Truly independent tasks may run as parallel sessions, each in its **own git worktree** (`git worktree add ../sc-<task> -b <branch>`).
- Reach for a **Workflow** (multi-agent fan-out) only when the work is "N independent instances of the same shape" (bulk test generation, multi-doc sweeps) or "needs adversarial confidence" (post-phase gate audits, security re-verify, review/verify fan-out on a finished diff). Everything else: single agent. Workflow outputs still go through the normal branch → PR → gate path.

## 3 · The per-PR loop (repeat for each task / chunk)
1. **Branch** off fresh `main` (`fix/…` or `feature/…`). Never commit to `main`; never force-push `main`.
2. **Implement + tests** at the right layer (DB race → `tests/db`; contract → `tests/backend`; UI → vitest; cross-client → e2e).
3. **Local checks** that apply:
   - frontend: `npm run format:check && npm run lint && npm run typecheck && npm run test:run`
   - backend (from `backend/`, no path args): `ruff check . && ruff format --check . && mypy app && pytest`
   - DB: apply the migration **twice** against a local `supabase start` stack (idempotency)
   - headers/caching: `curl -I`
4. **Docs-as-spec:** schema/RPC/RLS/contract change ⇒ update `docs/` in the **same PR**. User-visible change ⇒ `CHANGELOG.md` `[Unreleased]` entry **before** opening the PR.
5. **Open the PR:** `gh pr create` (use `--body-file` — PowerShell mangles multiline `--body`), `## Summary` + `## Test plan`, no AI attribution / footer / emoji. One-line commit messages.
6. **Wait for CI fully green:** `gh pr checks <n> --watch`. Note: docs-only PRs only run CodeQL (backend/frontend workflows are path-filtered; e2e is label-gated).
7. **Merge** — only when CI is green **and** you've verified the change end-to-end: `gh pr merge <n> --squash`. **Do not delete the branch** (repo rule). Never merge red or unverified. One PR at a time.
   > **Merge authorization:** the maintainer has authorized merging for this execution loop. The standing repo rule (`.claude/rules/pull-requests.md`) otherwise forbids Claude merging, so the bar is strict — **green CI + verified + squash + keep the branch**. If CI can't go green or anything is uncertain, stop and hand the PR to the maintainer.
8. **Tick** the task box in the phase file and refresh `NEXT-SESSION.md`; commit that (same PR or a tiny docs PR).
9. If the session discovered a new bug/idea, append it to the right backlog file (`01`–`04`) rather than fixing it ad hoc (exception: P0 production breakage — fix immediately, then record).

## 4 · Flag before doing (never silently)
- Any `.github/workflows/` change or repo/branch-protection setting (CI rule).
- Any **new dependency** (npm / pip).
- Any **binary-asset** commit (audio / images) — confirm the location (D-9: small optimized assets in-repo, confirm each).
- Any **prod infra** change (Cloudflare / Render / Supabase dashboard) or env var — hand to the maintainer with exact steps.
- Any **prod migration** — after merge + maintainer go: `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/<NNN>.sql`. For a migration the deployed backend **hard-requires**, apply it **before or atomically with** the deploy (lessons-learned F-P0-4), then `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org`.
- Anything that changes architecture (new service, auth model, state library, non-YouTube audio), game rules/scoring, or costs money — ask first with a concrete recommendation (the decision protocol that produced `05`).

## 5 · The exit gate (two levels)
**Per-PR gate:** §3 checks green + the change actually exercised end-to-end at least once (a `/verify`-style run on the dev stack or prod, not just unit tests).

**Per-phase Full-Game Exit Gate** — a phase is **not done** until all pass (run after the phase's last PR merges and deploys — Render + Pages auto-deploy from `main`):
- All local suites green: backend+db pytest (rerun `tests/db/test_rls_anon.py` in isolation if it fails in-suite — known contamination), frontend vitest w/ coverage, `tsc`, eslint, ruff, mypy.
- **Buzz-race test green** (10 concurrent → 1 winner, looped) if the phase touched the buzz path or any RPC. Add the `run-stress`/`run-e2e` labels to RPC/realtime-touching PRs (a `labeled` event spawns a separate workflow run — watch that one).
- e2e green against a local `supabase start` stack — at minimum `full_game`, `multi_buzz_round`, `buzzer_race`, plus any spec covering the phase's changes.
- Prod smoke: `./tests/smoke/post_deploy.sh https://api.soundclash.org` and `tests/e2e/smoke/prod_realtime.spec.ts`.
- **Manual three-tab game on production** (sandbox disabled): create → display QR → join×2 → start → song plays → buzz locks others → Correct Song → Continue → artist → Next round → Bonus → End → podium + song export. Hebrew titles render on all three screens; **zero app console errors** (ignore YouTube's third-party `compute-pressure` warnings); buzz feels instant from a second device; manager clicks give immediate feedback.
- CI green on `main`; Sentry shows no new production errors from the smoke window.
- Plus the phase file's own **Exit gate** bullets. Phase file updated: boxes ticked or explicitly moved with a note.

If any gate item fails: log it as P0/P1 in `docs/planning/01-fixes.md`, fix it, re-run the gate. Do not declare the phase done until the gate is fully green.

## 6 · When the phase is done
- Update `docs/planning/README.md` status (Phase N ✅) + `NEXT-SESSION.md`; tick the phase file.
- Report every PR that merged + before/after numbers where relevant (latency, bundle size, Realtime message count).
- If a big change surfaced that isn't already resolved in `05-decisions-needed.md`, **stop and ask** the maintainer.
