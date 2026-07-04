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
- [ ] `useGameChannel.ts`: fire `void hydrate()` immediately after building the channel; keep the SUBSCRIBED re-hydrate.
- [ ] Confirm the pending-event queue still covers the gap (add/adjust `useGameChannel.test.ts`).

### T1.4 · Trim the join-path bundle `[S→M]` — `I-Faro`, `I-Sentry`
- [ ] Defer Faro: `initTelemetry()` behind `requestIdleCallback` on `load`; `Promise.all` the two dynamic imports.
- [ ] Set `VITE_FARO_URL` unset in prod env until #145 is fixed (coordinate: this is an env/ops change on Cloudflare — note in PR, may need the maintainer to unset the Pages var).
- [ ] Lazy-load Sentry after first render with a temporary `window.onerror` buffer.
- [ ] (Stretch) `manualChunks: { vendor: ['react','react-dom','react-router-dom'] }` in `vite.config.ts` — `I-Vendor`.

### T1.5 · Overlap chunk download with idle time `[S]` — `I-Prefetch`, `I-JoinWarm`, `I-Suspense`
- [ ] `JoinTeamPage`: `useEffect(() => { void import('./TeamGameplayPage') }, [])` to prefetch the gameplay chunk while the player types.
- [ ] `JoinTeamPage` + ManagerCreate deep-link: `void getHealth().catch(()=>{})` on mount; button label → "Waking the server — up to 30s…" after ~2.5s pending.
- [ ] `App.tsx`: replace `Suspense fallback={null}` with a tiny centered CSS logo-pulse.

### T1.6 · Disaster-recovery safety net `[M]` — `I-DR` (do this in Phase 1; it's the top production-readiness gap)
- [ ] Add a scheduled `pg_dump` of `songs`/`genres`/`song_genres` committed to the repo (or pushed to object storage) — a GitHub Action on cron. **This is a `.github/workflows/` addition → flag with the maintainer before adding (CI rule).**
- [ ] CI drift-guard: assert prod row-count/hash vs the committed dump; warn on drift.
- [ ] Refresh the S3 fallback CSV; correct `docs/runbook.md:278` (T-DocRunbook).

### T1.7 · Observability alerts `[S]` — `I-Alert` (cheap insurance, no code)
- [ ] Grafana alert: Realtime concurrent connections approaching ~200 free-tier cap.
- [ ] Grafana alert: monthly Realtime message consumption threshold.

### T1.8 · Measurement `[S]`
- [ ] Capture join-to-playable before/after (Playwright MCP against prod, or Lighthouse): time from `/join/:code` navigation to BUZZ button interactive. Record numbers in the PR so the win is provable.

---

## Decisions touched
- None block Phase 1. T1.4's `VITE_FARO_URL` unset and T1.6's new CI workflow are **flag-before-doing** (ops/CI), not full decisions — mention in the PR and get a thumbs-up.

## Exit gate (Phase 1)
- [ ] `npm run lint && typecheck && test:run` green; new/updated `useGameChannel.test.ts` covers early-hydrate.
- [ ] `curl -I` confirms immutable caching on `/assets/*`, `no-cache` on `index.html`.
- [ ] Bundle: entry chunk shrank (Faro/Sentry off the critical path) — record before/after gz sizes.
- [ ] Join-to-playable measured faster than baseline (T1.8).
- [ ] **Full-Game Exit Gate** (playbook §6.2): full production three-tab game plays end to end, Hebrew titles render, zero console errors, buzz feels instant.
- [ ] No Realtime event regressions from the early-hydrate change (watch for missed events on reconnect during the manual game).
