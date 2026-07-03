# Phase 2 — Performance: Perceived Smoothness & Buttons

**Goal:** every tap acknowledges within one frame; nothing on screen jumps, janks, or silently ignores a press. This is the "no lag" the maintainer is asking for, at the level a hand on a phone actually feels it.

**Why:** the buzz *number* is network-bound, but the buzz *feeling* is UI-bound — and this phase owns the feeling. All frontend, low-risk, autonomous.

**Backlog refs:** `02-improvements.md §B` (+ F-P1-8, F-P2-2 from `01`).

**Session shape:** single session. Runs in parallel with Phase 1 in a separate worktree (Phase 2 = `components/*`, `*.module.css`, `useBuzzer.ts`, `ManagerConsolePage.tsx`; minimal overlap with Phase 1's config/index.html).

---

## Tasks

### T2.1 · Provisional buzz-lock from the RPC result `[M]` — `I-BuzzLock` (headline)
- [ ] `useBuzzer.ts`: stop discarding `BuzzResult`; set optimistic `lockedByMe` / `locked-other` state from `{locked, locked_team_id}` the instant the RPC resolves.
- [ ] `TeamGameplayPage.tsx`: drive the button tone from that provisional state, reconciled by the Realtime UPDATE; rollback on RPC error.
- [ ] Add a transient "BUZZED!" tone at `pointerdown` (before the RPC).
- [ ] Tests: `useBuzzer.test.ts` win/lose/error paths; ensure Realtime still corrects a wrong optimistic guess.

### T2.2 · Instant press-in, eased release `[S]` — `I-PressFeedback`
- [ ] `BuzzButton.module.css` + `.btn` (`styles.css`) + `.scoreBtn`: `transition-duration: 0ms` on `:active`/`.pressed`; keep ease on the base rule for release.

### T2.3 · Composite the infinite animations `[S]` — `I-Anim`
- [ ] Body `bg-drift`: move to a `position:fixed; inset:0; z-index:-1` layer animated with `transform`, or gate behind `@media (pointer: fine)` + honor `prefers-reduced-motion`.
- [ ] `BuzzButton` pulse: `::after` ring animated with `transform: scale()` + `opacity` instead of `box-shadow` spread; drop/reduce the team-pill `backdrop-filter`.
- [ ] Display timer fill: `transform: scaleX(var(--pct))` + `transform-origin:left` instead of animating `width`.

### T2.4 · No layout shift on buzz `[S]` — `I-NoShift`
- [ ] Manager: give `lockedBanner` a permanent fixed-height slot (visibility toggle, not conditional mount) so scoring buttons never move. Combine into a **reserved status strip** ("Waiting for a buzz…" / "<Team> buzzed — score it:").
- [ ] Display: reserve the countdown row's height permanently (visibility toggle) so the scoreboard stops jumping on the TV.

### T2.5 · Kill the silent dropped-click `[S]` — F-P1-8, F-P2-2
- [ ] `ManagerConsolePage.tsx`: remove the shared `busy` gate from the hot scoring/advance handlers (keep each per-action `inFlightRef`); keep `busy` only on End/Bonus.
- [ ] Add `pendingContinue` round-scoped flag mirroring `pendingWrong`, included in `continueDisabled`.
- [ ] Update `ManagerConsolePage.test.tsx` for rapid distinct actions no longer being dropped.

### T2.6 · Smaller smoothness wins `[S]`
- [ ] `I-Admin`: stale-while-revalidate the admin table (dim + `aria-busy`, skeleton only on empty).
- [ ] `I-NextMeta`: on the Next-round fast path, render the peeked song's metadata from `preloadRef` immediately (don't wait for the RPC).
- [ ] "Start game" disabled state: label "Loading player…" while `!player.ready` so it reads as progress (`ManagerConsolePage`).
- [ ] Player reconnect copy: "CONNECTING…" vs the wrong "WAITING for the game to start"; "RECONNECTING…" on Realtime drop (`I-Reconnect`, shared with Phase 4).

### T2.7 · (optional) BuzzButton render isolation `[M/low]` — `I-TeamRender`
- [ ] After Phase 3's `I-Buzz1UPDATE` lands, memoize BuzzButton on a narrow `game.status`/lock slice so ROUND_CHANGE events don't re-render it.

---

## Decisions touched
- None. Fully autonomous.

## Exit gate (Phase 2)
- [ ] Lint/typecheck/vitest green; updated buzz + manager tests pass.
- [ ] **Manual phone test:** on a real mid-tier Android, BUZZ acknowledges instantly, flips to YOU BUZZED / SOMEONE ELSE on the RPC (not the echo); scoring buttons don't move when a buzz lands; no visible jank on the pulsing button or drifting background.
- [ ] Display on a TV: scoreboard doesn't jump when a team buzzes; timer bar animates smoothly.
- [ ] Rapid distinct manager taps (Correct Song then quickly Wrong) both register — no silent drop.
- [ ] **Full-Game Exit Gate** (playbook §6.2) passes on production.
- [ ] No regression in the optimistic-toast latency (still zero-perceived-latency clicks).
