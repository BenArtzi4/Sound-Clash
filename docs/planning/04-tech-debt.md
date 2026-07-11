# 04 — Tech debt, tests, CI, docs drift, hygiene

Steady autonomous cleanup that makes the app easier to keep production-perfect. None is user-visible on its own (so most carry no CHANGELOG entry), but several remove real footguns. Effort S/M/L.

> **Resolved items removed 2026-07-05:** T-KeepWarm (Phase 3 T3.5 — kept as documented visibility-aware fallback), T-DocRunbook (Phase 1 T1.6 — DR section corrected), T-AttemptsRLS (Phase 3 T3.3 / mig 037 — RLS on + anon revoked). Detail in git history.
> **Resolved items removed 2026-07-07 (verified against code):** T-DocRPC (peek_next_song documented, §8 in-body auth acknowledged, removed endpoints reframed — fixed by the Phase-3-era doc syncs); T-Roadmap (moot — the historical `docs/roadmap.md` was removed in the 2026-07 planning reorg; `docs/planning/` is the roadmap now).
> **Resolved 2026-07-12 (Phases 6–7 shipped these — verified against code/git):** T-Manager (ManagerConsolePage decomposed to ~489 lines, PR #206/T7.2), T-Admin (AdminSongsPage split into useAdminSongs/SongTable/SongEditForm, same PR #206), T-RLSFix (LOGIN-role fixture, PR #205/T7.5), T-RLSCI (isolated `rls suite (isolated)` job, PR #232/T7.6), T-BundleBudget (gzipped-JS budget in `frontend.yml`, PR #232), T-e2eGate (decided: keep label-gated, documented in `testing-strategy.md`, PR #232), T-Dependabot (#133/#114/#147/#182 all merged), T-YoutubeUnique (mig 042 `UNIQUE(youtube_id)`, PR #216/T6.3), T-TotalRounds (mig 040 drop, PR #200/#203/T6.2), and the server-authority half of T-Scoring (D-7 — `award_attempt` booleans, mig 043/044, PR #218/#220).

---

## A. Code quality & simplification

- **T-Scoring · Single source of truth for scoring amounts.** ✅ **server-authority half DONE (D-7 / T7.1, mig 043/044, PR #218/#220)** — `award_attempt` now takes booleans (title/artist/wrong) and derives +10/+5/+15/−3 server-side, so a frontend typo can no longer corrupt real scores. **Residual (small, autonomous):** consolidate the frontend display/toast constants into one shared module the toasts import (pairs with **T-ScoringTest** below).
- ~~**T-Manager · Decompose `ManagerConsolePage.tsx`.**~~ ✅ **done (PR #206, T7.2)** — extracted `useSongPrebuffer` + `useScoring`; the page dropped from ~1066 to ~489 lines; the ~48-case `ManagerConsolePage.test.tsx` guarded the refactor.
- ~~**T-Admin · Split `AdminSongsPage.tsx`.**~~ ✅ **done (PR #206, T7.2)** — split into `useAdminSongs` + `SongTable` + `SongEditForm` (page ~639 → 219 lines); the page-index clamp bug is fixed (`useAdminSongs.ts`) and pinned by a test. (Issue #249 was mis-filed and closed as already-done.)
- **T-SongFetch · De-duplicate the song-fetch block.** ✅ shipped 2026-07-09 (PR #194, with Phase 4 T4.7) — the shared helper landed as `fetchSongById()` in `lib/songMetadata.ts` (not `lib/soundtrack.ts`) because it also carries the F-P1-7 bounded-backoff retry; both pages call it, and the select string + `as unknown as` cast live in that one tested spot.
- ~~**T-RpcError · Uniform RPC error shape.**~~ ✅ done 2026-07-10 (PR #202). `RpcError` + a new `throwOnRpcError()` helper live in `lib/rpcError.ts` (re-exported from `useManagerActions` for back-compat); all six direct-RPC sites use it, so `useBuzzer` now throws the shared `RpcError` instead of the raw PostgREST error. `lib/rpcError.test.ts` added.
- ~~**T-Deps · Audit the 4 `react-hooks/exhaustive-deps` disables.**~~ ✅ verified already satisfied 2026-07-10 — all 4 disables already carry a reason comment. No code change needed.

## B. Dead code & repo hygiene

- ~~**T-DeadCode · One-sweep dead-code removal.**~~ ✅ done 2026-07-10 (PR #201). Deleted `Scoreboard.{tsx,test.tsx,module.css}` (dead), dropped the CLAUDE.md mention + the stale `testing-strategy.md` test-table row + two illustrative code comments, and removed the tracked `create-page-after-fix.png`.
- ~~**T-Lockfile · Un-ignore `frontend/package-lock.json`.**~~ ✅ **done 2026-07-11 (PR #224).** Gate verified met (Node 22 / npm 10.9+ since 2026-05-07; `frontend.yml` `npm ci`s when a lockfile is present). Root cause doubly moot — Vite 8 uses **Rolldown**, and the regenerated lockfile records all 15 platform bindings incl. `@rolldown/binding-linux-x64-gnu`. Follow-up: setup-node npm cache re-enabled in `frontend.yml` (#225) + `e2e.yml` (#226), Node 20→22 sync (#227). All merged, `main` CI green.

## C. Tests

- ~~**T-RLSFix · Properly fix the RLS anon-test fixture contamination.**~~ ✅ **done (PR #205, T7.5)** — the fixture now connects as a dedicated non-superuser `LOGIN` role instead of `SET ROLE anon`, fixing the cross-testcontainer privilege-leak flake at its root; a `current_user` assertion fails loudly on a bad role-switch.
- ~~**T-RLSCI · Isolated CI job for the RLS suite.**~~ ✅ **done (PR #232, T7.6)** — `test_rls_anon.py` + `test_rls_function_grants.py` run as their own fresh-container `rls suite (isolated)` job for a deterministic green/red signal.
- **T-ScoringTest · Bind toasts to scoring constants in a test.** `[S]` No test asserts the "+10"/"−3" toast strings derive from `TITLE_POINTS`/`WRONG_BUZZ_PENALTY` (the test hardcodes "+10" independently). One test importing the constants catches drift — pairs with the T-Scoring frontend-constant residual above. (Open, autonomous.)
- **T-CascadeTest · Pin the Realtime cascade-delete UX.** ✅ shipped 2026-07-08 (PR #192, with T4.4) — three `TeamGameplayPage` vitest cases pin the ordering; `expiration.spec.ts` requires the banner (no redirect tolerance).

## D. CI & bundle discipline

- ~~**T-BundleBudget · Bundle-size budget in CI.**~~ ✅ **done (PR #232, T7.6)** — a dependency-free gzipped-JS bundle-budget step in `frontend.yml` (measured 350037 B, budget 410000 B); a deliberate oversize import fails the PR.
- ~~**T-e2eGate · Decide whether e2e gates PRs.**~~ ✅ **decided (PR #232, T7.6)** — keep **label-gated** (don't block every PR on the ~13-min run given the #222 YouTube flake); rationale documented in `docs/testing-strategy.md`.
- ~~**T-Dependabot · Clear the 4 open dependabot PRs.**~~ ✅ **done** — #133 (checkout v7), #114 (codecov v7), #147 (@playwright/test), #182 (@types/node) all merged; queue clear.

## E. Docs drift (residual — all fixed)

**Re-verified 2026-07-07:** the original "76 findings" headline had no backing item list, and most named drifts were fixed by the Phase 1–3 doc syncs.

- ~~**T-DocDataModel · `docs/data-model.md` residual drift.**~~ ✅ **Done (PR #199, T6.1).** Intro → eleven tables in three groups; §5/§6 → the six anon-EXECUTE RPCs (incl. `extend_game`, mig 039).
- ~~**T-DocContracts · `api-contracts.md` anon surface + removed endpoints.**~~ ✅ **Done (PR #199, T6.1).**
- ~~**T-DocGameRules · `game-rules.md` host-transition auth.**~~ ✅ **Done (PR #199, T6.1).** State table → open-hosting / `manager_token` model.

## F. Schema hygiene

- ~~**T-YoutubeUnique · `UNIQUE` on `songs.youtube_id`.**~~ ✅ **done (PR #216, T6.3, mig 042).** Prod was already dupe-free, so the idempotent `UNIQUE(youtube_id)` index shipped + applied; ISRC dedup (#146) is a separate later enrichment (D-8).
- ~~**T-TotalRounds · Drop the orphan `active_games.total_rounds`.**~~ ✅ **done (PR #200/#203, T6.2, mig 040).** Column dropped; `data-model.md` synced; mig 015 made absence-tolerant for full-set replay.
