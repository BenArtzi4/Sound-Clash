# 01 — Fixes (confirmed bugs)

Ranked P0 (fix now / production risk) → P1 (real user-facing bug) → P2 (edge/minor). Each item: evidence (`file:line`), the failure a user hits, the fix, and effort (S=hours, M=1–2 days, L=multi-day). Security-hole fixes that need an architecture call live in [05-decisions-needed.md](05-decisions-needed.md) and are cross-referenced here.

Legend for the perf tag on latency-adjacent items: `buzz-latency` (moves the <200ms number), `load` (time-to-playable), `smoothness` (perceived responsiveness).

---

## P0 — Production risk

### F-P0-1 · `manager_token` leaks to every client → full game hijack `[security, critical]`
- **Evidence:** `db/migrations/006_rls_policies.sql:38,43` (anon SELECT `USING(true)` on `active_games`) + `012_manager_token.sql:19` (token column, no restriction) + `useGameChannel.ts` `select('*')` + REPLICA IDENTITY FULL (`009`) puts the token in every Realtime UPDATE payload.
- **Failure:** anyone who can read the projector's 6-char code can fetch or sniff the host credential and then score, advance rounds, award bonus, kick teams, or end the game. Contradicts `docs/security-rls.md:157,188`.
- **Fix (needs a design call — see D-1):** move `manager_token` out of the anon-readable `active_games` row (separate table anon can't SELECT, keyed by game id), and stop `select('*')`-ing it. Recommended, but it's an architecture change → **decision D-1**. Effort M.

### F-P0-2 · Catalog is effectively unrecoverable (stale DR) `[ops, high]`
- **Evidence:** `docs/runbook.md:278` claims regenerable from `s3://…/songs.csv` (601 rows); `db/seed/songs.sql` has 7; prod ~1025; Supabase free tier = 1-day backup, no PITR.
- **Failure:** a bad migration / accidental DELETE / project loss not caught within 24h permanently destroys hundreds of hours of curation.
- **Fix:** scheduled `pg_dump` of `songs`/`genres`/`song_genres` committed to the repo (or pushed to object storage) + a CI drift-guard asserting prod row-count/hash vs the committed dump; refresh the S3 CSV; correct the runbook. Autonomous. Effort M. (See also I-DR in `02`.)

### F-P0-3 · Deploy-during-game blanks the screen `[bug, medium→P0 because it hits live players on every deploy]`
- **Evidence:** `_redirects` = `/* /index.html 200`; a stale chunk URL returns `index.html` as `200 text/html`; `vite:preloadError` has zero handlers and there is no ErrorBoundary (`App.tsx`). Confirmed live: old `/assets/index-*.js` returns 200 HTML.
- **Failure:** a player who loaded the app before a deploy, then navigates (join → `/team/:code`), triggers a failed dynamic import → blank white screen mid-party. Every Cloudflare Pages deploy is a live-game landmine.
- **Fix:** `window.addEventListener('vite:preloadError', () => location.reload())` with a sessionStorage guard against reload loops; add a route-level ErrorBoundary with a reload CTA. Autonomous. Effort S.

---

## P1 — Real user-facing bugs

### F-P1-1 · Failed initial hydrate silently drops all live events `[bug]`
- **Evidence:** `useGameChannel.ts:318` sets `hydrated = true` outside the try/catch, so a transient hydrate failure on SUBSCRIBED still flips the flag; subsequent events dispatch against `state === null` and hit the reducer's null-guards → discarded, not re-queued.
- **Failure:** on a network blip at subscribe time the client is permanently stuck — buzzes/scores never appear until a manual refresh.
- **Fix:** only set `hydrated = true` on success; keep queuing on failure; cap the pending array. Autonomous. Effort S.

### F-P1-2 · Team players ejected to Home (not "ended") on 4h cleanup `[bug]`
- **Evidence:** `TeamGameplayPage.tsx` redirect keys off `!state.teams.has(storedId)`; `cleanup_expired_games` cascade-deletes `game_teams` **before** `active_games`, so the team-DELETE arrives while `status` is still `subscribed` → redirect to `/join` instead of the "game over" screen.
- **Failure:** at expiry every player is bounced to the homepage as if kicked, not shown a graceful end.
- **Fix:** treat a missing team as a kick only while `state.game` is present; derive "gone" from `active_games` absence / `status === 'gone'`. Autonomous. Effort S.

### F-P1-3 · Failed Next-round leaves the room in silence `[bug]`
- **Evidence:** `ManagerConsolePage.tsx:559-563` swaps the double-buffer (`commitPrebuffered` + `stop()`) **before** awaiting `select_next_song`; the catch (`:606`) stops both players, `activeKey` stays swapped, `currentSong` never updates.
- **Failure:** if the RPC fails, both players are stopped, the card shows the prior song, the room goes silent with no auto-recovery.
- **Fix:** remember pre-swap state; on failure revert `activeKeyRef`/`activeKey` and reload the still-current round's song; only swap after the RPC confirms (keeps mobile-autoplay-in-gesture). Autonomous. Effort M.

### F-P1-4 · Dead/region-blocked video: only a transient toast, no skip `[bug/ux]`
- **Evidence:** `YouTubePlayer.tsx` `handlePlayerError` shows one auto-dismissing toast; the manager player uses `noCover`, so the persistent "Video unavailable" overlay never renders (`ManagerConsolePage.tsx:335`).
- **Failure:** a host who glanced away sees a frozen black iframe + silence with no explanation; must guess to press Next round; the dead song still burns a round number.
- **Fix:** persistent inline error state + a one-tap **Skip song** button on the manager when the live player errors; also blocklist the errored `youtube_id` for the game so peek/select can't re-pick it. Autonomous. Effort S–M. (Related feature: X-Skip in `03`.)

### F-P1-5 · Bonus optimistic toast can lie on cold-start failure `[bug]`
- **Evidence:** `ManagerConsolePage.tsx` `handleBonus` fires the "+4" success toast *before* awaiting the Render-routed REST call.
- **Failure:** on a Render cold start the room sees no +4 for up to 30s while the host believes it landed; on failure the host already saw success and the error toast stacks on top, easily missed → host and room disagree on the score.
- **Fix:** for the Render-routed bonus, confirm only after the call resolves (or reconcile from the Realtime score delta). Autonomous. Effort S.

### F-P1-6 · `manager_token` loss mid-game orphans the game `[bug]`
- **Evidence:** `managerToken.ts` — single credential, issued once at create, no re-issue; every host action is token-gated.
- **Failure:** if the host browser evicts localStorage (private mode, cache clear, device swap) the game is dead until the 4h sweep; players sit frozen.
- **Fix:** a host recovery affordance — a re-openable host link/QR embedding the token in the console — so the host can re-authenticate from the same or another device. Autonomous (frontend) once we decide the surface. Effort M. (Feature X-Recovery in `03`.)

### F-P1-7 · Per-round song-metadata fetch: no retry, blanks the round `[bug]`
- **Evidence:** `DisplayPage.tsx:99` and `ManagerConsolePage.tsx:186` both `return` on any transient `songs` SELECT error; effect deps never change again → never retries for that round.
- **Failure:** one transient DB blip and the display's title/artist reveal (or the manager's post-refresh player) stays blank for the whole round.
- **Fix:** bounded backoff retry (or key the effect on a retry counter). Autonomous. Effort S.

