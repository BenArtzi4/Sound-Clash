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
- [ ] Refactor `award_attempt` to take booleans + derive soundtrack-ness from genre membership server-side (mig 028 pattern — there is **no** `is_soundtrack` column; it was **finally dropped in mig 028**, not 025: 025 dropped it, 027 re-added it, 028 dropped it for good), compute + cap points in the DB.
- [ ] Expose the 5 UI constants from one shared module the toasts import; add the value-cross-check test (T-ScoringTest).
- [ ] Behind the buzz-race + full-game gate; own PR.

#### T7.1 implementation plan (scoped 2026-07-10 night — **deferred to a maintainer-coordinated session**)

A read-only reconnaissance pass produced the plan below. **Not implemented autonomously** because it is (a) a scoring/game-rule change → EXECUTION-CONTRACT §4/§6 says bring it to the maintainer with a concrete recommendation; (b) a `DROP FUNCTION` signature change on the buzz-path hot function needing a **prod migration coordinated with the frontend deploy**; (c) it must **stack on the unmerged #206** (which moved every scoring call site into `useScoring.ts`).

**Current state (facts):**
- Authoritative body: `db/migrations/036_award_attempt_collapse_writes.sql`. Signature `award_attempt(p_game_code text, p_round_id uuid, p_title integer, p_artist integer, p_wrong_buzz integer, p_manager_token uuid)` — **points are passed IN as client integers** (10/5/3); the function only branches on `> 0` and does arithmetic on the passed magnitudes. This is the client-controlled-scoring footgun (a client can send `p_title: 999`).
- Client already speaks booleans at the handler level: `frontend/src/hooks/useManagerActions.ts` `awardAttemptDirect()` takes `{title_correct, artist_correct, wrong_buzz}` and converts `? N : 0` **at the wire** using local consts `TITLE_POINTS=10 / ARTIST_POINTS=5 / WRONG_BUZZ_PENALTY=3` (lines 18–20). Toasts/labels use hardcoded literals (`+10`/`+5`/`+15`/`-3`/`+4`) in `ManagerConsolePage.tsx` (post-#206: in `useScoring.ts`). **No shared scoring-constants module exists yet.**
- Soundtrack "+15" is an **emergent client trick**: `handleCorrectSoundtrack` sends BOTH `title_correct` and `artist_correct` → the DB sums 10+5=15 with **zero soundtrack awareness**. The DB uses two independent claims (`title_claimed_by`, `artist_claimed_by`, potentially different teams). The `+15 = title+artist` identity is load-bearing across the frontend, mig-036's `title_artist` outcome branch, and the tests.
- Soundtrack-from-genre pattern (reuse from `select_next_song`, mig 028): `EXISTS (SELECT 1 FROM song_genres sg JOIN genres g ON g.id=sg.genre_id WHERE sg.song_id=<id> AND g.slug IN ('soundtracks','israeli-soundtracks'))`. The slug list is mirrored in `backend/app/constants.py:15` and `frontend/src/lib/soundtrack.ts:11`. `game_rounds` has `song_id` (award_attempt does not currently read it).
- Highest migration is **040** → the new one is **041**. Signature change (integers→booleans) needs `DROP FUNCTION award_attempt(text,uuid,integer,integer,integer,uuid)` first (CREATE OR REPLACE can't change param types), then recreate + re-`GRANT EXECUTE ... TO anon, authenticated, service_role` with the new type list. Watch overload ambiguity (mig-021 lesson: no DEFAULTs on the new args).

**⚠️ Design fork (needs the maintainer's call):**
- **Design 1 — DB owns the magnitudes, behavior byte-identical (RECOMMENDED).** Signature becomes `award_attempt(p_game_code text, p_round_id uuid, p_correct_title boolean, p_correct_artist boolean, p_wrong boolean, p_manager_token uuid)`. The DB computes `v_title = CASE WHEN p_correct_title THEN 10 END`, etc. Soundtrack stays as **both-flags → 10+5=15** exactly as today; the two-independent-claims model is untouched; mig-036's branches are unchanged apart from reading booleans. **This fully delivers the integrity goal** ("compute + cap points in the DB" — a client can no longer send arbitrary magnitudes) with **zero player-visible change** and minimal risk. Note: in this design the genre lookup is **not needed** — because soundtrack=both-flags already yields 15 without any soundtrack awareness, so "derive soundtrack-ness from genre" adds nothing to the security fix.
- **Design 2 — soundtrack first-class (larger, optional).** The DB derives soundtrack-ness from genre and awards a **flat +15 as a single claim** on soundtrack rounds (client sends one `p_correct`), vs 10/5 two-claims on normal rounds. This changes the claim model (one 15-pt claim vs two), the outcome enum, and the terminal fully-scored state the UI expects. It is a **behavior/model change**, not required for the integrity win.

**Recommendation:** ship **Design 1** as T7.1 (the real footgun is client-controlled magnitudes; Design 1 closes it with no behavior change and passes the exit gate's "values unchanged" bar cleanly). Treat Design 2 (genre-derived flat-15 single claim) as a **separate, optional follow-up** only if the maintainer wants the DB to own soundtrack semantics — flag that the original "derive soundtrack-ness from genre" wording implies Design 2, which is why this needs their decision.

**Migration number: this is now mig 043** (041 = #211 buzz_in guard, 042 = #216 youtube_id UNIQUE — both merged + live on prod as of 2026-07-10). Off `main` (#206 is merged; no longer stacked).

**⚠️ Rollout safety — use the DUAL-OVERLOAD pattern (mig-021), NOT a DROP+replace.** The new boolean signature changes the wire contract: the moment the new frontend deploys it sends booleans, and the moment mig 043 lands the old integer frontend (any tab still loaded) would break if the integer overload is gone. So do NOT `DROP FUNCTION` the integer signature in mig 043. Instead **ADD the boolean overload alongside the existing integer one** — both coexist. PostgREST routes by the named-arg set + types (`p_correct_title boolean` vs `p_title integer` differ in both name and type), so there's no ambiguity — **but per the mig-021 lesson, give the new boolean args NO DEFAULTs** or overload resolution breaks. This makes mig 043 **backward-compatible and safe to apply to prod at any time, decoupled from the deploy**. A later **mig 044** drops the integer overload once no old clients remain.

**Implementation steps (Design 1), as ONE PR off `main`:**
1. **mig 043**: `CREATE OR REPLACE FUNCTION award_attempt(p_game_code text, p_round_id uuid, p_correct_title boolean, p_correct_artist boolean, p_wrong boolean, p_manager_token uuid)` computing magnitudes server-side (keep the mig-036 single-UPDATE-RETURNING economy; the `*_points` columns now store DB-computed values); `GRANT EXECUTE ... TO anon, authenticated, service_role` on the new signature. **Leave the existing integer `award_attempt(...,integer,integer,integer,...)` in place** (dual overload — see rollout note above). Idempotent, applied twice locally. Label the PR **`run-stress` + `run-e2e`**.
2. **`frontend/src/lib/scoring.ts`** (new): `TITLE_POINTS=10, ARTIST_POINTS=5, SOUNDTRACK_POINTS=15, WRONG_BUZZ_PENALTY=3, BONUS_POINTS=4`. Import in `useManagerActions.ts` + the toast/label sites in `useScoring.ts`/`ManagerConsolePage.tsx` — **output strings must stay byte-identical** so the 64-case `ManagerConsolePage.test.tsx` passes untouched (build `+${TITLE_POINTS} to ${name}` etc., mind the `-3` sign).
3. Change `awardAttemptDirect` to send booleans (`p_correct_title` …); update `useManagerActions.test.ts` (asserts `p_title:10` today → `p_correct_title:true`).
4. **`tests/db/test_award_attempt.py`**: the `_attempt()` helper + ~25 call sites + 3 raw-SQL literals (`award_attempt($1,$2,10,0,0,$3)`) flip to booleans; mig-036 preservation asserts (`title_points==10`) still hold (now DB-sourced).
5. **T-ScoringTest** (new `frontend/src/lib/scoring.test.ts`): cross-check the 5 constants against expected values, and reconcile `BONUS_POINTS` against the backend `AwardBonusRequest.points` default=4 (`backend/app/models/games.py:60`) + `award_bonus` `p_points DEFAULT 4` (mig 014) — note bonus flows through a *different* function (`award_bonus`, service-role), so the module holds it but the cross-check is a documented constant, not an import.
6. **Docs same PR**: `docs/rpc-functions.md` §3 (signature block + behavior bullets), `docs/api-contracts.md` §2.5/§3 (client call + arg tuple), `docs/data-model.md` (RPC table row ~line 308 + migration index), `docs/game-rules.md` §4/§4a (esp. the line that says "fires `award_attempt` with `p_title=10, p_artist=5`" → boolean-flags wording). CHANGELOG only if any player-visible value changes (Design 1: none → no entry).
7. **Prod rollout — concrete safe order (dual overload makes this low-risk):**
   1. **Apply mig 043 to prod FIRST** (`supabase db query --linked -f db/migrations/043_...`). It only ADDS the boolean overload; the live integer-sending frontend is unaffected. Verify both overloads exist (`SELECT count(*) FROM pg_proc WHERE proname='award_attempt'` → 2).
   2. **THEN merge the PR** → Cloudflare Pages auto-deploys the boolean-sending frontend. New clients route to the boolean overload; any still-open old tab routes to the integer overload. No breakage either way.
   3. **Verify scoring on prod** end-to-end (title=10 / artist=5 / soundtrack=15 / wrong=−3 / bonus=+4) — the exit gate's "values unchanged" bar.
   4. **Follow-up (separate PR + mig 044, hours/days later once no old tabs remain):** `DROP FUNCTION award_attempt(text,uuid,integer,integer,integer,uuid);` to retire the now-dead integer overload (mirrors mig-023 which retired the legacy overloads after the direct-RPC path stabilised).
   **Do NOT merge before applying mig 043** — merging first deploys a boolean-sending frontend against a prod that has no boolean overload → live scoring breaks. This is the F-P0-4 "hard-required migration before deploy" rule.

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
- [x] `T-Dependabot`: ✅ all four merged 2026-07-10 (#147 @playwright/test, #182 @types/node, #114 codecov-action v7, #133 checkout v7) with maintainer authorization; Backend/Frontend/CodeQL green on `main` after the CI-action bumps.

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
