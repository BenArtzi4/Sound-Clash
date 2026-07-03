# Phase 7 — Tech-debt & Test Hardening

**Goal:** remove the footguns and blind spots that make future work risky — the god component, the client-controlled scoring, the flaky RLS test, the missing bundle discipline — so the app stays production-perfect as it grows.

**Why:** none is user-visible, but each removes a class of future bug. Autonomous except D-7 (scoring authority) and the CI-touching items (flag per repo rule).

**Backlog refs:** `04-tech-debt.md §A–D`, D-7.

**Session shape:** refactors are single-session (guarded by existing tests). Test generation is a good **ultracode workflow** (one agent per scenario). CI edits are flagged-then-single-session.

---

## Tasks

### T7.1 · Scoring single source of truth `[M]` — T-Scoring, **D-7**
- [ ] Refactor `award_attempt` to take booleans + read `songs.is_soundtrack`, compute + cap points server-side.
- [ ] Expose the 5 UI constants from one shared module the toasts import; add the value-cross-check test (T-ScoringTest).
- [ ] Behind the buzz-race + full-game gate; own PR. Decide D-7 first (recommend yes; optionally pull into Phase 3 to touch `award_attempt` once).

### T7.2 · Decompose the god components `[M]` — T-Manager, T-Admin
- [ ] Extract `useSongPrebuffer` + `useScoring` from `ManagerConsolePage`; leave it as layout+wiring. Existing ~48-case test guards it.
- [ ] Extract `SongTable`/`SongEditForm`/`useAdminSongs` from `AdminSongsPage`; fix the page-index clamp cleanly.

### T7.3 · Small quality cleanups `[S]`
- [ ] `T-SongFetch`: `fetchSongWithSoundtrack()` in `lib/soundtrack.ts`; both pages call it.
- [ ] `T-RpcError`: `throwOnRpcError()` helper for uniform RPC error shape across all five direct-RPC sites.
- [ ] `T-Deps`: document/fix the 4 `exhaustive-deps` disables.
- [ ] `T-KeepWarm`: implement the keep-warm decision from Phase 3.

### T7.4 · Dead code + hygiene `[S]` — T-DeadCode, T-Lockfile
- [ ] One sweep: delete `Scoreboard.{tsx,test.tsx,module.css}` + CLAUDE.md mention; remove `create-page-after-fix.png` at repo root; audit `screenshots/` + `.playwright-mcp/` tracking.
- [ ] Un-ignore `frontend/package-lock.json` after re-verifying the npm-10 runner bug is gone (deploy reproducibility). **Verify before flipping.**

### T7.5 · Test hardening `[M — workflow]` — T-RLSFix, T-CascadeTest, T-DeployTest
- [ ] Proper RLS fixture fix: dedicated non-superuser `LOGIN` role + `current_user` assertion; extend to `game_round_attempts` + `game_history*`.
- [ ] e2e/reducer tests for: cascade-delete UX, deploy-during-game preloadError→reload, failed-hydrate, expiry warning.
- [ ] (workflow) generate the DB-race + e2e specs in parallel, then consolidate.

### T7.6 · CI discipline `[S — flag CI changes]`
- [ ] `T-RLSCI`: isolated CI job for the RLS suite (deterministic green/red).
- [ ] `T-BundleBudget`: post-build bundle-size assert / visualizer in PR.
- [ ] `T-e2eGate`: decide whether e2e gates PRs; confirm coverage ratchet isn't stuck at 0.
- [ ] `T-Dependabot`: review + open/update the 4 dependabot PRs (#133, #114, #147, #148). **Maintainer merges.**

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