### F-P1-8 · `busy` flag silently drops rapid manager actions `[ux/smoothness]`
- **Evidence:** `ManagerConsolePage.tsx:373` — every hot handler already has a per-action `inFlightRef` *and* early-returns on a shared `busy` held for the full ~150ms RPC; the busy check precedes the optimistic toast, so the drop is silent.
- **Failure:** a host taking a second distinct action within the window sees nothing happen, no toast — the documented e2e "dropped click" race, surfacing as real host-facing lag on slow links.
- **Fix:** remove `busy` from the hot scoring/advance handlers (keep per-action refs); keep `busy` only on End/Bonus. Add a `pendingContinue` flag mirroring `pendingWrong` (F-P2-2). Autonomous. Effort S.

---

## P2 — Edge / minor

### F-P2-1 · Lost localStorage orphans a player; `UNIQUE(game_code,name)` blocks rejoin `[bug]`
- **Evidence:** `003_ephemeral_tables.sql` unique constraint; identity lives only in `game:<code>:team`.
- **Failure:** evicted player can't re-attach to their score; same-name rejoin 409s ("team name already taken").
- **Fix:** same-name reclaim within a game, or a per-team token (I-ReclaimToken in `03`). Effort M.

### F-P2-2 · Continue round has no pending flag (double-tap duplicate) `[ux]`
- **Evidence:** `ManagerConsolePage.tsx:468-486` — `handleContinueRound` relies only on `continueInFlightRef` + `busy`, cleared in `finally` before the Realtime UPDATE clears `buzzed_team_id`; `continueDisabled = !lockedTeam` reads the stale lock.
- **Fix:** add `pendingContinue` round-scoped flag (cleared when `buzzed_team_id` nulls). Effort S.

### F-P2-3 · `useKeepBackendWarm` never pings immediately `[bug]`
- **Evidence:** `useKeepBackendWarm.ts:22` schedules only `setInterval`; no ping on activation or `visibilitychange`.
- **Fix:** ping on mount and on `visibilitychange → visible`, then keep the interval. (Overlaps I-Warm in `02`; also consider whether the hook is redundant with cron — T-KeepWarm in `04`.) Effort S.

### F-P2-4 · CSV formula injection in the two curation exporters `[security, low]`
- **Evidence:** `add-songs.html:420` + `review.js:403` `csvCell` quote per RFC-4180 but don't neutralize a leading `= + - @ \t \r`; titles derive from attacker-uploadable YouTube titles.
- **Fix:** prefix a leading `'` (or force-quote) when the cell starts with a formula trigger — one mirrored one-liner. Effort S. (Tooling-only; not user-facing, but cheap.)

---

## Cross-references to decision-gated security fixes
These are confirmed but need an architecture/infra call before code — see `05`:
- **D-1** — `manager_token` leak (F-P0-1 fix).
- **D-2** — Real-time answer leak: anon reads the current song's title/artist the instant the round starts.
- **D-3** — Anon can enumerate every live game via one `select=*`; no rate limit on direct RPCs/Realtime.
- **D-4** — `buzz_in` doesn't verify team ownership (buzz as any team).
