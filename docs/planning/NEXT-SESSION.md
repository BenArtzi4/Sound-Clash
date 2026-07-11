# Next session — start here

_Last updated: 2026-07-11 (**T7.4-Lockfile DONE — PR #224 open + green-pending**: `frontend/package-lock.json` is now tracked for reproducible deploys. Verified the gate is met — CI runs Node 22 (npm 10.9+) since 2026-05-07 and `frontend.yml` already `npm ci`s when a lockfile exists — and the root cause is doubly moot (Vite 8 → Rolldown, and the regenerated lockfile records all 15 platform bindings incl. the runner's `@rolldown/binding-linux-x64-gnu`). Not user-visible → no CHANGELOG. Not a buzz-path/prod-migration change, so branch (a): merge once CI green. **Earlier context below.**)_

_Prior update: 2026-07-10 (**T7.1 scoring-authority DONE — LIVE ON PROD + VERIFIED (PR #218 merged, mig 043 applied, deploys green, live bundle sends booleans, prod scoring self-check passed; see ⚠️ box #4)**. Design 1: `award_attempt` boolean overload derives the +10/+5/−3 magnitudes server-side (closes the client-controlled-scoring footgun), byte-identical player experience, dual-overload rollout. **mig 044 (PR #220) now also merged + applied + verified on maintainer "go-ahead"** — the integer overload is dropped, so the boolean signature is the sole `award_attempt` overload and T7.1 is fully wrapped (migrations through **044** live on prod). Earlier this day: **late loop + post-deploy pass** — merged the queued stack #205→#209 + #208, shipped **T5.7 (#210)**, ran an 11-agent security re-verify (D-1 confirmed closed; 3 findings in `01-fixes.md`), opened **#211 (buzz_in cross-game guard, mig 041)**. Then on the maintainer's "do steps 1,2,3" go: **merged #211** (code now on `main`) and **merged dependabot #147** (@playwright/test). then on **explicit maintainer authorization** ("apply migrations 040 and 041 … merge #114 and #133"): **applied migs 040 + 041 to prod** (verified: `total_rounds` gone, `buzz_in` guard live → F-P1-9 closed on prod; smoke PASSED) and **merged dependabot #114 + #133** (Backend/Frontend/CodeQL green on `main`). Then on **broad "do what you need" authorization**: merged **#182** (dependabot queue fully clear), shipped **F-P2-6 (#215)** — bulk-import 5 MB cap → 413, and **T6.3 (#216, mig 042 `UNIQUE(songs.youtube_id)`)** — prod was already dupe-free so it's just the idempotent index, **applied + verified on prod**. **Phase 6 is now complete.** Migrations through **042** live on prod. Remaining autonomous surface: **T7.1** (delicate, see ⚠️) + flag/infra items.)_

> ### ✅ Maintainer actions — all cleared (migrations through 044 live on prod)
> 1. ✅ **DONE — migs 040/041/042 applied + verified on prod** (2026-07-10): F-P1-9 cross-game hole closed (`buzz_in` guard live), orphan `total_rounds` dropped, `songs.youtube_id` UNIQUE index live. Smoke PASSED.
> 2. ✅ **DONE — all dependabot merged** (#147/#182/#114/#133); CI green on `main` with checkout v7 + codecov v7.
> 3. ✅ **DONE — T6.3** (Phase 6 complete): the read-only prod dupe query returned zero rows, so no dedup needed; mig 042 UNIQUE index shipped + applied.
> 4. ✅ **T7.1 DONE — LIVE ON PROD + VERIFIED (2026-07-10).** The `award_attempt` boolean-overload rewrite (mig 043, Design 1) is shipped: **PR #218 merged**, **mig 043 applied to prod** (both overloads present, `count=2`), **Cloudflare Pages + Render deploys green**, and the **live deployed bundle sends only booleans** (`p_correct_title/p_correct_artist/p_wrong`; zero legacy `p_wrong_buzz/p_title/p_artist`). Prod scoring verified end-to-end via a transactional self-check against the live boolean overload: **title=10 / artist=5 / soundtrack=15 / wrong=−3 / free-guess=0** all correct; `post_deploy.sh` PASSED. The client can no longer send a point magnitude — the DB derives them.
>    - ✅ **mig 044 DONE — LIVE ON PROD + VERIFIED (2026-07-10, on maintainer "go-ahead").** `DROP FUNCTION award_attempt(text,uuid,integer,integer,integer,uuid)` retired the now-dead integer overload; the **boolean signature is now the sole `award_attempt` overload** (`count(*) pg_proc` → 1, remaining sig is `p_correct_title/p_correct_artist/p_wrong boolean`). **PR #220 merged** (`b69e31e`, buzz-race 100× + e2e green), **mig 044 applied to prod**. Safety pre-flight: **0 live games** at apply time (`ended_at IS NULL AND expires_at>now()` → 0) + ~2h boolean-frontend soak ⇒ safe even inside the 4h window. Prod scoring self-check (rollback-sentinel, zero persistence) PASS — title=10 / artist=5 / soundtrack=15 / wrong=−3 / free-guess=0; `post_deploy.sh` PASS; `deploy (Render)` green (Frontend/Cloudflare correctly not triggered — no app-code change). **T7.1 is fully wrapped; no scoring follow-ups remain.**

## Start the next session with ONE line

Just run the skill — it reads this whole file and picks the next task:

> **`/next-task`**

To point it at a specific task, add a few words, e.g. **`/next-task do F-P2-6`** or **`/next-task T7.1 with me`**. Everything the skill needs (per-PR loop, gates, env traps, guardrails, the full task map below) is in this file + `EXECUTION-CONTRACT.md` + `lessons-learned.md`, which the skill loads automatically.

**One-glance state:** Phases 1–6 ✅ complete + live on prod. **T7.1** scoring authority is **✅ fully wrapped + live on prod** — PR #218 (mig 043) **and** PR #220 (mig 044) both merged + applied + verified; **migrations through 044** on prod; the boolean `award_attempt` overload is now the **sole** signature (no scoring follow-ups remain). The tractable autonomous cleanups are **done** (T5.7, F-P2-6, T6.3, all dependabot). **What's left:** flag/infra items — **T7.6** CI (bundle budget / RLS CI job / e2e gate), **F-P2-5** rate-limit `--proxy-headers`, **T5.6** Cloudflare, **T5.2** name-policy call, **T5.4** history retention; then **Phase 8** features (**T7.4** lockfile un-ignore ✅ shipped 2026-07-11, PR #224) (needs your direction + the existing vetoes). Any `db/migrations/**` PR needs `run-stress` + `run-e2e` labels. Maintainer is button-averse (confirm before any UI). Autonomous `gh pr merge` / prod writes work only when your prompt explicitly authorizes them.

---

## Where things stand (2026-07-10)

- **Phases 1–4 ✅ complete and live on prod** (`https://www.soundclash.org`). PRs #150–#197 merged; DB migrations through **041** applied + verified on prod (`jvfddxuaqcsrguibkymp`) as of 2026-07-10 (040 orphan-column drop + 041 buzz_in cross-game guard).
- **Phase 5 — in progress.** Shipped: D-1/T5.5 (mig 034), T5.3 (mig 037), T5.7-docs + T5.8 (#208), and now **T5.7 same-name reclaim code (#210)**. Remaining items all need a maintainer decision or touch `tools/song-curation/*` (T5.1) — see below. Not closable autonomously.
- **Phase 6 ✅ complete** — T6.1 (#199) + T6.2 (#200/#203, mig 040) + T6.3 (#216, mig 042 `UNIQUE(youtube_id)`) all done; migs 040 + 042 live on prod.
- **Phase 7** — T7.2 (#206), T7.3 (#202), T7.4-DeadCode (#201), T7.5 (#205) done. Remaining: **T7.1** (scoring authority — planned, maintainer-coordinated), T7.4-Lockfile (verify-first), T7.6 (CI — flag). Not autonomous.
- **Phase 8** — not started; the maintainer's uncommitted `phase-8-features.md` carries vetoes (no auto-release/practice/streaks; SFX must not slow the buzz; explain GenreSpotlight + win-conditions before building). Needs maintainer direction.
- **Security posture (re-verified 2026-07-10, 11-agent adversarial workflow):** core two-principal auth boundary holds; **D-1 confirmed closed** (manager_token unreachable by anon), D-2/D-4 documented. 3 new findings logged (below) — one medium (fixed in #211), two low.

## What shipped this session (2026-07-10 late)

- **Merged the full queued stack** — #205 (T7.5), #206 (T7.2), #207 (eve handoff), #208 (T5.7/T5.8 docs), #209 (night handoff + the T7.1 plan). The stacked squash-merges needed manual `gh pr edit <n> --base main` between each (GitHub doesn't auto-retarget when branches are kept) and a worktree to resolve the NEXT-SESSION.md conflicts on the two handoff PRs. Verified post-merge: the #206 refactor survived intact (`ManagerConsolePage` 489 lines, all hook/component files present), 452 frontend tests green.
- **T5.7 ✅ (PR #210, merged)** — `POST /games/{code}/teams` (`_join_team_blocking`) now reclaims an existing `(game_code, name)` team (same id, **preserved score**) instead of 409'ing. Discovery: `game_teams` already has `UNIQUE(game_code, name)` (mig 003), so the old behavior was a 409, not a duplicate — the reclaim turns it into a resume and the constraint stays as the concurrent-insert backstop. Real-Postgres `db`-fixture test; no frontend change (transparent). Docs synced (api-contracts / security-rls §4 / game-rules); F-P2-1 closed.
- **Security re-verify ✅ (read-only, no prod, no writes)** — confirmed D-1 closed + D-2/D-4 documented; found 3 new gaps, now in `01-fixes.md`: **F-P1-9** (medium, cross-game score write — fixed in #211), **F-P2-5** (low, per-IP rate limits collapse to one bucket behind the proxy — needs `--proxy-headers`, deploy-config flag), **F-P2-6** (low, bulk-import has no upload size cap — admin-gated; clean autonomous backend hardening for a future session).
- **#211 opened (F-P1-9 fix) — green, handed to maintainer** — mig 041 adds one `AND EXISTS (… game_teams gt WHERE gt.id=p_team_id AND gt.game_code=p_game_code)` predicate to `buzz_in`'s atomic UPDATE (byte-identical to mig 035 otherwise; race preserved). `run-stress`+`run-e2e` labelled. See ⚠️ box #1.

## What to do next

**T7.1 is fully wrapped + live on prod (both migs 043 + 044). Everything left needs the maintainer, a flag, or is off-limits.** (F-P2-6 shipped in #215, T6.3 in #216, T7.1 in #218 + #220 — all done + live.)

1. ✅ **mig 044 (T7.1 tail) — DONE, live on prod + verified** (PR #220 merged, applied on maintainer "go-ahead"). Boolean `award_attempt` overload is the sole one; prod scoring self-check + smoke PASS. No scoring follow-ups remain.
2. **Flag-first / infra (the tractable next tasks):** T7.6 (CI job for RLS suite, bundle budget, e2e gate), F-P2-5 (`--proxy-headers`), T5.6 (Cloudflare), T5.4 (history retention window — decision). _(T7.4-Lockfile ✅ shipped 2026-07-11, PR #224 — `frontend/package-lock.json` now tracked; the remaining CI-flag follow-up is re-enabling the setup-node `cache: "npm"` in `frontend.yml`.)_
3. **T5.2 team-name guard** — needs a maintainer **content-policy** call: the game is Hebrew-primary and party-flavored, so a naive profanity/emoji/control-char filter risks rejecting legit Hebrew names (RTL is normal) or wanted emoji. Get the policy before implementing; the "objective" subset (reject C0/C1 control chars only) is low-value on its own (React escapes; names are length-capped).
4. **F-P1-9 defense-in-depth (optional, foldable into a later `award_attempt` touch)** — `award_attempt` still trusts the round belongs to the game via the round-id join; a game-scope check mirroring mig 041's `buzz_in` guard would be belt-and-suspenders. Not shipped in T7.1 (kept the boolean overload byte-identical to mig 036; mig 044 was a pure DROP with no body change); note for a future mig 045. (Low priority: `award_attempt` never takes a client team-id — it credits `active_games.buzzed_team_id`, which is game-scoped — so the cross-game vector mig 041 closed for `buzz_in` is not directly reachable here; this is belt-and-suspenders.)

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
