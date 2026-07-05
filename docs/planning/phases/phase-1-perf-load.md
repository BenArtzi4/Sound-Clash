# Phase 1 — Performance: Load & Time-to-Playable

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md). **Also ship the D-1 fix** (move `manager_token` to a secret table) this phase — it's the one critical item.
**Do T1.8 baseline FIRST** (measure join-to-playable on prod) so the wins are provable.
**PR split:** (A) HTTP caching + resource hints [`_headers`, `index.html`]; (B) hydrate-before-subscribe [`useGameChannel.ts` + test]; (C) bundle trim — defer Faro, lazy Sentry, vendor chunk [`main.tsx`, `telemetry.ts`, `vite.config.ts`]; (D) prefetch + join prewarm + Suspense spinner [`JoinTeamPage.tsx`, `App.tsx`]; (E) D-1 token secret table [migration + backend + hook + `security-rls.md`/`data-model.md`].
**Flag first:** T1.6 (new `.github/workflows/` DR job + S3 CSV refresh) and T1.7 (Grafana alerts + unset `VITE_FARO_URL` on Cloudflare). **Workflow ok for:** the T1.8 baseline probe and the end-of-phase verification/gate audit.

**Goal:** the person who scans the QR reaches a usable BUZZ button as fast as physically possible, and every repeat load is near-instant. All low-risk, autonomous, frontend/config.

**Why first:** biggest *felt* speed win, zero architecture risk, no decisions required. Sets the "fast" baseline before everything else.

**Backlog refs:** `02-improvements.md §A` + `§E` (DR/alerts, done early).

**Session shape:** one focused session (or two parallel worktree sessions split as noted). Not a workflow — mostly single-file edits. Exception: could bundle the measurement into a small before/after check.

---

## Tasks

### T1.1 · Immutable + tiered HTTP caching `[S]` — `I-Cache`
- [x] `frontend/public/_headers`: add `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`.
- [x] Add `/icons/*`, `og-image.jpg`, `how-to-play-hero.*`, `manifest.webmanifest` → `max-age=86400`.
- [x] Verify locally (`curl -I` against `wrangler pages dev dist`) that hashed assets get `immutable` and `index.html` stays `no-cache`.
- [x] Keep `sw.js` cache-nothing; update its comment to note caching is handled at the HTTP layer now (T-DeadCode-adjacent).

### T1.2 · Resource hints `[S]` — `I-Preconnect`
- [x] `frontend/index.html`: `preconnect` + `dns-prefetch` for the Supabase project host and `api.soundclash.org` (both `crossorigin` — supabase-js uses CORS fetch + WS).
- [x] Fix YouTube hints: drop `crossorigin` from `www.youtube.com`; add non-crossorigin `youtube-nocookie.com` and `s.ytimg.com`.

### T1.3 · Hydrate before subscribe `[S]` — `I-Hydrate`
- [x] `useGameChannel.ts`: fire `void hydrate()` immediately after building the channel; keep the SUBSCRIBED re-hydrate. (Implemented as a *non-authoritative* pre-hydrate so it paints early but never opens the event gate — the pending queue stays safe; see `realtime-design.md` §6.)
- [x] Confirm the pending-event queue still covers the gap (add/adjust `useGameChannel.test.ts`). (2 new tests + existing queue test all green.)

