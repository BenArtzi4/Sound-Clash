# Next session — start here

_Last updated: 2026-07-10 (**Phase 6 T6.2 ✅ done** — PR #200, mig 040 drops the orphan `active_games.total_rounds` column. **Next: T6.3 — `UNIQUE(songs.youtube_id)` + a one-time prod dedup (migration PR; the prod dedup mutation needs maintainer go).**)_

## Short prompt to paste into the fresh session

> **Continue the Sound Clash plan. Read `docs/planning/NEXT-SESSION.md` first, then do Phase 6 T6.3 per `docs/planning/phases/EXECUTION-CONTRACT.md` and `docs/planning/phases/phase-6-correctness-docs.md`. Read `.claude/rules/lessons-learned.md` before running anything. T6.3 is a single migration PR: dedup prod's catalog on `youtube_id` (merge dupes, repoint `song_genres`, delete losers — leave the Avicii "Wake Me Up" same-song-different-*video* pair alone; it has two distinct youtube_ids), then add an idempotent `UNIQUE(songs.youtube_id)` index migration. The prod dedup mutates prod data → apply only after maintainer go. Verify no orphaned `song_genres` and that song selection still works. The maintainer is button-averse: prefer zero-UI/auto fixes and confirm before adding any button.**

(Or just run the local **`/next-task`** skill — it encodes the same loop.)

---

## Where things stand (2026-07-10)

- **Phases 1–3 ✅ complete and live on prod** (`https://www.soundclash.org`). PRs #150–#174 merged; DB migrations through **039** applied + verified on prod (`jvfddxuaqcsrguibkymp`).
- **Phase 4 ✅ done (exit gate passed 2026-07-10; PRs #185–#197; Cloudflare auto-deploys from `main`):** ✅ T4.0 deploy-safe chunks (PR #185) · ✅ T4.2 resume-on-visible (PR #187) · ✅ T4.3 hydrate gate + queue cap (PR #190 — gate opens only on a successful snapshot; 500-event cap with overflow resync) · ✅ T4.4 expiry teardown ≠ kick (PR #192 — team page shows the "ended or expired" banner instead of a silent Home bounce when the sweep's cascade deletes the team row first; T-CascadeTest pins the ordering; `expiration.spec.ts` tightened) · ✅ T4.5+T4.6 (PR #193 — failed `select_next_song` now rolls the whole in-gesture double-buffer swap back and reloads the still-current round's song, retry keeps the same-song fast path; bonus toast confirms only after the Render call resolves, "Sending +4…" info toast + `busy` gate in flight) · ✅ T4.7 (PR #194 — both pages resolve the round's song via `fetchSongById()` in `lib/songMetadata.ts` with a bounded backoff retry, so a transient blip no longer blanks the reveal / post-refresh player for the whole round; also closed tech-debt T-SongFetch) · ✅ T4.8 (PR #195 — mig 039 `extend_game` token-gated RPC, `GREATEST(expires_at, now()) + 1h`; console "Ends at HH:MM" hint → warning banner with the single **Keep playing +1h** action in the last 20 min, manager-only, no auto-extend per maintainer 2026-07-09; **mig 039 applied to prod before the deploy**) · ✅ T4.10 (PR #196 — collapsed **Backup host link** disclosure in the console: QR + copyable `/manager/game/<code>#mt=<token>` URL; the token rides the fragment (no wire/log leakage), the console adopts it on load and scrubs the address bar; an existing stored credential always wins so a crafted link can't clobber the host's token, and an in-memory copy survives private-mode storage; `host_recovery.spec.ts` e2e covers wipe → lockout → recover → round 1) · ✅ T4.11 (this PR — `useGameChannel` exposes a `finalBoard` last-known-state snapshot; Display/Team/Manager render the `EndScreen` podium (+ Manager's song export) from it under the "ended or expired" banner instead of "This game no longer exists", so the standings survive the row delete; a shrinking update is held only for a genuine teardown — ended game, or an expired-unended sweep that isn't a lone kick — so a kick (incl. in the overdue-but-unswept window) still prunes the removed team; no DB read / no `game_history` UI / zero new infra; 16 hook+page vitest cases + `expiration.spec.ts` extended; adversarial review caught+fixed a clock-only teardown misclassification) · ❌ T4.1 de-scoped (PR #186 — no Skip button; Next round + played-song exclusion cover dead videos) · ✅ T4.9 turned out **already shipped** in Phase 2 (PR #163 — CONNECTING…/RECONNECTING… states).
- **Pre-event validation done** (10-team live-prod pass 2026-07-05 + DB-verified 10-team/30-round e2e 2026-07-06); the two display-scaling bugs it found are fixed (PRs #176/#178). No open blockers. Reusable checklist: `docs/pre-event-checklist.md`.
- **Phases 5–8 not started**, but re-verification shrank them: Phase 5's critical item (D-1) and T5.3 already shipped; Phase 6 is down to one doc-sync PR + two migrations; Phase 7 lost T-KeepWarm/T-DocRPC (done). Recommended order after Phase 4: **6 → 7 → 5 → 8** (see `phases/README.md`).

## What to do next — Phase 6 (T6.3: `UNIQUE(songs.youtube_id)` + prod dedup)

**T6.1 ✅ done (PR #199)** — docs-only drift sync merged (eleven-table intro, six anon RPCs, open-hosting auth model across `data-model.md`/`api-contracts.md`/`game-rules.md`/`architecture.md`/`diagrams/*`).

**T6.2 ✅ done (PR #200)** — mig `040_drop_total_rounds_column.sql` drops the orphan `active_games.total_rounds` (mig 015 only relaxed its NOT NULL). Re-verified zero code refs (grep hits only mig 003/015 + docs); applied twice on the local stack (idempotent skip on #2); a create-game INSERT that omits the column still succeeds; `data-model.md` ledger synced (015 note + 038/039/040 appended). **Prod apply is still pending maintainer go** — it's a hard-required-nothing drop, so run it in a quiet window: `supabase db query --linked -f db/migrations/040_drop_total_rounds_column.sql`.

Next is **T6.3**, a single migration PR (**D-8 = youtube_id now**):

1. One-time dedup on prod's catalog: identify duplicate `youtube_id`s, merge them, repoint `song_genres`, delete the losers. (The known Avicii "Wake Me Up" double-upload is a same-song-different-*video* case — two distinct `youtube_id`s — so it is NOT a `youtube_id` dupe and must be left alone.) **This mutates prod data → needs maintainer go before applying.**
2. Add the `UNIQUE(songs.youtube_id)` index migration (idempotent) once the catalog is clean.
3. Verify no dedup regression: sane row counts, no orphaned `song_genres`, song selection still works (no repeats within a game).

Migration PRs run backend/db CI. After merge + maintainer go, apply to prod (`supabase db query --linked`). Recommended phase order after 6: **7 → 5 → 8** (see `phases/README.md`).

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
