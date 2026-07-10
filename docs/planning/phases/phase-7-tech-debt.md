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
- [x] Extract `useSongPrebuffer` + `useScoring` from `ManagerConsolePage`; leave it as layout+wiring. Existing ~48-case test guards it. (Pure refactor; all 64 `ManagerConsolePage.test.tsx` cases stayed green unchanged. Also split out `useManagerToken` so the intentional in-render ref access is contained to one small hook — needed because the new `react-hooks/refs` rule now analyzes the slimmed-down page.)
- [x] Extract `SongTable`/`SongEditForm`/`useAdminSongs` from `AdminSongsPage`; fix the page-index clamp cleanly. (Clamp effect snaps `page` back to `totalPages` when a delete/filter shrinks the result set; new discriminating test in `AdminSongsPage.test.tsx`.)

### T7.3 · Small quality cleanups `[S]`
- ~~`T-SongFetch`~~ ✅ shipped 2026-07-09 with Phase 4 T4.7 (PR #194) as `fetchSongById()` in `lib/songMetadata.ts` — it carries the F-P1-7 retry, so it outgrew `lib/soundtrack.ts`.
- [x] `T-RpcError`: ✅ (PR #202) `RpcError` + `throwOnRpcError()` extracted to `lib/rpcError.ts` (re-exported from `useManagerActions` for back-compat). All **six** direct-RPC sites now throw the same type — `useBuzzer` previously threw the raw PostgREST error, now wraps it like the manager RPCs. New `lib/rpcError.test.ts`; buzz-error test tightened to assert `RpcError`.
- [x] `T-Deps`: ✅ verified already satisfied 2026-07-10 — all 4 `exhaustive-deps` disables already carry a reason comment (`DisplayPage.tsx:115`, `SongExport.tsx:90`, `ManagerConsolePage.tsx:219,284` — line numbers drifted from the backlog during Phase 4). No code change needed.
- ~~`T-KeepWarm`~~ ✅ already implemented (`useKeepBackendWarm.ts`, wired in `ManagerConsolePage`).

### T7.4 · Dead code + hygiene `[S]` — T-DeadCode, T-Lockfile
- [x] One sweep: deleted `Scoreboard.{tsx,test.tsx,module.css}` (dead — nothing imported it) + CLAUDE.md mention + the stale `testing-strategy.md` test-table row + two illustrative code comments; removed the tracked `create-page-after-fix.png` at repo root. Frontend format/lint/typecheck/test (445) green. (PR #201 — done 2026-07-10 while T6.3 waits on maintainer.)
- [ ] Un-ignore `frontend/package-lock.json` after re-verifying the npm-10 runner bug is gone (deploy reproducibility). **Verify before flipping.**

### T7.5 · Test hardening `[M]` — T-RLSFix, T-CascadeTest
- [x] Proper RLS fixture fix: `anon_conn` now connects **as a dedicated non-superuser `LOGIN` role** (`anon_login_test`, provisioned once in `_migrated` setup, granted membership in `anon`) via its own DSN, instead of `SET ROLE anon` on the superuser connection; the fixture asserts `session_user`/`current_user` is that role and `rolsuper`/`rolbypassrls` are false. Kills the recurring in-suite `test_rls_anon` flake. (T7.5 — done 2026-07-10.)
- [x] Reducer test for the expiry warning (T4.8): `useGameChannel.test.ts` now asserts a `GAME_CHANGE` UPDATE bumping `expires_at` (the Realtime event `extend_game` triggers) flows into reducer state. The rest of the T4.8 flow was already covered end-to-end (`ExpiryCountdown.test.tsx`, `ManagerConsolePage.test.tsx` "Keep playing…", `useManagerActions.test.ts::extendGameDirect`, `test_extend_game.py`), so no duplication was added. (Cascade-delete ordering shipped with T4.4/PR #192, failed-hydrate with T4.3/PR #190, `preloadError` deploy-path tests with T4.0.)

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
