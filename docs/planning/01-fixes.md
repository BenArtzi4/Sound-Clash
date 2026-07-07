# 01 — Fixes (confirmed bugs)

Ranked P0 (fix now / production risk) → P1 (real user-facing bug) → P2 (edge/minor). Each item: evidence (`file:line`), the failure a user hits, the fix, and effort (S=hours, M=1–2 days, L=multi-day). Security-hole fixes that need an architecture call live in [05-decisions-needed.md](05-decisions-needed.md) and are cross-referenced here.

Legend for the perf tag on latency-adjacent items: `buzz-latency` (moves the <200ms number), `load` (time-to-playable), `smoothness` (perceived responsiveness).

> **Resolved items removed 2026-07-05** (shipped in Phases 1–3; detail in git history / `CHANGELOG.md`): F-P0-1 (manager_token leak → `game_secrets`, mig 034), F-P0-2 (catalog DR backup), F-P0-4 (deploy-before-migrate outage), F-P1-8 (busy flag dropped clicks), F-P2-2 (Continue pending flag), F-P2-3 (keep-warm immediate ping). IDs are intentionally not reused.

---

## P0 — Production risk

### F-P0-3 · Deploy-during-game blanks the screen `[bug, P0 — hits live players on every deploy]` — ✅ RESOLVED (Phase 4 T4.0, PR #185)
- **Evidence:** `_redirects` = `/* /index.html 200`; a stale content-hashed chunk URL returns `index.html` as `200 text/html`; `vite:preloadError` has zero handlers and there is no ErrorBoundary (`App.tsx`); routes are `React.lazy` (`App.tsx`). Confirmed live: old `/assets/index-*.js` returns 200 HTML.
- **Failure:** a player who loaded the app before a deploy, then navigates (join → `/team/:code`), triggers a failed dynamic import → blank white screen mid-party. Every Cloudflare Pages deploy is a live-game landmine.
- **Fix (shipped):** `frontend/src/lib/preloadError.ts` handles `vite:preloadError` → auto-reloads, guarded by a `sessionStorage` reload BUDGET (one auto-reload per incident, reset after a 5-min window). The budget is loop-proof regardless of reload-cycle timing, and when the reload can't recover (broken deploy / offline) or `sessionStorage` is unavailable it stops auto-reloading and defers to the app-level `frontend/src/components/ErrorBoundary.tsx` manual-reload CTA. Tests: `preloadError.test.ts` + `ErrorBoundary.test.tsx` (T-DeployTest). Runbook §1.2 updated: **deploying during a live game is now safe.**

---

## P1 — Real user-facing bugs

### F-P1-1 · Failed initial hydrate silently drops all live events `[bug]` — Phase 4 T4.3
- **Evidence:** `useGameChannel.ts:318` sets `hydrated = true` outside the try/catch, so a transient hydrate failure on SUBSCRIBED still flips the flag; subsequent events dispatch against `state === null` and hit the reducer's null-guards → discarded, not re-queued.
- **Failure:** on a network blip at subscribe time the client is permanently stuck — buzzes/scores never appear until a manual refresh.
- **Fix:** only set `hydrated = true` on success; keep queuing on failure; cap the pending array. Autonomous. Effort S.

### F-P1-2 · Team players ejected to Home (not "ended") on 4h cleanup `[bug]` — Phase 4 T4.4 · **PARTIAL**
- **Evidence:** `TeamGameplayPage.tsx` redirect keys off `!state.teams.has(storedId)`; `cleanup_expired_games` cascade-deletes `game_teams` **before** `active_games`, so the team-DELETE arrives while `status` is still `subscribed` → redirect to `/join` instead of the "game over" screen.
- **Failure:** at expiry every player is bounced to the homepage as if kicked, not shown a graceful end.
- **Status (2026-07-05):** the closely-related *display/host* teardown symptom (swept game stuck on "Connecting…") was fixed in PR #173. The **team-page** root-cause refactor (`I-GoneDerive` — treat a missing team as a kick only while `state.game` is present; derive "gone" from `active_games` absence) is **still open**. Autonomous. Effort S.

### F-P1-3 · Failed Next-round leaves the room in silence `[bug]` — Phase 4 T4.5
- **Evidence:** `ManagerConsolePage.tsx` swaps the double-buffer (`commitPrebuffered` + `stop()`) **before** awaiting `select_next_song`; the catch stops both players, `activeKey` stays swapped, `currentSong` never updates.
- **Failure:** if the RPC fails, both players are stopped, the card shows the prior song, the room goes silent with no auto-recovery.
- **Fix:** remember pre-swap state; on failure revert `activeKeyRef`/`activeKey` and reload the still-current round's song; only swap after the RPC confirms (keeps mobile-autoplay-in-gesture). Autonomous. Effort M.

