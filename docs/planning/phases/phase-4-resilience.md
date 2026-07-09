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
- **T4.4 · Graceful expiry/teardown (F-P1-2, I-GoneDerive)** ✅ PR #192 — the team page distinguishes the expiry sweep's cascade (team row deleted while the game row is still present but ended/`expires_at` passed, judged on the `serverTimeNow()` offset clock) from a genuine kick: banner in place instead of a silent Home bounce; a kick from a live game still redirects. T-CascadeTest pins the teams-before-game ordering (3 vitest cases) and `expiration.spec.ts` now requires the banner (no redirect tolerance). Docs synced: `realtime-design.md` §7, `game-rules.md` §7/§10, `testing-strategy.md`.
- **T4.5 · Next-round failure recovery (F-P1-3, I-NextRecover)** ✅ PR #193 — on `select_next_song` failure the in-gesture double-buffer swap rolls back fully: promoted player stopped, `activeKeyRef`/`activeKey` reverted, the pre-click song card restored and the still-current round's song reloaded (room isn't silenced; best-effort on strict mobile autoplay since the reload lands post-gesture), and the peeked song re-prebuffered into the standby so a retry keeps the same-song fast path. The swap still starts in-gesture (mobile autoplay) but only *stands* once the RPC confirms. Tests: full-rollback + retry-keeps-fast-path vitest cases.
- **T4.6 · Bonus toast honesty (F-P1-5)** ✅ PR #193 — no optimistic "+4": the click acknowledges with a "Sending +4 to …" info toast, `busy` gates Bonus + End game while the Render call is in flight, and the success toast fires only after it resolves; a failure shows only the error toast.
- **T4.7 · Song-metadata retry (F-P1-7)** ✅ PR #194 — both pages resolve `game_rounds.song_id` via the new `fetchSongById()` in `lib/songMetadata.ts`: bounded backoff retry (5 attempts over ~7.5s), cancellation-aware at every await, authoritative "no row" not retried, `song_fetch_retry`/`song_fetch_failed` telemetry. Effect keys and the I-NextMeta optimistic guard unchanged. Also closed tech-debt T-SongFetch (the duplicated select + cast now live in one tested spot). Tests: 6 fake-timer helper cases + a display-reveal-recovers and a manager-post-refresh-recovers page case (`setSongFetchFailures` added to the supabase mock).
- **T4.8 · Expiry countdown + extend (`I-Expiry`, X-Extend)** ✅ PR #195 — mig 039 adds `extend_game(p_game_code, p_manager_token)`: token-gated (mig-034 `game_secrets` shape), anon-EXECUTE, `expires_at = GREATEST(expires_at, now()) + 1h` (so an overdue-but-unswept game gets a real hour), repeat calls stack, lobby extendable, ended refused. The console's new `ExpiryCountdown` renders an "Ends at HH:MM" hint that becomes a warning banner with the single **Keep playing +1h** action in the last 20 min (kept up for overdue-but-unswept games); the button disables from click until the Realtime `expires_at` bump lands (pending flag keyed on the clicked value — no double-extend). Maintainer confirmed the surface 2026-07-09: banner-button at T-20min (no auto-extend), manager console only. The ticking m:ss sits under `role="timer"` with a one-shot hidden announcer (RoundCountdown pattern). Docs synced (`rpc-functions.md` §3e + matrix, `security-rls.md`, `data-model.md`, `api-contracts.md` §2.5c, `game-rules.md` §10, runbook 4.4/4.5, CLAUDE.md, CHANGELOG). Tests: 8 db cases + grants-matrix row; 6 component + 3 page vitest cases; mig applied 2× locally + live-smoked. **Prod: mig 039 applied before the deploy (F-P0-4).**

## Open tasks (in recommended order — value + file affinity)

### T4.10 · Host recovery affordance `[M]` — F-P1-6, X-Recovery · **NEXT**
- [ ] A re-openable host link/QR in the console embedding the `manager_token`, so a wiped-localStorage host re-authenticates (token lives in `game_secrets` per D-1; the link carries the value).

### T4.11 · (optional) Final board survives delete `[M]` — `I-FinalBoard`
- [ ] Render the final scoreboard from last-known state on End/expiry (and/or an admin-gated `game_history` read). Today `GAME_DELETED` nukes state to null and shows "This game no longer exists."

---

## Exit gate (Phase 4)
- [ ] Simulate each failure and confirm graceful recovery: kill a video mid-round (Next round recovers), background the host tab (song resumes — done), drop the Realtime socket (reconnect + no lost events), force a `select_next_song` failure (room isn't silenced), let a game near expiry (warning shows, extend works).
- [ ] New e2e/reducer tests for cascade-delete UX, failed-hydrate, and expiry.
- [ ] `tests/db` green incl. the new `extend_game`.
- [ ] **Full-Game Exit Gate** passes; additionally run a deliberate "adverse" game touching at least 3 failure paths.