### T1.4 · Trim the join-path bundle `[S→M]` — `I-Faro`, `I-Sentry`
- [x] Defer Faro: `initTelemetry()` behind `requestIdleCallback` on `load`; `Promise.all` the two dynamic imports. (PR C — `main.tsx` `whenIdle()` on `load` with a 5s timeout; `telemetry.ts` now `Promise.all`s the two Faro chunk imports.)
- [x] Set `VITE_FARO_URL` unset in prod env until #145 is fixed. (PR C — removed from committed `frontend/.env.production` with a comment documenting the re-enable path AND the Cloudflare Pages build-env caveat. **Flagged in PR:** if Faro still loads after deploy, the maintainer must also clear `VITE_FARO_URL` in the Cloudflare Pages dashboard.)
- [x] Lazy-load Sentry after first render with a temporary `window.onerror` buffer. (PR C — new `lib/sentry.ts`: `installErrorBuffer()` attaches cheap native `error`/`unhandledrejection` handlers synchronously; `loadSentry()` runs on idle, dynamically imports `@sentry/react`, inits, and drains the buffer. Moved `@sentry/react` off the entry chunk: index gz 151.72 kB → 57.77 kB.)
- [x] (Stretch) `manualChunks` `vendor` (react/react-dom/react-router/scheduler) in `vite.config.ts` — `I-Vendor`. (PR C — Vite 8/Rolldown only accepts the function form of `manualChunks`; used a regex over `node_modules` paths. Emits a 73.85 kB gz `vendor` chunk that immutable-caching keeps across deploys.)

### T1.5 · Overlap chunk download with idle time `[S]` — `I-Prefetch`, `I-JoinWarm`, `I-Suspense`
- [x] `JoinTeamPage`: `useEffect(() => { void import('./TeamGameplayPage') }, [])` to prefetch the gameplay chunk while the player types. (PR D — verified in a browser: the `TeamGameplayPage` JS+CSS chunks are fetched on the join page's mount, before any navigation. Vite dedupes with App.tsx's `React.lazy`.)
- [x] `JoinTeamPage` + ManagerCreate deep-link: `void getHealth().catch(()=>{})` on mount; button label → "Waking the server — up to 30s…" after ~2.5s pending. (PR D — shared `hooks/useBackendWarmup.ts`: `usePrewarmBackend()` pings `/health` on mount; `useSlowPending(busy)` flips the submit label after 2.5s. Note: the preview-on-localhost verify logs 2 benign CORS errors from the ping since `localhost:<port>` isn't in the API's CORS allowlist — the prod origins are, so no error in the real game.)
- [x] `App.tsx`: replace `Suspense fallback={null}` with a tiny centered CSS logo-pulse. (PR D — new `components/RouteFallback.tsx`: centered animated `<Logo>` with an opacity pulse, `prefers-reduced-motion`-aware, `role="status"`.)

