# Phase 4 — Resilience: Mid-Game Failure Modes

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md). Autonomous. Work the tasks **one at a time, serially** — they cluster on a few shared files; batch tiny same-file tasks (e.g. T4.5+T4.6) into one PR.
**Notes:** T4.8 adds a token-gated `extend_game` RPC — the phase's only migration (additive; note it in the PR + update `rpc-functions.md`/`security-rls.md`/`data-model.md`).
**Gate:** beyond the standard full-game gate, run a deliberate **"adverse" game** hitting ≥3 failure paths (kill a video → Next round recovers; background the host tab → auto-resume [T4.2 ✅]; drop the socket → reconnect with no lost events [T4.3 ✅]).

**Goal:** a real party survives what actually goes wrong — a dead video, a locked phone, a dropped connection, a 4h overrun, a lost credential — without the room going silent or a screen going blank.

**Backlog refs:** `02-improvements.md §D` + F-P1-1/2/3/5/7 from `01`.

---

## Shipped / closed (verified against code 2026-07-07)

- **T4.0 · Deploy-safe chunk loading (F-P0-3)** ✅ PR #185 — `vite:preloadError` budget-guarded auto-reload (`lib/preloadError.ts`) + app-level `ErrorBoundary`. Removed the "never deploy during a live game" caveat.
- **T4.1 · Dead-video Skip button** ❌ de-scoped, PR #186 — **Next round** already moves past a dead video; persistent "Video unavailable" state ships; select/peek exclude played songs, so the blocklist is redundant. Revisit only if a real re-pick is ever observed.
- **T4.2 · Resume a paused song on tab-return (I-Resume)** ✅ PR #187 — `useResumeOnVisible` + `YouTubePlayer.resumeIfPaused()` (plays only from PAUSED, never replays ENDED; skips while a buzz holds the scoring pause).
- **T4.9 · Connecting/reconnecting states (I-Reconnect)** ✅ already shipped in Phase 2 (PR #163) — `TeamGameplayPage` distinguishes "CONNECTING…" from "RECONNECTING…" (`useGameChannel` `ChannelStatus` includes `reconnecting`). Nothing left to build.
- **T4.3 · Hydrate/queue robustness (F-P1-1, I-QueueDrain)** ✅ PR #190 — the event gate opens only on a snapshot that actually committed (failed hydrate keeps events queuing for the next authoritative attempt; success also clears the stale `error`); pending queue capped at `MAX_PENDING_EVENTS = 500` with overflow triggering one fresh resync (never a silent drop); the authoritative gone path closes the queue. Tests: failed-hydrate-then-replay + overflow-resync; `realtime-design.md` §6 updated.

## Open tasks (in recommended order — value + file affinity)

### T4.4 · Graceful expiry/teardown `[S]` — F-P1-2, `I-GoneDerive` (partial: gone-derivation already in `useGameChannel`) · **NEXT**
- [ ] Team-page guard for the cascade ordering (`game_teams` deletes **before** `active_games` at expiry, so the kick redirect still wins today — `TeamGameplayPage.tsx:61`).
- [ ] T-CascadeTest: pin the teams-before-game delete ordering (the general "gone" banner is already covered by `expiration.spec.ts`).

### T4.5 · Next-round failure recovery `[M]` — F-P1-3, `I-NextRecover` (partial: catch already stops the promoted player)
- [ ] Remember pre-swap state; on `select_next_song` failure revert `activeKeyRef`/`activeKey` and reload the current round's song; only commit the swap after the RPC confirms (keep mobile-autoplay-in-gesture).

### T4.6 · Bonus toast honesty `[S]` — F-P1-5 (batch with T4.5 — same file)
- [ ] For the Render-routed bonus, confirm only after the call resolves (or reconcile from the Realtime score delta) — no optimistic +4.

### T4.7 · Song-metadata retry `[S]` — F-P1-7
- [ ] Bounded backoff retry on the per-round `songs` fetch (`DisplayPage.tsx` + `ManagerConsolePage.tsx`), or key the effect on a retry counter.

### T4.8 · Expiry countdown + extend `[M]` — `I-Expiry`, X-Extend (the one task with a migration)
- [ ] Subtle countdown from `state.game.expires_at`; warning banner in the last ~20 min (expires_at counts from *creation* — lobby time eats into it).
- [ ] New token-gated `extend_game(p_game_code, p_manager_token)` RPC bumping `expires_at`; host "keep playing" affordance (confirm the surface — maintainer is button-averse).
- [ ] Doc the RPC in `rpc-functions.md`/`security-rls.md`/`data-model.md`; tests for token gating + the bump. Apply to prod before/with the deploy (lessons-learned F-P0-4).

### T4.10 · Host recovery affordance `[M]` — F-P1-6, X-Recovery
- [ ] A re-openable host link/QR in the console embedding the `manager_token`, so a wiped-localStorage host re-authenticates (token lives in `game_secrets` per D-1; the link carries the value).

### T4.11 · (optional) Final board survives delete `[M]` — `I-FinalBoard`
- [ ] Render the final scoreboard from last-known state on End/expiry (and/or an admin-gated `game_history` read). Today `GAME_DELETED` nukes state to null and shows "This game no longer exists."

---

## Exit gate (Phase 4)
- [ ] Simulate each failure and confirm graceful recovery: kill a video mid-round (Next round recovers), background the host tab (song resumes — done), drop the Realtime socket (reconnect + no lost events), force a `select_next_song` failure (room isn't silenced), let a game near expiry (warning shows, extend works).
- [ ] New e2e/reducer tests for cascade-delete UX, failed-hydrate, and expiry.
- [ ] `tests/db` green incl. the new `extend_game`.
- [ ] **Full-Game Exit Gate** passes; additionally run a deliberate "adverse" game touching at least 3 failure paths.
