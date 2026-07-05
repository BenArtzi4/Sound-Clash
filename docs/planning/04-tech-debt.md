# 04 — Tech debt, tests, CI, docs drift, hygiene

Steady autonomous cleanup that makes the app easier to keep production-perfect. None is user-visible on its own (so most carry no CHANGELOG entry), but several remove real footguns. Effort S/M/L.

> **Resolved items removed 2026-07-05:** T-KeepWarm (Phase 3 T3.5 — kept as documented visibility-aware fallback), T-DocRunbook (Phase 1 T1.6 — DR section corrected), T-AttemptsRLS (Phase 3 T3.3 / mig 037 — RLS on + anon revoked). Detail in git history.

---

## A. Code quality & simplification

- **T-Scoring · Single source of truth for scoring amounts.** `[M — borderline decision, see D-7]` Point values (+10/+5/+15/−3/+4) live in browser TS and are passed *into* `award_attempt`, which is a dumb applier — a frontend typo (`TITLE_POINTS=100`) silently corrupts real scores, and the values are duplicated across ~6 places. Refactor `award_attempt` to take booleans (title/artist/wrong) + read `songs.is_soundtrack`, compute + cap points server-side; expose the 5 constants from one shared module the toasts import. **Touches the hot manager RPC → treat carefully; recommend but flag (D-7).**
- **T-Manager · Decompose `ManagerConsolePage.tsx` (999 lines).** `[M]` 16 useRef / 11 useState / 6 useEffect — the god component where both the busy-race and the peek/commit race live. Extract `useSongPrebuffer` (peek/standby/epoch/commit) and `useScoring` (award handlers + inFlight refs); leave the page as layout+wiring. The strong existing `ManagerConsolePage.test.tsx` (~48 cases) guards the refactor.
- **T-Admin · Split `AdminSongsPage.tsx` (633 lines).** `[M/low]` Extract `SongTable`, `SongEditForm`, `useAdminSongs`. Also cleanly fixes the page-index clamp (prior finding) and enables I-Admin.
- **T-SongFetch · De-duplicate the song-fetch block.** `[S]` The identical `as unknown as` cast is copy-pasted across DisplayPage and ManagerConsolePage. Add `fetchSongWithSoundtrack(songId)` to `lib/soundtrack.ts`; both pages call it. Consolidates the select string + cast to one tested spot.
- **T-RpcError · Uniform RPC error shape.** `[S]` `useBuzzer` throws the raw PostgREST error while sibling hooks wrap `RpcError`, so shared error-branching/telemetry can't treat buzz uniformly. Add a `throwOnRpcError()` helper all five direct-RPC sites use.
- **T-Deps · Audit the 4 `react-hooks/exhaustive-deps` disables.** `[S]` `SongExport.tsx:90`, `DisplayPage.tsx:112`, `ManagerConsolePage.tsx:141,205` — the effects most prone to stale-closure bugs (song reload, prebuffer). Add explicit deps or ref-reads with a one-line reason each.

## B. Dead code & repo hygiene

- **T-DeadCode · One-sweep dead-code removal.** `[S]` Delete `Scoreboard.tsx` + `.test.tsx` + `.module.css` (177 lines, all dead) and drop the CLAUDE.md mention; remove the tracked `create-page-after-fix.png` at repo root (not covered by any gitignore rule); check `screenshots/` and `.playwright-mcp/` tracking. ~500 lines + 226KB binary gone.
- **T-Lockfile · Un-ignore `frontend/package-lock.json`.** `[S]` `.gitignore:35` excludes it ("temporarily untracked" due to an npm-10 Linux-runner bug ~3 weeks stale). Without it the Cloudflare deploy resolves `^` ranges fresh each build → non-reproducible deploys. Re-verify the npm bug, then commit the lockfile. **CI/deploy-adjacent — verify before flipping.**

## C. Tests

