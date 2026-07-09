# Phase 7 — Tech-debt & Test Hardening

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md). Refactors are single-session, guarded by the existing tests. A workflow for T7.5 test generation is optional (one agent per scenario — RLS-fix, cascade-delete, failed-hydrate, expiry — then consolidate); the list shrank enough that a single session also works.
**Notes:** **D-7 = scoring authority in DB** (careful yes; own PR behind the buzz-race gate). **Flag before doing:** the CI items T-RLSCI, T-BundleBudget, T-e2eGate. Dependabot PRs (#133/#114/#147/#182): open/update — **maintainer merges those**.

**Goal:** remove the footguns and blind spots that make future work risky — the god component, the client-controlled scoring, the flaky RLS test, the missing bundle discipline — so the app stays production-perfect as it grows.

**Why:** none is user-visible, but each removes a class of future bug. Autonomous except D-7 (scoring authority) and the CI-touching items (flag per repo rule).

**Backlog refs:** `04-tech-debt.md §A–D`, D-7.

**Session shape:** refactors are single-session (guarded by existing tests). Test generation is a good **ultracode workflow** (one agent per scenario). CI edits are flagged-then-single-session.

---

## Tasks

### T7.1 · Scoring single source of truth `[M]` — T-Scoring, **D-7 = yes, careful**
- [ ] Refactor `award_attempt` to take booleans + derive soundtrack-ness from genre membership server-side (mig 028 pattern — there is **no** `is_soundtrack` column; it was dropped in mig 025), compute + cap points in the DB.
- [ ] Expose the 5 UI constants from one shared module the toasts import; add the value-cross-check test (T-ScoringTest).
- [ ] Behind the buzz-race + full-game gate; own PR.

### T7.2 · Decompose the god components `[M]` — T-Manager, T-Admin
- [ ] Extract `useSongPrebuffer` + `useScoring` from `ManagerConsolePage`; leave it as layout+wiring. Existing ~48-case test guards it.
- [ ] Extract `SongTable`/`SongEditForm`/`useAdminSongs` from `AdminSongsPage`; fix the page-index clamp cleanly.

### T7.3 · Small quality cleanups `[S]`
- ~~`T-SongFetch`~~ ✅ shipped 2026-07-09 with Phase 4 T4.7 (PR #194) as `fetchSongById()` in `lib/songMetadata.ts` — it carries the F-P1-7 retry, so it outgrew `lib/soundtrack.ts`.
- [ ] `T-RpcError`: `throwOnRpcError()` helper for uniform RPC error shape across all five direct-RPC sites.
- [ ] `T-Deps`: document/fix the 4 `exhaustive-deps` disables (`SongExport.tsx:90`, `DisplayPage.tsx:124`, `ManagerConsolePage.tsx:164,238`).
- ~~`T-KeepWarm`~~ ✅ already implemented (`useKeepBackendWarm.ts`, wired in `ManagerConsolePage`).

### T7.4 · Dead code + hygiene `[S]` — T-DeadCode, T-Lockfile
- [ ] One sweep: delete `Scoreboard.{tsx,test.tsx,module.css}` + CLAUDE.md mention; remove `create-page-after-fix.png` at repo root. (`screenshots/`/`.playwright-mcp/` verified untracked.)
- [ ] Un-ignore `frontend/package-lock.json` after re-verifying the npm-10 runner bug is gone (deploy reproducibility). **Verify before flipping.**

### T7.5 · Test hardening `[M]` — T-RLSFix, T-CascadeTest
- [ ] Proper RLS fixture fix: dedicated non-superuser `LOGIN` role + `current_user` assertion (`tests/db/conftest.py:124` still uses `SET ROLE anon`). The table-coverage extension already shipped.
- [ ] e2e/reducer tests for: expiry warning (T4.8). (Cascade-delete ordering shipped with T4.4/PR #192, failed-hydrate with T4.3/PR #190, `preloadError` deploy-path tests with T4.0.)

### T7.6 · CI discipline `[S — flag CI changes]`
- [ ] `T-RLSCI`: isolated CI job for the RLS suite (deterministic green/red).
- [ ] `T-BundleBudget`: post-build bundle-size assert / visualizer in PR.
- [ ] `T-e2eGate`: decide whether e2e gates PRs (today it runs only on push-to-main / `run-e2e` label; backend coverage gate is already at 90).
- [ ] `T-Dependabot`: review + open/update the open dependabot PRs (#133, #114, #147, #182). **Maintainer merges.**

---

## Decisions touched
- **D-7** (scoring authority) gates T7.1.
- CI edits (T7.6) are flag-before-doing per `.claude/rules/ci-and-repo-config.md`.

## Exit gate (Phase 7)
- [ ] Coverage holds/improves; lint/typecheck/mypy/ruff green; full backend+db+frontend suites green.
- [ ] Buzz-race + `award_attempt` scenarios green after the scoring refactor.
- [ ] RLS suite deterministically green in isolation and in the new CI job.
- [ ] Bundle budget enforced; no accidental size regression from earlier phases.
- [ ] **Full-Game Exit Gate** — scoring values unchanged from the player's view (title=10/artist=5/soundtrack=15/wrong=−3/bonus=+4) after the server-authoritative refactor.
