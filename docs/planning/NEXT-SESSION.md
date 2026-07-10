# Next session — start here

_Last updated: 2026-07-10 (**late /next-task loop** — **merged the whole queued stack** #205→#206→#207→#209 + independent #208 (the maintainer's explicit in-session "merge all previous PRs" unblocked the classifier — see below), then shipped **T5.7 same-name reclaim (#210, merged)**, ran an **11-agent adversarial security re-verify** (D-1 confirmed closed; 3 new findings logged in `01-fixes.md`), and opened **#211 (buzz_in cross-game guard, mig 041)** — green, **handed to the maintainer to merge + apply to prod** (buzz-path + prod migration, not self-merged). Autonomous code surface is now **exhausted** — everything left needs a maintainer decision, prod access, a CI/flag change, or touches the untouchable `tools/song-curation/*`.)_

> ### ⚠️ Maintainer actions pending (can't be done autonomously)
> 1. **Merge + apply #211 (security fix — F-P1-9).** `fix/buzz-in-cross-game-guard`, base `main`, CI-green (incl. the labelled 100× buzz-race stress + e2e migration-replay gates). Adds mig **041** — one predicate scoping `buzz_in`'s lock to a team that belongs to the game, closing a **cross-game score-write** path (a host with only their own game's token — or any anon for the lock-grief half — could plant a foreign game's team in the buzz lock; `award_attempt` then mutated that team's score). Not self-merged because it's buzz-path + a prod migration. **To ship:** `gh pr merge 211 --squash` (keep branch), then apply mig 041 to prod (`supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/041_buzz_in_scope_team_to_game.sql`), then `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org`. mig 041 is backward-compatible (rejects only non-member teams; legit same-game buzzes unaffected), so apply order vs any deploy is flexible.
> 2. **Verify mig 040 is applied to prod** (T6.2 — the orphan `total_rounds` drop; deferred earlier as a hard-required-nothing change). If not yet applied: `supabase db query --linked -f db/migrations/040_drop_total_rounds_column.sql`. Prod is safe either way (mig 015 is guarded).
> 3. **Unblock T6.3** (`UNIQUE(songs.youtube_id)` + prod dedup). Needs a **read-only prod query** for duplicate `youtube_id`s, which the auto-mode classifier denies without you present. Run it *with* the maintainer. Details in "What to do next".
> 4. **Note on `db/migrations` numbering:** mig **041** is now taken by #211. The T7.1 plan in `phase-7-tech-debt.md` still says "mig 041" for its `award_attempt` rewrite — that becomes **mig 042** (or later) once #211 merges.

## Short prompt to paste into the fresh session

> **Continue the Sound Clash plan. Read `docs/planning/NEXT-SESSION.md` first, then follow `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-7-tech-debt.md`. Read `.claude/rules/lessons-learned.md` before running anything (esp. the three 2026-07-10 entries: migration-idempotency, the stacked-squash-merge / merge-classifier note, and the security re-verify).** FIRST: confirm the maintainer merged **#211** (buzz_in security fix) and applied **mig 041** to prod. Then the top remaining work all needs the maintainer or a flag: **T7.1** (scoring authority, D-7 — a full plan + Design-1-vs-2 fork is already written under T7.1 in `phase-7-tech-debt.md`; do it with the maintainer, it's a buzz-race-gated `award_attempt` rewrite + prod migration — now **mig 042**, not 041), **T6.3** (read-only prod dupe query, with the maintainer), **T7.6** (CI — flag first), **T5.6** (Cloudflare infra). The only clean **autonomous** leftover is **F-P2-6** (bulk-import upload size cap — admin-gated, backend-only, no migration; in `01-fixes.md`). T5.2 team-name guard needs a maintainer content-policy call (Hebrew-primary + emoji). The maintainer is button-averse: prefer zero-UI/auto fixes; confirm before any button. Any `db/migrations/**` PR MUST get `run-stress` + `run-e2e` labels. Autonomous `gh pr merge` works **only when the current user prompt explicitly authorizes merging** — otherwise hand merges to the maintainer.

(Or just run the local **`/next-task`** skill — it encodes the same loop.)

---

## Where things stand (2026-07-10)

- **Phases 1–4 ✅ complete and live on prod** (`https://www.soundclash.org`). PRs #150–#197 merged; DB migrations through **040** applied on prod (`jvfddxuaqcsrguibkymp`) — **verify 040/041** per the ⚠️ box.
- **Phase 5 — in progress.** Shipped: D-1/T5.5 (mig 034), T5.3 (mig 037), T5.7-docs + T5.8 (#208), and now **T5.7 same-name reclaim code (#210)**. Remaining items all need a maintainer decision or touch `tools/song-curation/*` (T5.1) — see below. Not closable autonomously.
- **Phase 6** — T6.1 (#199) + T6.2 (#200/#203) done; **T6.3** (youtube_id dedup + UNIQUE) blocked on maintainer prod access.
- **Phase 7** — T7.2 (#206), T7.3 (#202), T7.4-DeadCode (#201), T7.5 (#205) done. Remaining: **T7.1** (scoring authority — planned, maintainer-coordinated), T7.4-Lockfile (verify-first), T7.6 (CI — flag). Not autonomous.
- **Phase 8** — not started; the maintainer's uncommitted `phase-8-features.md` carries vetoes (no auto-release/practice/streaks; SFX must not slow the buzz; explain GenreSpotlight + win-conditions before building). Needs maintainer direction.
- **Security posture (re-verified 2026-07-10, 11-agent adversarial workflow):** core two-principal auth boundary holds; **D-1 confirmed closed** (manager_token unreachable by anon), D-2/D-4 documented. 3 new findings logged (below) — one medium (fixed in #211), two low.

## What shipped this session (2026-07-10 late)

- **Merged the full queued stack** — #205 (T7.5), #206 (T7.2), #207 (eve handoff), #208 (T5.7/T5.8 docs), #209 (night handoff + the T7.1 plan). The stacked squash-merges needed manual `gh pr edit <n> --base main` between each (GitHub doesn't auto-retarget when branches are kept) and a worktree to resolve the NEXT-SESSION.md conflicts on the two handoff PRs. Verified post-merge: the #206 refactor survived intact (`ManagerConsolePage` 489 lines, all hook/component files present), 452 frontend tests green.
- **T5.7 ✅ (PR #210, merged)** — `POST /games/{code}/teams` (`_join_team_blocking`) now reclaims an existing `(game_code, name)` team (same id, **preserved score**) instead of 409'ing. Discovery: `game_teams` already has `UNIQUE(game_code, name)` (mig 003), so the old behavior was a 409, not a duplicate — the reclaim turns it into a resume and the constraint stays as the concurrent-insert backstop. Real-Postgres `db`-fixture test; no frontend change (transparent). Docs synced (api-contracts / security-rls §4 / game-rules); F-P2-1 closed.
- **Security re-verify ✅ (read-only, no prod, no writes)** — confirmed D-1 closed + D-2/D-4 documented; found 3 new gaps, now in `01-fixes.md`: **F-P1-9** (medium, cross-game score write — fixed in #211), **F-P2-5** (low, per-IP rate limits collapse to one bucket behind the proxy — needs `--proxy-headers`, deploy-config flag), **F-P2-6** (low, bulk-import has no upload size cap — admin-gated; clean autonomous backend hardening for a future session).
- **#211 opened (F-P1-9 fix) — green, handed to maintainer** — mig 041 adds one `AND EXISTS (… game_teams gt WHERE gt.id=p_team_id AND gt.game_code=p_game_code)` predicate to `buzz_in`'s atomic UPDATE (byte-identical to mig 035 otherwise; race preserved). `run-stress`+`run-e2e` labelled. See ⚠️ box #1.

## What to do next

**All remaining work needs the maintainer, a flag, or is off-limits — except F-P2-6.**

1. **F-P2-6 (autonomous, clean)** — add an upload size cap to `bulk_import` (`backend/app/routers/admin_songs.py:235`, unbounded `await file.read()`): reject on `Content-Length` above a small cap and/or chunked read → HTTP 413. Admin-gated, backend-only, no migration, no buzz-path. Effort S. Good first task for the next autonomous session.
2. **T7.1** `[M, D-7]` (with the maintainer) — scoring single-source-of-truth. Full plan + Design-1-vs-2 fork under T7.1 in `phase-7-tech-debt.md`. Decide the fork first (recommend **Design 1**: DB owns magnitudes, behavior byte-identical). Buzz-race-gated `award_attempt` rewrite (`DROP FUNCTION` + boolean args), **now mig 042** (041 is taken by #211), prod migration coordinated with the frontend deploy. Exit gate: scoring values unchanged (title=10/artist=5/soundtrack=15/wrong=−3/bonus=+4). Consider folding F-P1-9's defense-in-depth (game-scope check in `award_attempt`) into this PR.
3. **T6.3** (with the maintainer) — read-only prod query for duplicate `youtube_id`s → dedup (merge, repoint `song_genres`, delete losers; leave the Avicii "Wake Me Up" same-song-**different-video** pair alone) → idempotent `UNIQUE(songs.youtube_id)` migration. Consider one migration that dedups **then** adds the constraint. Label `run-stress` + `run-e2e`.
4. **Flag-first / infra:** T7.6 (CI job for RLS suite, bundle budget, e2e gate), T7.4-Lockfile (verify the npm-10 runner bug is gone first), F-P2-5 (`--proxy-headers`), T5.6 (Cloudflare), T5.4 (history retention window — decision).
5. **T5.2 team-name guard** — needs a maintainer **content-policy** call: the game is Hebrew-primary and party-flavored, so a naive profanity/emoji/control-char filter risks rejecting legit Hebrew names (RTL is normal) or wanted emoji. Get the policy before implementing; the "objective" subset (reject C0/C1 control chars only) is low-value on its own (React escapes; names are length-capped).

## The per-PR loop (from EXECUTION-CONTRACT.md — don't skip)

Branch (`fix/…`/`feature/…`, never `main`) → implement + tests → local checks (frontend: `npm run format:check && npm run lint && npm run typecheck && npm run test:run`; backend from `backend/`: `ruff check . && ruff format --check . && mypy app && pytest` — pytest whenever backend/db changed; db tests need `DATABASE_URL=""` + Docker) → docs-as-spec in the same PR → CHANGELOG `[Unreleased]` if user-visible → `gh pr create --body-file …` → **CI fully green** (`gh pr checks <n> --watch`) → merge (`gh pr merge <n> --squash`, **keep the branch**) → tick the phase-file box + refresh this file.

- **Merge authorization (updated 2026-07-10):** the auto-mode classifier that denied autonomous `gh pr merge` in prior loops **does not deny when the current user prompt explicitly authorizes merging** (proven this session — "make sure all the previous PR merged" merged the whole queue). A direct in-session user directive outranks the standing `pull-requests.md` "never merge" for the classifier; the contract's *documented* standing authorization alone does not. So: if the live prompt authorizes it, merge green PRs; otherwise hand every merge to the maintainer. **Do NOT self-merge buzz-path or prod-migration PRs even when authorized** — hand those off so the maintainer applies the migration to prod as a unit (that's why #211 was handed off, not merged).
- **Buzz-race test is the hard gate after ANY buzz-path/RPC edit**; add `run-stress`/`run-e2e` labels to RPC/realtime/migration-touching PRs (the `labeled` event spawns a separate run — watch that one).
- **Stacked squash-merges:** GitHub does NOT auto-retarget a kept stacked branch after its base is squash-merged — `gh pr edit <n> --base main` manually. To see a stacked PR's true content use the **two-dot** diff (`git diff origin/main origin/<branch>`), not three-dot. `gh pr merge --squash` is a proper 3-way merge (against the merge-base), so a PR branched off an older `main` does NOT revert later work. (Full detail in lessons-learned 2026-07-10.)
- Docs-only PRs only run CodeQL (backend/frontend workflows are path-filtered; e2e is label-gated).

## Windows / environment traps (read `.claude/rules/lessons-learned.md` in full)

- **venv is repointed**: `backend\.venv\pyvenv.cfg` points at `C:\Users\yulin\AppData\Local\Programs\Python\Python311`. If it breaks, re-apply the replace from lessons-learned.
- **DB/backend tests**: run from `backend/` with **no path args**; subsets need `-c pyproject.toml --rootdir=. -p no:cov`. Docker Desktop must be running. **Never run the db suite against the shared local stack you also use for e2e** — set `DATABASE_URL=""` so it uses a throwaway testcontainer. The `test_rls_anon.py` 12-failure pattern in a full run is a known flake (or fixed by T7.5's LOGIN-role fixture) — re-run the file in isolation.
- **Local stack**: `supabase start` (127.0.0.1:54322 db / 54321 api). e2e: `npx playwright test <spec> --project=chromium --retries=0` from `tests/e2e/`.
- **Prod testing needs the Bash sandbox disabled** (blocks non-GitHub egress). Use `https://www.soundclash.org`; `curl -w` is broken (curl 8.8 bug) — use the Playwright MCP. Benign console noise: YouTube `compute-pressure` warnings. Delete `.playwright-mcp/`/`.wrangler/` dirs before lint.
- **Prod migrations** (after merge + maintainer go): `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/<NNN>.sql`, then `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org`. Hard-required migrations go **before** the deploy (lesson F-P0-4).
- **NEVER touch `tools/song-curation/*`** or the uncommitted `docs/planning/phases/phase-8-features.md` — maintainer's in-flight work. Stage by explicit path; never `git add .` / `git reset --hard`.

## Architecture guardrails (from CLAUDE.md)

Buzzer hot path is a PL/pgSQL function called direct from the browser; **Python is deliberately not in any user-perceived hot path**. No state-management libraries, no object storage, no user accounts, no non-YouTube audio. Schema/RPC/RLS changes update `docs/data-model.md`/`rpc-functions.md`/`security-rls.md` in the same PR. Decisions in `05-decisions-needed.md` are resolved — don't re-litigate.

## Maintainer-only carryovers (not closable by a coding session)

- **#211** — merge + apply mig 041 to prod (see ⚠️ box #1).
- **T1.7 / I-Alert** — Grafana alerts on Realtime connections (~200 free-tier cap) + message quota; **I-Vitals** dashboard once Faro sends.
- **D-3 / T5.6** — Cloudflare edge + WAF (infra/ops). **F-P2-5** (rate-limit `--proxy-headers`) is a smaller related fix.
- Optional DB-password / `sb_secret_` rotation.
- **Dependabot PRs** #133 (checkout v7), #114 (codecov v7), #147 (@playwright/test), #182 (@types/node) — maintainer merges (#133/#114 touch CI).
- **Song curation** — Hebrew + soundtrack genres batch via `tools/song-curation/PLAYBOOK.md` (in-flight uncommitted tooling; see `03-features.md` §Content).

## Key references

- Backlog: `01-fixes.md` (F-P1-9 fixed in #211; F-P2-5/F-P2-6 open low), `02-improvements.md` §D/§E, `03-features.md`, `04-tech-debt.md`. Decisions: `05-decisions-needed.md` (log; all resolved).
- Process: `phases/EXECUTION-CONTRACT.md` (the single process doc) · roadmap: `phases/README.md`.
- Spec: `docs/architecture.md`, `docs/realtime-design.md`, `docs/rpc-functions.md`, `docs/security-rls.md`.
- Ops/validation: `docs/runbook.md`, `docs/pre-event-checklist.md`.