### T1.6 · Disaster-recovery safety net `[M]` — `I-DR` (do this in Phase 1; it's the top production-readiness gap)
- [x] Add a scheduled `pg_dump` of `songs`/`genres`/`song_genres` committed to the repo (or pushed to object storage) — a GitHub Action on cron. **This is a `.github/workflows/` addition → flag with the maintainer before adding (CI rule).** (Maintainer pre-approved the design. `.github/workflows/catalog-backup.yml`: weekly Mon 04:17 UTC + dispatch; deterministic CSV dump via `psql \copy … ORDER BY <pk>` to `db/backups/`; reuses the `prod` environment's `SUPABASE_DATABASE_URL`; opens/updates one PR on the `automated/catalog-backup` branch; never pushes `main`.)
- [x] CI drift-guard: assert prod row-count/hash vs the committed dump; warn on drift. (Same workflow: `git diff` of the fresh dump vs the committed CSVs → `::warning::` (never fails) + refresh PR on drift; a min-row guard refuses to open a catalog-shrinking PR from a partial read.)
- [x] Refresh the S3 fallback CSV; correct `docs/runbook.md:278` (T-DocRunbook). (The S3 bucket is gone (2026-05-07 teardown) → replaced with a committed dump + `db/backups/restore.sql`. `runbook.md` line 278, §6 table + recovery scenarios, and §7 maintenance rows all updated.)

### T1.7 · Observability alerts `[S]` — `I-Alert` (cheap insurance, no code)
- [ ] Grafana alert: Realtime concurrent connections approaching ~200 free-tier cap.
- [ ] Grafana alert: monthly Realtime message consumption threshold.

### T1.8 · Measurement `[S]`
- [ ] Capture join-to-playable before/after (Playwright MCP against prod, or Lighthouse): time from `/join/:code` navigation to BUZZ button interactive. Record numbers in the PR so the win is provable.

### T1.9 · Genres direct from Supabase `[S]` — `I-GenreWarm` (surfaced in execution)
- [x] Maintainer reported the "Host a game" genre picker taking >5s on a cold Render container. Root cause: `listGenres()` went through Render's `/genres` (2-30s cold start) even though `genres` is an anon-readable table. Fix: `listGenres()` now reads genres **directly from Supabase** (`from('genres').select('id,name,slug').order('name')`), same reasoning as keeping the buzzer off Render. Endpoint retained for smoke/external. (`fix/genres-direct-supabase`)

---

## Decisions touched
- None block Phase 1. T1.4's `VITE_FARO_URL` unset and T1.6's new CI workflow are **flag-before-doing** (ops/CI), not full decisions — mention in the PR and get a thumbs-up.

### Maintainer decisions (resolved 2026-07-04, mid-execution)
- **T1.4 Faro (`VITE_FARO_URL`)** — maintainer deferred to judgment. **Resolved:** in PR C, (a) **remove** `VITE_FARO_URL` from committed `frontend/.env.production` so the Faro chunk (~59KB gz, and per #145 sends nothing useful) never downloads, AND (b) defer `initTelemetry()` behind `requestIdleCallback` regardless (belt-and-suspenders + correct pattern). **Flag in the PR:** if prod still loads Faro after deploy, Cloudflare Pages also sets the var as a build env and the maintainer must clear it in the dashboard (I can't inspect it). Keep Sentry (errors-only) but lazy-load it.
- **T1.6 DR backup workflow** — **APPROVED.** Add the scheduled `pg_dump` GitHub Action for `songs`/`genres`/`song_genres` + CI drift-guard + refresh the S3 fallback CSV + fix `runbook.md:278`. Flag the exact schedule/secrets in the PR (new `.github/workflows/` file).
- **T1.7 Grafana alerts** — maintainer-only (Grafana Cloud dashboard work; no code). Hand the exact alert definitions to the maintainer to create.
- **Merge flow** — maintainer authorized me to merge green+verified PRs (standalone `gh pr merge <n> --squash`).
- **D-1 (PR E) — manager_token → `game_secrets`** — DONE in code (migration 034 + backend + `useGameChannel` explicit select + docs). Migration `034_game_secrets.sql` creates the anon-invisible `game_secrets` table (not in the Realtime publication), an `AFTER INSERT` trigger provisions the token, the four token RPCs `LEFT JOIN` it, and `active_games.manager_token` is dropped. Validated against a fresh testcontainer (152 tests/db + 80 backend + buzz-race + new `test_game_secrets.py`, all green) and idempotent (re-apply clean). **Prod apply is maintainer-gated:** after merge + go-ahead, and ideally during a quiet moment (no active game) since the new backend expects `game_secrets`. Apply with `supabase link --project-ref jvfddxuaqcsrguibkymp && supabase db query --linked -f db/migrations/034_game_secrets.sql`. Full prod verification folds into the T1.8 exit-gate game.

## Exit gate (Phase 1)
- [ ] `npm run lint && typecheck && test:run` green; new/updated `useGameChannel.test.ts` covers early-hydrate.
- [ ] `curl -I` confirms immutable caching on `/assets/*`, `no-cache` on `index.html`.
- [ ] Bundle: entry chunk shrank (Faro/Sentry off the critical path) — record before/after gz sizes.
- [ ] Join-to-playable measured faster than baseline (T1.8).
- [ ] **Full-Game Exit Gate** (playbook §6.2): full production three-tab game plays end to end, Hebrew titles render, zero console errors, buzz feels instant.
- [ ] No Realtime event regressions from the early-hydrate change (watch for missed events on reconnect during the manual game).
