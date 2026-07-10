# Next session — start here

_Last updated: 2026-07-10 (**T7.5 shipped** — proper RLS fixture fix (`anon_conn` now a dedicated non-superuser `LOGIN` role, kills the `test_rls_anon` in-suite flake) + expiry-warning reducer test; PR open, awaiting green CI + merge. Earlier the same day: merged **T6.2 (#200)**, **T7.4 (#201)**, **T7.3 T-RpcError+T-Deps (#202)**, **mig-015 idempotency fix (#203)**. **⚠️ Two maintainer actions pending** — see the box below. **Next autonomous work: T7.2** — T6.3 is blocked on maintainer prod access.)_

> ### ⚠️ Maintainer actions pending (can't be done autonomously)
> 1. **Apply mig 040 to prod** (T6.2 — deferred, hard-required-nothing column drop). Quiet window: `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/040_drop_total_rounds_column.sql`, then `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org`. Prod is safe either way — mig 015 is now guarded so the drop can't break a replay.
> 2. **Unblock T6.3** (`UNIQUE(songs.youtube_id)` + prod dedup). It needs a **read-only prod query** to find duplicate `youtube_id`s, which the auto-mode classifier denies without you present ("[Production Reads] … naming the prod target"). Run it *with* the maintainer, or have them run the dedup investigation. Details below.

## Short prompt to paste into the fresh session

> **Continue the Sound Clash plan. Read `docs/planning/NEXT-SESSION.md` first, then follow `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-7-tech-debt.md`. Read `.claude/rules/lessons-learned.md` before running anything (esp. the 2026-07-10 migration-idempotency entry). T6.3 is blocked on maintainer prod access, so do the next autonomous Phase 7 task: T7.5 (proper RLS fixture fix in `tests/db/conftest.py` — dedicated non-superuser `LOGIN` role + `current_user` assertion; and a reducer/e2e test for the T4.8 expiry warning) or T7.2 (decompose `ManagerConsolePage`/`AdminSongsPage`, guarded by their existing tests). Do T6.3 only when the maintainer is present to run the read-only prod dupe query. The maintainer is button-averse: prefer zero-UI/auto fixes and confirm before adding any button. NOTE: any PR touching `db/migrations/**` MUST get the `run-stress` + `run-e2e` labels — `backend.yml` is path-filtered and won't run the migration-idempotency check otherwise.**

(Or just run the local **`/next-task`** skill — it encodes the same loop.)

---

## Where things stand (2026-07-10)

- **Phases 1–3 ✅ complete and live on prod** (`https://www.soundclash.org`). PRs #150–#174 merged; DB migrations through **039** applied + verified on prod (`jvfddxuaqcsrguibkymp`).
- **Phase 4 ✅ done (exit gate passed 2026-07-10; PRs #185–#197; Cloudflare auto-deploys from `main`):** ✅ T4.0 deploy-safe chunks (PR #185) · ✅ T4.2 resume-on-visible (PR #187) · ✅ T4.3 hydrate gate + queue cap (PR #190 — gate opens only on a successful snapshot; 500-event cap with overflow resync) · ✅ T4.4 expiry teardown ≠ kick (PR #192 — team page shows the "ended or expired" banner instead of a silent Home bounce when the sweep's cascade deletes the team row first; T-CascadeTest pins the ordering; `expiration.spec.ts` tightened) · ✅ T4.5+T4.6 (PR #193 — failed `select_next_song` now rolls the whole in-gesture double-buffer swap back and reloads the still-current round's song, retry keeps the same-song fast path; bonus toast confirms only after the Render call resolves, "Sending +4…" info toast + `busy` gate in flight) · ✅ T4.7 (PR #194 — both pages resolve the round's song via `fetchSongById()` in `lib/songMetadata.ts` with a bounded backoff retry, so a transient blip no longer blanks the reveal / post-refresh player for the whole round; also closed tech-debt T-SongFetch) · ✅ T4.8 (PR #195 — mig 039 `extend_game` token-gated RPC, `GREATEST(expires_at, now()) + 1h`; console "Ends at HH:MM" hint → warning banner with the single **Keep playing +1h** action in the last 20 min, manager-only, no auto-extend per maintainer 2026-07-09; **mig 039 applied to prod before the deploy**) · ✅ T4.10 (PR #196 — collapsed **Backup host link** disclosure in the console: QR + copyable `/manager/game/<code>#mt=<token>` URL; the token rides the fragment (no wire/log leakage), the console adopts it on load and scrubs the address bar; an existing stored credential always wins so a crafted link can't clobber the host's token, and an in-memory copy survives private-mode storage; `host_recovery.spec.ts` e2e covers wipe → lockout → recover → round 1) · ✅ T4.11 (this PR — `useGameChannel` exposes a `finalBoard` last-known-state snapshot; Display/Team/Manager render the `EndScreen` podium (+ Manager's song export) from it under the "ended or expired" banner instead of "This game no longer exists", so the standings survive the row delete; a shrinking update is held only for a genuine teardown — ended game, or an expired-unended sweep that isn't a lone kick — so a kick (incl. in the overdue-but-unswept window) still prunes the removed team; no DB read / no `game_history` UI / zero new infra; 16 hook+page vitest cases + `expiration.spec.ts` extended; adversarial review caught+fixed a clock-only teardown misclassification) · ❌ T4.1 de-scoped (PR #186 — no Skip button; Next round + played-song exclusion cover dead videos) · ✅ T4.9 turned out **already shipped** in Phase 2 (PR #163 — CONNECTING…/RECONNECTING… states).
- **Pre-event validation done** (10-team live-prod pass 2026-07-05 + DB-verified 10-team/30-round e2e 2026-07-06); the two display-scaling bugs it found are fixed (PRs #176/#178). No open blockers. Reusable checklist: `docs/pre-event-checklist.md`.
- **Phases 5–8 not started**, but re-verification shrank them: Phase 5's critical item (D-1) and T5.3 already shipped; Phase 6 is down to one doc-sync PR + two migrations; Phase 7 lost T-KeepWarm/T-DocRPC (done). Recommended order after Phase 4: **6 → 7 → 5 → 8** (see `phases/README.md`).

## What shipped this session (2026-07-10 afternoon)

- **T6.2 ✅ (PR #200)** — mig `040_drop_total_rounds_column.sql` drops the orphan `active_games.total_rounds`. Re-verified zero code refs; `data-model.md` ledger synced. **Prod apply still pending maintainer** (see ⚠️ box up top).
- **T7.4 ✅ (PR #201, T-DeadCode)** — deleted the dead `Scoreboard.{tsx,test.tsx,module.css}` (nothing imported it) + CLAUDE.md/testing-strategy mentions + the tracked `create-page-after-fix.png`. (T-Lockfile still open.)
- **T7.3 ✅ (PR #202)** — `T-RpcError`: `RpcError` + a new `throwOnRpcError()` helper in `lib/rpcError.ts` (re-exported from `useManagerActions`); all six direct-RPC sites throw the same type — `useBuzzer` no longer throws the raw PostgREST error. `T-Deps`: verified already satisfied (all 4 `exhaustive-deps` disables already have reason comments).
- **Regression fix ✅ (PR #203)** — mig 040 (above) made the full migration set non-re-runnable: on a replay, mig **015** did `ALTER COLUMN total_rounds …` after 040 had dropped the column → the buzz-race **stress** job failed. Guarded 015's ALTERs with `IF EXISTS`. #200 never caught it because a `db/migrations/**`-only PR runs only CodeQL (`backend.yml` is path-filtered; the idempotency check is in the label-gated stress job). **New standing rule: label every migration-touching PR `run-stress` + `run-e2e`.** Full detail in `.claude/rules/lessons-learned.md` (2026-07-10).

## What to do next

**T6.3 is blocked on maintainer prod access** (the read-only dupe query is denied by the auto-mode classifier without the maintainer present). **T7.5 is done** (RLS fixture fix + expiry reducer test — PR open, test-only, no runtime/schema change). So the next **autonomous** task is a Phase 7 item; recommended order:

1. **T7.2** `[M]` — decompose the god components (`ManagerConsolePage` → `useSongPrebuffer`+`useScoring`; `AdminSongsPage` → `SongTable`/`SongEditForm`/`useAdminSongs`), guarded by their existing ~48-case tests.
2. **T7.1** `[M, D-7]` — scoring single-source-of-truth in the DB. Own PR **behind the buzz-race gate** (`award_attempt` change) — careful.

_(T7.5 ✅ — `anon_conn` now connects as a dedicated non-superuser `LOGIN` role (`anon_login_test`, granted membership in `anon`) via its own DSN with `session_user`/`rolsuper`/`rolbypassrls` assertions, replacing `SET ROLE anon`; full `tests/db` suite green in-suite with no `test_rls_anon` contamination. Plus a `useGameChannel` reducer test that a `GAME_CHANGE` UPDATE bumping `expires_at` — the Realtime event `extend_game` triggers — flows into state; the rest of the T4.8 expiry flow was already fully covered.)_

**T6.3 (when the maintainer is present)** — one migration PR (**D-8 = youtube_id now**): (a) read-only prod query for duplicate `youtube_id`s; (b) dedup — merge dupes, repoint `song_genres`, delete losers (leave the Avicii "Wake Me Up" same-song-different-*video* pair — two distinct youtube_ids — alone); (c) idempotent `UNIQUE(songs.youtube_id)` migration; (d) verify no orphaned `song_genres`, song selection still works. Consider making it one migration that dedups **then** adds the constraint so it applies atomically to prod. Label it `run-stress` + `run-e2e`.

Recommended phase order after 6: **7 → 5 → 8** (see `phases/README.md`).

## The per-PR loop (from EXECUTION-CONTRACT.md — don't skip)

Branch (`fix/…`/`feature/…`, never `main`) → implement + tests → local checks (frontend: `npm run format:check && npm run lint && npm run typecheck && npm run test:run`; backend from `backend/`: `ruff check . && ruff format --check . && mypy app && pytest` — pytest whenever backend/db changed, e.g. T4.8) → docs-as-spec in the same PR → CHANGELOG `[Unreleased]` if user-visible → `gh pr create --body-file …` → **CI fully green** (`gh pr checks <n> --watch`) → merge only when green + verified (`gh pr merge <n> --squash`, **keep the branch**) → tick the phase-file box + refresh this file.

- **Merge authorization is in effect** for this loop (green CI + verified + squash + keep branch); if anything's uncertain, stop and hand the PR to the maintainer.
- **Buzz-race test is the hard gate after ANY buzz-path/RPC edit**; add `run-stress`/`run-e2e` labels to RPC/realtime-touching PRs (the `labeled` event spawns a separate run — watch that one).
- Docs-only PRs only run CodeQL (backend/frontend workflows are path-filtered; e2e is label-gated).

## Windows / environment traps (read `.claude/rules/lessons-learned.md` in full)

- **venv is repointed**: `backend\.venv\pyvenv.cfg` points at `C:\Users\yulin\AppData\Local\Programs\Python\Python311`. If it breaks, re-apply the replace from lessons-learned.
- **DB/backend tests**: run from `backend/` with **no path args**; subsets need `-c pyproject.toml --rootdir=. -p no:cov`. Docker Desktop must be running. **Never run the db suite against the shared local stack you also use for e2e** — it truncates the catalog (set `DATABASE_URL` empty so it uses a testcontainer, or re-seed after). The `test_rls_anon.py` 12-failure pattern in a full run is a known flake — re-run the file in isolation.
- **Local stack**: `supabase start` (127.0.0.1:54322 db / 54321 api), migrations 001–038. e2e: `npx playwright test <spec> --project=chromium --retries=0` from `tests/e2e/`.
- **Prod testing needs the Bash sandbox disabled** (blocks non-GitHub egress). Use `https://www.soundclash.org`; `curl -w` is broken (curl 8.8 bug) — use the Playwright MCP. Benign console noise: YouTube `compute-pressure` warnings. Delete `.playwright-mcp/`/`.wrangler/` dirs before lint.
- **Prod migrations** (after merge + maintainer go): `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/<NNN>.sql`, then `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org`. Hard-required migrations go **before** the deploy (lesson F-P0-4).
- **NEVER touch `tools/song-curation/*`** — maintainer's uncommitted in-flight work (release_year tooling). Stage by explicit path; never `git add .` / `git reset --hard`.

## Architecture guardrails (from CLAUDE.md)

Buzzer hot path is a PL/pgSQL function called direct from the browser; **Python is deliberately not in any user-perceived hot path**. No state-management libraries, no object storage, no user accounts, no non-YouTube audio. Schema/RPC/RLS changes update `docs/data-model.md`/`rpc-functions.md`/`security-rls.md` in the same PR. Decisions in `05-decisions-needed.md` are resolved — don't re-litigate.

## Maintainer-only carryovers (not closable by a coding session)

- **T1.7 / I-Alert** — Grafana alerts on Realtime connections (~200 free-tier cap) + message quota; **I-Vitals** dashboard once Faro sends.
- **D-3 / T5.6** — Cloudflare edge + WAF (infra/ops).
- Optional DB-password / `sb_secret_` rotation.
- **Dependabot PRs** #133 (checkout v7), #114 (codecov v7), #147 (@playwright/test), #182 (@types/node) — maintainer merges.
- **Song curation** — Hebrew + soundtrack genres batch via `tools/song-curation/PLAYBOOK.md` (in-flight uncommitted tooling; see `03-features.md` §Content).

## Key references

- Backlog: `01-fixes.md` (no open P0s), `02-improvements.md` §D/§E, `03-features.md`, `04-tech-debt.md`. Decisions: `05-decisions-needed.md` (log; all resolved).
- Process: `phases/EXECUTION-CONTRACT.md` (the single process doc) · roadmap: `phases/README.md`.
- Spec: `docs/architecture.md`, `docs/realtime-design.md`, `docs/rpc-functions.md`, `docs/security-rls.md`.
- Ops/validation: `docs/runbook.md`, `docs/pre-event-checklist.md`.
