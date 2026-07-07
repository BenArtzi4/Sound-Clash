# Phase 4 — Resilience: Mid-Game Failure Modes

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md). Autonomous. One session/PR per fix (they're independent).
**Notes:** T4.8 adds a token-gated `extend_game` RPC (note in PR + doc it); T4.10 (host recovery link) coordinates with the D-1 relocated token — sequence D-1 first.
**Gate:** beyond the standard full-game gate, run a deliberate **"adverse" game** hitting ≥3 failure paths (kill a video → Skip; background the host tab → resume; drop the socket → reconnect with no lost events). **Workflow:** optional, only for bulk e2e-spec generation of the failure scenarios (else single-session).

**Goal:** a real party survives what actually goes wrong — a dead video, a locked phone, a dropped connection, a 4h overrun, a lost credential — without the room going silent or a screen going blank.

**Why:** "production-perfect" means graceful under failure, not just fast when everything's fine. All autonomous except I-Expiry's new RPC (trivial, token-gated) and the X-Recovery surface choice.

**Backlog refs:** `02-improvements.md §D` + F-P1-1/2/3/4/5/7 from `01`.

**Session shape:** one session per fix (they're independent). Good candidates for a small workflow only if generating the matching e2e specs in bulk (Phase 7 territory).

---

## Tasks

### T4.0 · Deploy-safe chunk loading (do first) `[S]` — F-P0-3 (orphaned P0) ✅ (PR #185)
- [x] `window.addEventListener('vite:preloadError', …)` → `location.reload()`, guarded by a `sessionStorage` budget against reload loops (a stale content-hashed chunk 200s as `index.html` after a Cloudflare deploy → failed dynamic import → blank white screen mid-party; routes are `React.lazy`, so join → `/team/:code` is the classic trigger). → `frontend/src/lib/preloadError.ts` (bounded reload count per incident, reset after a 5-min window — loop-proof regardless of reload-cycle timing; and when `sessionStorage` is unavailable it does NOT auto-reload, deferring to the ErrorBoundary CTA, since a budget that can't survive the reload can't guarantee loop-freedom).
- [x] Add an app-level `ErrorBoundary` (App has none) with a "reload" CTA as the backstop. → `frontend/src/components/ErrorBoundary.tsx`, wraps the whole tree in `App.tsx`.
- [x] Test (T-DeployTest): simulate a failed dynamic import → reload. → `preloadError.test.ts` (dispatch `vite:preloadError` → reload + record budget, per-incident cap → defer, later-deploy budget reset, storage-unavailable → defer, idempotent install) + `ErrorBoundary.test.tsx` (throw → CTA → hard reload; asserts our specific diagnostic log). This removes the "never deploy during a game" operational caveat entirely — **highest-value single fix for a live party**.

### T4.1 · Dead-video handling + Skip `[S–M]` — F-P1-4, `I-Skip`, X-Skip
> Note: the persistent inline "Video unavailable" state is already shipped (`YouTubePlayer.tsx`); what remains is the one-tap **Skip song** button + the errored-`youtube_id` blocklist.
- [ ] Persistent inline "Video unavailable" state on the manager when the live player errors (don't rely on the auto-dismiss toast).
- [ ] One-tap **Skip song** button → `select_next_song`, not counting the dead song against anything meaningful.
- [ ] Blocklist the errored `youtube_id` for the game so peek/select can't re-pick it (client-side exclude set passed to peek; or a small server-side exclusion).

### T4.2 · Recover a paused song after host phone lock `[S–M]` — `I-Resume`
- [ ] On `visibilitychange → visible` with `game.status==='playing'` and no buzz, auto-resume playback; or add a plain play/pause toggle on the manager.

### T4.3 · Hydrate/queue robustness `[S]` — F-P1-1, `I-QueueDrain`
- [ ] Only set `hydrated = true` on a successful snapshot; keep queuing on failure; cap the pending array (~500).
- [ ] Test: failed-first-hydrate then a live event is not dropped.

### T4.4 · Graceful expiry/teardown `[S]` — F-P1-2, `I-GoneDerive`
- [ ] Derive "gone" from `active_games` absence / `status==='gone'`; treat missing team as a kick only while `state.game` is present.
- [ ] Test the cascade-delete ordering (T-CascadeTest).

### T4.5 · Next-round failure recovery `[M]` — F-P1-3, `I-NextRecover`
- [ ] Remember pre-swap state; on `select_next_song` failure revert `activeKeyRef`/`activeKey` and reload the current round's song; only commit the swap after the RPC confirms.

### T4.6 · Bonus toast honesty `[S]` — F-P1-5
- [ ] For the Render-routed bonus, confirm only after the call resolves (or reconcile from the Realtime score delta) — no optimistic +4.

### T4.7 · Song-metadata retry `[S]` — F-P1-7
- [ ] Bounded backoff retry on the per-round `songs` fetch (display reveal + manager refresh), or key the effect on a retry counter.

### T4.8 · Expiry countdown + extend `[M]` — `I-Expiry`, X-Extend
- [ ] Render a subtle countdown from `state.game.expires_at`; warning banner in the last ~20 min (account for lobby time since `expires_at` is from creation).
- [ ] New token-gated `extend_game(p_game_code, p_manager_token)` RPC that bumps `expires_at`; host "keep playing" button.
- [ ] Doc the RPC in `rpc-functions.md`; tests for token gating + the bump.

### T4.9 · Reconnecting/connecting states `[S]` — `I-Reconnect`
- [ ] Distinguish "CONNECTING…" (initial) from "RECONNECTING…" (Realtime drop) on the team page; small hint so the greyed BUZZ reads as transient.

### T4.10 · Host recovery affordance `[M]` — F-P1-6, X-Recovery
- [ ] A re-openable host link/QR in the console embedding the `manager_token`, so a wiped-localStorage host re-authenticates. (Coordinate with D-1: if the token moves to a separate table, the recovery link still works — it carries the token value, not the row.)

### T4.11 · (optional) Final board survives delete `[M]` — `I-FinalBoard`
- [ ] Render the final scoreboard from last-known state on End/expiry (and/or an admin-gated `game_history` read).

---

## Decisions touched
- **T4.8** adds a small token-gated RPC — autonomous (consistent with the existing model), but note it in the PR.
- **T4.10** coordinates with **D-1** (token relocation). Sequence D-1 first if chosen.

## Exit gate (Phase 4)
- [ ] Simulate each failure and confirm graceful recovery: kill a video mid-round (Skip works), background the host tab (song resumes), drop the Realtime socket (reconnect + no lost events), force a `select_next_song` failure (room isn't silenced), let a game near expiry (warning shows, extend works).
- [ ] New e2e/reducer tests for cascade-delete UX, failed-hydrate, and expiry.
- [ ] `tests/db` green incl. the new `extend_game`.
- [ ] **Full-Game Exit Gate** passes; additionally run a deliberate "adverse" game touching at least 3 failure paths.
