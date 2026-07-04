# Execution Contract — how to run any phase

This is the phase-agnostic kickoff. **To start a phase, paste a short prompt like:**

> Start Phase 1 of the Sound Clash plan. Follow `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-1-perf-load.md`.

Everything below applies to **every** phase. The phase file supplies the tasks, the PR split (its `## ▶ Kickoff` block), and the phase-specific exit-gate bullets.

---

## 0 · What you're working on
A **live production** party game at `https://www.soundclash.org` — never break a running game. Read `docs/planning/00-current-state.md` for the architecture if needed. **Do NOT touch the uncommitted `tools/song-curation/` files** (maintainer's in-flight work).

## 1 · Read first (every phase)
1. `docs/planning/README.md`
2. this file
3. `docs/planning/phases/phase-<N>-*.md` — the phase's `## ▶ Kickoff`, tasks, and exit gate
4. `docs/planning/05-decisions-needed.md` — decisions are **resolved**; don't re-litigate
5. `.claude/rules/lessons-learned.md` — Windows env traps (venv repoint; `pytest -c backend/pyproject.toml --rootdir=backend -p no:cov`; testcontainers flake; e2e busy-flag click race; prod testing needs the sandbox disabled)

## 2 · Model & workflow policy
- **Session model: Opus 4.8** unless the phase Kickoff says otherwise (strong coder; conserves the Fable/Mythos session budget).
- Implement interdependent code in **one coherent session** — do **not** fan parallel agents onto overlapping files.
- Reach for a **Workflow** only where the phase is "N independent instances of the same shape" (the Kickoff will flag it — e.g. Phase 6 docs sweep, Phase 7 test-gen) or for the pre-phase baseline measurement and the end-of-phase verification/gate audit.

## 3 · The per-PR loop (repeat for each task / chunk)
1. **Branch** off `main` (`fix/…` or `feature/…`). Never commit to `main`; never force-push `main`.
2. **Implement + tests** at the right layer (DB race → `tests/db`; contract → `tests/backend`; UI → vitest; cross-client → e2e).
3. **Local checks** that apply:
   - frontend: `npm run lint && npm run typecheck && npm run test:run`
   - backend (from `backend/`, no path args): `ruff check . && ruff format --check . && mypy app && pytest`
   - DB: apply the migration **twice** against a local `supabase start` stack (idempotency)
   - headers/caching: `curl -I`
4. **Docs-as-spec:** schema/RPC/RLS/contract change ⇒ update `docs/` in the **same PR**. User-visible change ⇒ `CHANGELOG.md` `[Unreleased]` entry **before** opening the PR.
5. **Open the PR:** `gh pr create`, `## Summary` + `## Test plan`, no AI attribution / footer / emoji.
6. **Wait for CI fully green:** `gh pr checks <n> --watch`.
7. **Merge** — only when CI is green **and** you've verified the change end-to-end: `gh pr merge <n> --squash`. **Do not delete the branch** (repo rule). Never merge red or unverified. One PR at a time.
   > **Merge authorization:** the maintainer has authorized you to merge for this execution loop. The standing repo rule (`.claude/rules/pull-requests.md`) otherwise forbids Claude merging, so the bar is strict — **green CI + verified + squash + keep the branch**. If CI can't go green or anything is uncertain, stop and hand the PR to the maintainer.
8. **Tick** the task box in the phase file; commit that.

## 4 · Flag before doing (never silently)
- Any `.github/workflows/` change or repo/branch-protection setting (CI rule).
- Any **new dependency** (npm / pip).
- Any **binary-asset** commit (audio / images) — confirm the location.
- Any **prod infra** change (Cloudflare / Render / Supabase dashboard) or env var — hand to the maintainer with exact steps.
- Any **prod migration** — apply only after merge + maintainer go: `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/<NNN>.sql`.

## 5 · The exit gate (every phase — two levels)
**Per-PR gate:** §3 checks green + the change actually exercised (a `/verify`-style run, not just unit tests).

**Per-phase Full-Game Exit Gate** — a phase is **not done** until all pass:
- All local suites green; **buzz-race test green** (10 concurrent → 1 winner, looped) if the phase touched the buzz path or any RPC.
- e2e green against a local `supabase start` stack (use the committed-state-not-optimistic-flag waiting pattern from lessons-learned).
- Prod smoke: `./tests/smoke/post_deploy.sh https://api.soundclash.org` and `tests/e2e/smoke/prod_realtime.spec.ts`.
- **Manual three-tab game on production** (sandbox disabled): create → join×2 → start → song plays → buzz locks the others out → Correct Song → Continue → artist → Next round → Bonus → End → song export. Hebrew titles render on all three screens; **zero console errors**; buzz feels instant from a second device; manager clicks give immediate feedback.
- Plus the phase file's own **Exit gate** bullets.

If any gate item fails: log it as P0/P1 in `docs/planning/01-fixes.md`, fix it, re-run the gate. Do not declare the phase done until the gate is fully green.

## 6 · When the phase is done
- Update `docs/planning/README.md` status (Phase N ✅) and tick the phase file.
- Report every PR that merged + before/after numbers where relevant (latency, bundle size, Realtime message count).
- If a big change surfaced that isn't already resolved in `05-decisions-needed.md`, **stop and ask** the maintainer.
