# 02 — Improvements (performance & resilience)

Improvements to *existing* behavior. This is where the north star lives: **fast loads, instant buttons, no lag, no mid-game surprises.** Each item tags its lever — `load` / `smoothness` / `buzz-latency` / `resilience` — and effort (S/M/L). Almost all are low-risk autonomous work.

**Framing reminder:** the `<200ms` buzz number is network+fan-out bound; the items below labeled `load` and `smoothness` are what a user actually *feels* as speed. We ship them as smoothness/load wins, not as "buzzer latency fixes."

---

## A. Load & time-to-playable (`load`) — Phase 1

The player scanning the QR is the person we optimize for.

- **I-Hydrate · Fire `hydrate()` in parallel with the Realtime subscribe.** `[S]` Today `useGameChannel` calls `hydrate()` only inside the SUBSCRIBED callback, so the 3 state GETs wait for the whole WebSocket handshake (~300–800ms, worse on mobile) before the BUZZ button can render. Fire `hydrate()` right after building the channel; keep the SUBSCRIBED re-hydrate for gap coverage (the existing pending-queue makes this safe). **Biggest real time-to-BUZZ win.**
- **I-Cache · Immutable caching for `/assets/*`.** `[S]` `_headers` sets no `Cache-Control`, so CF Pages serves content-hashed bundles as `max-age=0, must-revalidate` — every load (incl. a player's mid-game refresh) revalidates 5–7 assets. Add `/assets/*` → `public, max-age=31536000, immutable` (safe: content-hashed). Also give un-hashed static (`/icons`, og-image, hero, manifest) `max-age=86400`. One of the highest-ROI quick wins.
- **I-Preconnect · Warm Supabase + api origins.** `[S]` `index.html` preconnects only YouTube (host-only), not `<ref>.supabase.co` (every join, hydrate, WS, buzz) or `api.soundclash.org` (the join POST). Add `preconnect` + `dns-prefetch` for both. Also fix the YouTube hints: drop `crossorigin` from `www.youtube.com` (the consumers are non-CORS, so the warmed socket is currently unused), add `youtube-nocookie.com` (actual embed origin) and `s.ytimg.com` (widget JS).
- **I-Faro · Defer / gate Faro telemetry.** `[S→M]` `main.tsx:16` fires `initTelemetry()` before `createRoot`, pulling ~58KB gz of Faro on every page — and per **#145 it sends nothing**. Defer behind `requestIdleCallback` on `load` and `Promise.all` the two imports; **unset `VITE_FARO_URL` until #145 is fixed** (removes it entirely); longer-term, gate Faro to the manager/display pages that emit the spans that matter. Closes dead weight + an open issue.
- **I-Sentry · Lazy-load Sentry.** `[M]` `main.tsx` statically imports `@sentry/react` (~22KB gz, 23% of the entry chunk) with `tracesSampleRate: 0` — errors only — yet every QR-scanning player parses it before React mounts. Dynamic-import after first render, buffering early errors via a temporary `window.onerror` queue.
- **I-Prefetch · Prefetch the gameplay chunk while the player types.** `[S]` JoinTeamPage sits idle for 10–20s of typing, then fetches TeamGameplayPage + the 53KB gz supabase chunk serially after the join POST. `useEffect(() => { void import('./TeamGameplayPage') }, [])` overlaps that download with typing.
- **I-JoinWarm · Prewarm Render from the QR landing page.** `[S]` The QR encodes `/join/:code`, bypassing HomePage's `getHealth()` prewarm. Fire `getHealth()` on JoinTeamPage (and ManagerCreate deep-link) mount; upgrade the button label to "Waking the server — up to 30s…" after ~2.5s pending.
- **I-Suspense · Replace `fallback={null}` with a tiny spinner.** `[S]` All six lazy routes show pure white during chunk download; a centered CSS logo-pulse reads as "loading," not "broken."
- **I-Vendor · Split react/react-dom/router into a stable vendor chunk.** `[M]` The 314KB entry is ~70% framework bytes that never change between app deploys, yet any app edit invalidates the whole chunk's cache. `manualChunks: { vendor: [...] }` (pairs with I-Cache for cross-deploy caching).
- **I-CriticalCSS · (optional) Inline the ~4KB critical CSS.** `[M/low]` `index-*.css` is render-blocking; at 4KB gz inlining removes one RTT on first paint. Marginal once I-Cache lands.

## B. Perceived smoothness & buttons (`smoothness`) — Phase 2

What a hand on a phone feels as "instant" vs "laggy."

- **I-BuzzLock · Provisional local buzz-lock from the RPC result.** `[M]` `buzz_in` returns `{locked, locked_team_id}` — definitive (atomic CAS). `useBuzzer.ts:45` throws it away and waits for the Realtime echo to flip the button to YOU BUZZED / SOMEONE ELSE. Set optimistic state from the RPC reply the instant it resolves; reconcile on the Realtime event; rollback on error. The headline interaction becomes RPC-speed. Add a transient "BUZZED!" tone at `pointerdown`.
- **I-PressFeedback · Instant press-in, eased release.** `[S]` The BUZZ pressed look ramps in over 200ms (symmetric transition) — right at the perception threshold on the most latency-critical tap. Asymmetric transitions: `transition-duration: 0ms` on `:active`/`.pressed`, keep the ease on release. Apply to `.button`, `.btn`, `.scoreBtn`.
- **I-Anim · Composite all infinite animations (kill continuous repaint).** `[S]` Three offenders repaint the whole viewport every frame, forever: body `bg-drift` animates `background-position` on a `fixed` gradient (`styles.css:80`); BuzzButton pulses `box-shadow` spread (`BuzzButton.module.css:132`); the display timer animates `width` (`DisplayPage.module.css:206`). Move each to `transform`/`opacity` on a pseudo-element or fixed layer; gate decorative drift behind `@media (pointer: fine)` / `prefers-reduced-motion`. Battery + smoothness win on cheap Androids.
- **I-NoShift · Reserve height for conditional banners (no layout jump).** `[S]` The manager `lockedBanner` conditionally mounts and shoves the scoring buttons ~70px down when a buzz lands — a real mis-tap hazard under the thumb. The display countdown does the same to the whole scoreboard on the TV. Give both a permanent fixed-height slot that toggles visibility, not mount. Combine with a **reserved status strip** on the manager card ("Waiting for a buzz…" / "<Team> buzzed — score it:") so buttons never move and hosts build muscle memory.
- **I-Admin · Stale-while-revalidate the admin catalog.** `[S]` Every debounced keystroke/page/filter `setLoading(true)` blanks the table to 5 skeleton rows and snaps scroll. Keep prior rows (dimmed, `aria-busy`) during refetch; skeleton only on first load.
- **I-NextMeta · Show the new song's metadata in-gesture on the fast path.** `[S]` On the prebuffered Next-round fast path the new song is already audible, but the card shows the *previous* title until the RPC resolves. The peeked metadata is already in `preloadRef` — render it immediately.
- **I-TeamRender · Isolate BuzzButton from unrelated re-renders.** `[M/low]` TeamGameplayPage re-renders on every ROUND_CHANGE (title/artist claims, free_guess) that doesn't affect the buzzer. After I-Buzz1UPDATE (below) memoize BuzzButton on a narrow `game.status`/lock slice.

## C. Backend-path & Realtime economics (`buzz-latency`-adjacent + quota) — Phase 3

Removing wasted writes/events. Touches PL/pgSQL — careful, gated by the buzz-race test.

- **I-Buzz1UPDATE · Drop the dead `game_rounds` UPDATE from `buzz_in`.** `[S]` `buzz_in` writes `game_rounds.buzzed_team_id` (mig 011) for the *replaced* `award_points`; nothing reads it now (award reads `active_games`; pages read `game.buzzed_team_id`). With REPLICA IDENTITY FULL it broadcasts a full ~14-col row + a no-op ROUND_CHANGE re-render to every client on **every buzz**. `CREATE OR REPLACE` dropping the write halves buzz-path Realtime events; update `rpc-functions.md`.
- **I-Award1UPDATE · Collapse `award_attempt`'s 2–3 UPDATEs into one.** `[S]` A Correct Song commits one claim UPDATE + a second `free_guess_active` UPDATE (which runs even when unchanged); soundtrack makes three. Merge all changed columns into one `UPDATE … RETURNING` computed from branch vars; drop the two trailing SELECTs (`021:194`) via RETURNING. One event + fewer reads per click.
- **I-AttemptsPub · Remove `game_round_attempts` from the Realtime publication.** `[S]` It's published + REPLICA IDENTITY FULL but has zero subscribers, so Supabase WAL-decodes/broadcasts every scored attempt for nothing. `ALTER PUBLICATION supabase_realtime DROP TABLE game_round_attempts;` (keep the table for analytics/streaks — if we later build streaks we re-add it deliberately).
- **I-Resync · Trim the 20s REST re-sync cadence.** `[S]` `useGameChannel:266` fires 3 `select *` every 20s per visible client regardless of Realtime health (~1.2 q/s for a 6-team game). Since mig 009/010 fixed the event-loss bugs, lengthen to ~60s or only resync when `status==='reconnecting'`. Also **tear down the resync + channel once a game is `gone`** (a display left overnight polls forever).
- **I-Warm · Keep-warm: immediate + visibility-aware.** `[S]` Ping `/health` on mount and on `visibilitychange → visible` (mobile freezes background intervals), so a woken host re-warms Render before Bonus/End. (Decide vs T-KeepWarm redundancy in `04`.)

## D. Resilience — mid-game failure modes — Phase 4

Make a real party survive the things that go wrong. (Several of these are also bugs in `01`; here they're framed as the resilience posture.)

- **I-Skip · Persistent video-error state + host Skip-song.** `[S–M]` (see F-P1-4) + blocklist the errored `youtube_id` so it can't be re-picked.
- **I-Resume · Recover a paused song after host phone lock.** `[S–M]` On `visibilitychange → visible` with `status==='playing'` and no buzz, auto-resume playback; or add a plain play/pause toggle. Today the host is stranded with a silent paused song and must burn the round.
- **I-Expiry · Expiry countdown + token-gated extend RPC.** `[M]` `state.game.expires_at` is already synced. Render a subtle countdown that becomes a warning banner in the last ~20 min; add a token-gated `extend_game` RPC that pushes `expires_at` forward. Removes the abrupt 4h party-death. Note `expires_at` counts from *creation*, so lobby time eats into it — factor into the warning.
- **I-Reconnect · Surface a "reconnecting…" state on the buzz page.** `[S]` `buzzDisabled` greys the button during a Realtime drop with no explanation; show "RECONNECTING…" so the dead button reads as transient. Also distinguish "CONNECTING…" from the wrong "WAITING for the game to start" a mid-round refresher briefly sees.
- **I-QueueDrain · Make the pre-hydration queue drain-safe.** `[S]` (see F-P1-1) keep `hydrated=false` until a snapshot commits; cap the queue.
- **I-GoneDerive · Derive "gone" from `active_games`, not team absence.** `[S]` (see F-P1-2) order-independent teardown.
- **I-NextRecover · Revert the double-buffer on Next-round failure.** `[M]` (see F-P1-3).
- **I-FinalBoard · Host-visible final board that survives the abrupt delete.** `[M]` When a game ends/expires the host loses the live board (`game_history` has no UI). Render the final scoreboard from last-known state (and/or an admin-gated `game_history` read).

## E. Disaster recovery & ops (`resilience`/ops) — Phase 1 (do early)

- **I-DR · Committed catalog dump + CI drift-guard.** `[M]` (see F-P0-2) the single most important production-readiness item after the token leak.
- **I-Liveness · Proactive dead-YouTube-ID check.** `[M]` Batch-validate `youtube_id`s off-line (oEmbed/Data API) on a schedule; flag dead songs out of the `select_next_song` pool or into a review queue. Stops the steady drip of "video unavailable" mid-party across ~1025 aging videos.
- **I-Alert · Grafana alerts on Realtime connections + message quota.** `[S]` Alert as concurrent Realtime connections approach the ~200 free-tier cap and on monthly message consumption — surfaces both the DoS vector (D-3) and organic overload before players hit "can't subscribe."
- **I-Vitals · Web-Vitals dashboard once Faro sends.** `[S]` `getWebInstrumentations()` already collects vitals; once #145 is fixed, a Grafana dashboard for LCP/TTFB/INP by route makes the load wins above measurable.
- **I-BuzzMetric · Server-authoritative buzz-latency metric.** `[M]` Current buzz span measures pointerdown→local Realtime receipt, conflating RPC + WAL + fanout. Emit `locked_at` + commit timestamp to separate "DB lock latency" from "fanout latency" — so we can *prove* whether we're under budget and where the time goes.