- **T-RLSFix · Properly fix the RLS anon-test fixture contamination.** `[M]` The lessons-learned "fix" is already in place yet the flake persists (root cause: the `anon` role retains privileges across testcontainer reuse). Real fix: connect as a dedicated non-superuser `LOGIN` role (`CREATE ROLE anon_login LOGIN;`) instead of `SET ROLE anon`, and assert `SELECT current_user = 'anon'` in the fixture so a failed role-switch fails loudly. Extend the RLS suite to cover `game_round_attempts` + the three `game_history` tables.
- **T-RLSCI · Isolated CI job for the RLS suite.** `[S]` Run `test_rls_anon.py` + `test_rls_function_grants.py` as their own fresh-container job so the security matrix has a deterministic green/red signal instead of being folded into a 200-test run where its flake is ignored. **CI change → flag per repo rules.**
- **T-ScoringTest · Bind toasts to scoring constants in a test.** `[S]` No test asserts the "+10"/"−3" toast strings derive from `TITLE_POINTS`/`WRONG_BUZZ_PENALTY` (the test hardcodes "+10" independently). One test importing the constants catches drift — pairs with T-Scoring.
- **T-CascadeTest · Pin the Realtime cascade-delete UX.** `[S]` No test exercises the `game_teams`-before-`active_games` delete ordering that routes players to Home instead of the expiry screen (F-P1-2). A reducer/e2e case locks in the intended "ended/expired" UX.
- **T-DeployTest · e2e for deploy-during-game / preloadError.** `[S]` Guard F-P0-3 with a test that simulates a failed dynamic import → reload.

## D. CI & bundle discipline

- **T-BundleBudget · Bundle-size budget in CI.** `[S — CI change, flag]` Sentry (~22KB) and Faro (~58KB) accreted silently. A post-build assert (entry gz < 110KB, total route JS < 250KB) or `rollup-plugin-visualizer` output in the PR keeps the load-path culture honest.
- **T-e2eGate · Decide whether e2e gates PRs.** `[S — CI change, flag]` Read `e2e.yml` triggers; confirm the coverage ratchet isn't stuck at 0. Whether e2e should block merge is a policy call for the maintainer.
- **T-Dependabot · Clear the 4 open dependabot PRs.** `[S]` #133 (checkout v7), #114 (codecov v7), #147 (@playwright/test), #148 (@types/node) — review and take the safe ones. **Merging is the user's call**; Claude opens/updates, doesn't merge.

## E. Docs drift (76 findings — the biggest single category)

Docs are the authoritative spec; these are bugs by the repo's own rule. Batch into 1–2 sync PRs. Highlights:

- **T-DocDataModel · `docs/data-model.md` is stale & security-misleading.** `[S]` §5 says `buzz_in` is the only anon-EXECUTE function (false — 4 more since mig 021/022/029); §6 documents the dropped 5-arg `award_attempt` signature and FastAPI as caller (it's the browser); omits `game_round_attempts`, its indexes, the still-live `total_rounds`, and the three history tables; intro says "Six tables" (there are ten). Regenerate the DDL from migrations 001–033.
- **T-DocRPC · `rpc-functions.md` caller matrix.** `[S]` Omits `peek_next_song`; §8 denies the in-body auth that five functions actually perform; documents removed REST endpoints.
- **T-DocContracts · `api-contracts.md` status codes & anon surface.** `[S]` Claims already-ended game returns 409 on /bonus,/end (code returns 410 Gone); "only `buzz_in` exposed to anon"; documents removed `select-song`/`attempt`/`end-round`.
- **T-DocGameRules · `game-rules.md` state table attributes host transitions to "(admin auth)"** — pre-open-hosting; it's `manager_token` now.
- **T-Roadmap · Reconcile roadmap "Out of Scope."** Game history archive shipped (mig 033) despite being listed out-of-scope; song export shipped. Update the list.

## F. Schema hygiene

- **T-YoutubeUnique · `UNIQUE` on `songs.youtube_id`.** `[M]` The de-facto natural key has no constraint; all dedup is race-prone app-side check-then-insert. Requires a one-time dedup pass on prod's ~1025 rows first, then add the unique index. Relates to **#146 (ISRC dedup)** — decide whether ISRC supersedes this (D-8). Makes the invariant structural.
- **T-TotalRounds · Drop the orphan `active_games.total_rounds`.** `[S]` Mig 015 promised the drop; it never landed. No code reads it. Drop it and sync data-model.md.