### F-P1-4 · Dead/region-blocked video: no Skip `[bug/ux]` — Phase 4 T4.1 · **PARTIAL**
- **Evidence:** `YouTubePlayer.tsx` now shows a **persistent inline "Video unavailable"** state (the original "transient toast only" complaint is already addressed). What remains: no one-tap **Skip song** button, and no per-game blocklist of the errored `youtube_id`.
- **Failure:** a host with a dead song can see the error but must press Next round to move on; the dead song still burns a round number and could be re-picked.
- **Fix:** a one-tap **Skip song** button on the manager when the live player errors + blocklist the errored `youtube_id` for the game so peek/select can't re-pick it. Autonomous. Effort S–M. (Related feature: X-Skip in `03`.)

### F-P1-5 · Bonus optimistic toast can lie on cold-start failure `[bug]` — Phase 4 T4.6
- **Evidence:** `ManagerConsolePage.tsx` `handleBonus` fires the "+4" success toast *before* awaiting the Render-routed REST call.
- **Failure:** on a Render cold start the room sees no +4 for up to 30s while the host believes it landed; on failure the host already saw success and the error toast stacks on top, easily missed → host and room disagree on the score.
- **Fix:** for the Render-routed bonus, confirm only after the call resolves (or reconcile from the Realtime score delta). Autonomous. Effort S.

### F-P1-6 · `manager_token` loss mid-game orphans the game `[bug]` — Phase 4 T4.10
- **Evidence:** `managerToken.ts` — single credential, issued once at create, no re-issue; every host action is token-gated.
- **Failure:** if the host browser evicts localStorage (private mode, cache clear, device swap) the game is dead until the 4h sweep; players sit frozen.
- **Fix:** a host recovery affordance — a re-openable host link/QR embedding the token in the console — so the host can re-authenticate from the same or another device. Autonomous (frontend) once we decide the surface. Effort M. (Feature X-Recovery in `03`.)

### F-P1-7 · Per-round song-metadata fetch: no retry, blanks the round `[bug]` — Phase 4 T4.7
- **Evidence:** `DisplayPage.tsx:99` and `ManagerConsolePage.tsx:186` both `return` on any transient `songs` SELECT error; effect deps never change again → never retries for that round.
- **Failure:** one transient DB blip and the display's title/artist reveal (or the manager's post-refresh player) stays blank for the whole round.
- **Fix:** bounded backoff retry (or key the effect on a retry counter). Autonomous. Effort S.

---

## P2 — Edge / minor

### F-P2-1 · Lost localStorage orphans a player; `UNIQUE(game_code,name)` blocks rejoin `[bug]` — Phase 5 T5.7
- **Evidence:** `003_ephemeral_tables.sql` unique constraint; identity lives only in `game:<code>:team`.
- **Failure:** evicted player can't re-attach to their score; same-name rejoin 409s ("team name already taken").
- **Fix (decided):** D-4 declined per-team tokens, so the fix is a **simple same-name reclaim** — `join_team` returns the existing team row when the same name rejoins the same game (no token). Lands in Phase 5 T5.7. Effort S–M.

### F-P2-4 · CSV formula injection in the two curation exporters `[security, low]` — Phase 5 T5.1
- **Evidence:** `add-songs.html:420` + `review.js:403` `csvCell` quote per RFC-4180 but don't neutralize a leading `= + - @ \t \r`; titles derive from attacker-uploadable YouTube titles.
- **Fix:** prefix a leading `'` (or force-quote) when the cell starts with a formula trigger — one mirrored one-liner. Effort S. (Tooling-only; not user-facing, but cheap.)

---

## Cross-references to security fixes (decisions resolved 2026-07-04 — see `05`)
- **D-1 = A** — fix the `manager_token` leak by moving it to a secret table (was F-P0-1). **✅ shipped** (mig 034, game_secrets). Phase 5 hardening items build on it.
- **D-2 = accept** — real-time answer leak documented as a casual-play tradeoff. Phase 5 T5.8.
- **D-3 = A** — Cloudflare edge + WAF for the direct-RPC/Realtime surface + enumeration. Phase 5 T5.6. **Infra/ops — not yet implemented.**
- **D-4 = accept** — buzz-spoofing accepted + documented; F-P2-1 gets same-name reclaim instead. Phase 5 T5.7.
