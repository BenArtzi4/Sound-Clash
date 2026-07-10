# 04 — Tech debt, tests, CI, docs drift, hygiene

Steady autonomous cleanup that makes the app easier to keep production-perfect. None is user-visible on its own (so most carry no CHANGELOG entry), but several remove real footguns. Effort S/M/L.

> **Resolved items removed 2026-07-05:** T-KeepWarm (Phase 3 T3.5 — kept as documented visibility-aware fallback), T-DocRunbook (Phase 1 T1.6 — DR section corrected), T-AttemptsRLS (Phase 3 T3.3 / mig 037 — RLS on + anon revoked). Detail in git history.
> **Resolved items removed 2026-07-07 (verified against code):** T-DocRPC (peek_next_song documented, §8 in-body auth acknowledged, removed endpoints reframed — fixed by the Phase-3-era doc syncs); T-Roadmap (moot — the historical `docs/roadmap.md` was removed in the 2026-07 planning reorg; `docs/planning/` is the roadmap now).

---

## A. Code quality & simplification

- **T-Scoring · Single source of truth for scoring amounts.** `[M — borderline decision, see D-7]` Point values (+10/+5/+15/−3/+4) live in browser TS (`useManagerActions.ts:12-14`) and are passed *into* `award_attempt`, which is a dumb applier — a frontend typo (`TITLE_POINTS=100`) silently corrupts real scores, and the values are duplicated across ~6 places. Refactor `award_attempt` to take booleans (title/artist/wrong) + derive soundtrack-ness from genre membership server-side (mig 028 pattern — the `is_soundtrack` column was dropped in mig 025), compute + cap points in the DB; expose the 5 constants from one shared module the toasts import. **Touches the hot manager RPC → treat carefully; recommend but flag (D-7).**
- **T-Manager · Decompose `ManagerConsolePage.tsx` (1066 lines).** `[M]` The god component where the peek/commit race lives. Extract `useSongPrebuffer` (peek/standby/epoch/commit) and `useScoring` (award handlers + inFlight refs); leave the page as layout+wiring. The strong existing `ManagerConsolePage.test.tsx` (~48 cases) guards the refactor.
- **T-Admin · Split `AdminSongsPage.tsx` (639 lines).** `[M/low]` Extract `SongTable`, `SongEditForm`, `useAdminSongs`. Also cleanly fixes the page-index clamp (prior finding) and enables I-Admin.
- **T-SongFetch · De-duplicate the song-fetch block.** ✅ shipped 2026-07-09 (PR #194, with Phase 4 T4.7) — the shared helper landed as `fetchSongById()` in `lib/songMetadata.ts` (not `lib/soundtrack.ts`) because it also carries the F-P1-7 bounded-backoff retry; both pages call it, and the select string + `as unknown as` cast live in that one tested spot.
- **T-RpcError · Uniform RPC error shape.** `[S]` `useBuzzer` throws the raw PostgREST error while sibling hooks wrap `RpcError`, so shared error-branching/telemetry can't treat buzz uniformly. Add a `throwOnRpcError()` helper all five direct-RPC sites use.
- **T-Deps · Audit the 4 `react-hooks/exhaustive-deps` disables.** `[S]` `SongExport.tsx:90`, `DisplayPage.tsx:124`, `ManagerConsolePage.tsx:164,238` — the effects most prone to stale-closure bugs (song reload, prebuffer). Add explicit deps or ref-reads with a one-line reason each.

## B. Dead code & repo hygiene

- **T-DeadCode · One-sweep dead-code removal.** `[S]` Delete `Scoreboard.tsx` + `.test.tsx` + `.module.css` (177 lines, all dead) and drop the CLAUDE.md mention; remove the tracked `create-page-after-fix.png` at repo root (not covered by any gitignore rule). (`screenshots/` and `.playwright-mcp/` verified untracked — nothing to do there.)
- **T-Lockfile · Un-ignore `frontend/package-lock.json`.** `[S]` `.gitignore:35` excludes it ("temporarily untracked" due to an npm-10 Linux-runner bug ~3 weeks stale). Without it the Cloudflare deploy resolves `^` ranges fresh each build → non-reproducible deploys. Re-verify the npm bug, then commit the lockfile. **CI/deploy-adjacent — verify before flipping.**

## C. Tests

- **T-RLSFix · Properly fix the RLS anon-test fixture contamination.** `[M]` The lessons-learned "fix" is already in place yet the flake persists (root cause: the `anon` role retains privileges across testcontainer reuse). Real fix: connect as a dedicated non-superuser `LOGIN` role (`CREATE ROLE anon_login LOGIN;`) instead of `SET ROLE anon` (`tests/db/conftest.py:124`), and assert `SELECT current_user = 'anon'` in the fixture so a failed role-switch fails loudly. (The suite-coverage half — `game_round_attempts` + the three `game_history` tables — already shipped in `test_rls_anon.py`; only the fixture fix remains.)
- **T-RLSCI · Isolated CI job for the RLS suite.** `[S]` Run `test_rls_anon.py` + `test_rls_function_grants.py` as their own fresh-container job so the security matrix has a deterministic green/red signal instead of being folded into a 200-test run where its flake is ignored. **CI change → flag per repo rules.**
- **T-ScoringTest · Bind toasts to scoring constants in a test.** `[S]` No test asserts the "+10"/"−3" toast strings derive from `TITLE_POINTS`/`WRONG_BUZZ_PENALTY` (the test hardcodes "+10" independently). One test importing the constants catches drift — pairs with T-Scoring.
- **T-CascadeTest · Pin the Realtime cascade-delete UX.** ✅ shipped 2026-07-08 (PR #192, with T4.4) — three `TeamGameplayPage` vitest cases pin the `game_teams`-before-`active_games` ordering (expired → banner, live-game kick → Home, ended → podium stays), and `expiration.spec.ts` now requires the banner (no redirect tolerance).

## D. CI & bundle discipline

- **T-BundleBudget · Bundle-size budget in CI.** `[S — CI change, flag]` Sentry (~22KB) and Faro (~58KB) accreted silently. A post-build assert (entry gz < 110KB, total route JS < 250KB) or `rollup-plugin-visualizer` output in the PR keeps the load-path culture honest.
- **T-e2eGate · Decide whether e2e gates PRs.** `[S — CI change, flag]` Verified: `e2e.yml` runs only on push-to-main / dispatch / `run-e2e`-labeled PRs, so it does **not** gate normal PRs; the backend coverage ratchet is at 90 (not stuck at 0 — that old claim was itself drift). Whether e2e should block merge is a policy call for the maintainer.
- **T-Dependabot · Clear the 4 open dependabot PRs.** `[S]` #133 (checkout v7), #114 (codecov v7), #147 (@playwright/test), #182 (@types/node 26) — review and take the safe ones (#148 already closed). **Merging is the user's call**; Claude opens/updates, doesn't merge.

## E. Docs drift (residual — most of the original findings are already fixed)

Docs are the authoritative spec; these are bugs by the repo's own rule. **Re-verified 2026-07-07:** the original "76 findings" headline had no backing item list, and most named drifts were fixed by the Phase 1–3 doc syncs (T-DocRPC done; the 409-vs-410 contracts claim turned out false — code returns 409). What actually remains fits one small sync PR:

- ~~**T-DocDataModel · `docs/data-model.md` residual drift.**~~ ✅ **Done (PR #199, T6.1).** Intro → eleven tables in three groups (the "ten" estimate missed `game_round_attempts`, a real table absent from the §2 DDL block); §5/§6 → the six anon-EXECUTE RPCs (incl. `extend_game`, mig 039); §6 caller column corrected.
- ~~**T-DocContracts · `api-contracts.md` anon surface + removed endpoints.**~~ ✅ **Done (PR #199, T6.1).** §3 "only one function exposed to anon" line fixed. The X-Manager-Token list (~line 71) was already corrected in an earlier Phase 4 sync — no removed endpoints remained.
- ~~**T-DocGameRules · `game-rules.md` state table attributes host transitions to "(admin auth)"**~~ ✅ **Done (PR #199, T6.1).** State table → open-hosting / `manager_token` model.

(The `CLAUDE.md` Scoreboard mention goes with T-DeadCode when the component is deleted; the runbook's stale legacy-AWS-fallback line and its build-docs pointer were fixed in the 2026-07 planning reorg.)

## F. Schema hygiene

- **T-YoutubeUnique · `UNIQUE` on `songs.youtube_id`.** `[M]` The de-facto natural key has no constraint; all dedup is race-prone app-side check-then-insert. Requires a one-time dedup pass on prod's ~1025 rows first, then add the unique index. Relates to **#146 (ISRC dedup)** — decide whether ISRC supersedes this (D-8). Makes the invariant structural.
- **T-TotalRounds · Drop the orphan `active_games.total_rounds`.** `[S]` Mig 015 promised the drop; it never landed. No code reads it. Drop it and sync data-model.md.
