# Phase 2 — Performance: Perceived Smoothness & Buttons

## ▶ Kickoff
**Model:** Opus 4.8. Follow [EXECUTION-CONTRACT.md](EXECUTION-CONTRACT.md). Fully autonomous — no decisions.
**PR split:** (A) provisional buzz-lock from the RPC result [`useBuzzer.ts`, `TeamGameplayPage.tsx` + tests]; (B) instant press feedback + composited animations [`BuzzButton.module.css`, `styles.css`, `DisplayPage.module.css`]; (C) no-layout-shift banners + reserved status strip [`ManagerConsolePage`]; (D) drop the silent `busy` gate + `pendingContinue` [`ManagerConsolePage` + test]; (E) admin stale-while-revalidate + small copy/loading fixes.
**Parallel-friendly:** can run in a separate git worktree alongside Phase 1 (minimal file overlap: Phase 2 = components/CSS/hooks; Phase 1 = config/index.html/main.tsx). **Workflow:** only the end-of-phase gate audit.

**Goal:** every tap acknowledges within one frame; nothing on screen jumps, janks, or silently ignores a press. This is the "no lag" the maintainer is asking for, at the level a hand on a phone actually feels it.

**Why:** the buzz *number* is network-bound, but the buzz *feeling* is UI-bound — and this phase owns the feeling. All frontend, low-risk, autonomous.

**Backlog refs:** `02-improvements.md §B` (+ F-P1-8, F-P2-2 from `01`).

**Session shape:** single session. Runs in parallel with Phase 1 in a separate worktree (Phase 2 = `components/*`, `*.module.css`, `useBuzzer.ts`, `ManagerConsolePage.tsx`; minimal overlap with Phase 1's config/index.html).

---

## Tasks

### T2.1 · Provisional buzz-lock from the RPC result `[M]` — `I-BuzzLock` (headline) — ✅ PR #159
- [x] `useBuzzer.ts`: stop discarding `BuzzResult`; set optimistic `lockedByMe` / `locked-other` state from `{locked, locked_team_id}` the instant the RPC resolves.
- [x] `TeamGameplayPage.tsx`: drive the button tone from that provisional state (via the hook's effective `lockedTeamId`), reconciled by the Realtime UPDATE; rollback on RPC error.
- [x] Add a transient "BUZZED!" tone (`pending`) while the RPC is in flight (fires off the pointerdown press).
- [x] Tests: `useBuzzer.test.ts` win/lose/error paths + Realtime overriding a wrong optimistic guess; `TeamGameplayPage.test.tsx` winner/locked-other tone from the RPC alone.

### T2.2 · Instant press-in, eased release `[S]` — `I-PressFeedback` — ✅ PR #160
- [x] `BuzzButton.module.css` + `.btn` (`styles.css`) + `.scoreBtn`: `transition-duration: 0ms` on `:active`/`.pressed`; keep ease on the base rule for release.

### T2.3 · Composite the infinite animations `[S]` — `I-Anim` — ✅ PR #160
- [x] Body `bg-drift`: gated behind `@media (pointer: fine)` (+ `prefers-reduced-motion` already honored globally), so the repaint-heavy `background-position` drift never runs on a phone.
- [x] `BuzzButton` pulse: `::after` ring animated with `transform: scale()` + `opacity` instead of `box-shadow` spread; dropped the team-pill `backdrop-filter`.
- [x] Display timer fill: `transform: scaleX(var(--timer-scale))` + `transform-origin:left` instead of animating `width`.

### T2.4 · No layout shift on buzz `[S]` — `I-NoShift` — ✅ PR #161
- [x] Manager: reserved fixed-height status strip (always mounted during play, visibility/text toggle) — "Waiting for a buzz…" / "<Team> buzzed in — score it:" — so scoring buttons never move. (Kept the "buzzed in" wording so the e2e/unit status assertions stay green.)
- [x] Display: reserve the countdown row's height for the whole playing phase (`.timerSlot`) so the scoreboard stops jumping on the TV.

### T2.5 · Kill the silent dropped-click `[S]` — F-P1-8, F-P2-2 — ✅ PR #162
- [x] `ManagerConsolePage.tsx`: removed the shared `busy` gate from the hot scoring/advance handlers (each keeps its per-action `inFlightRef`); `busy` now gates only End/Bonus.
- [x] Added `pendingContinue` round-scoped flag mirroring `pendingWrong`, included in `continueDisabled`.
- [x] `ManagerConsolePage.test.tsx`: rapid distinct actions (Correct Song then Wrong) both fire; Continue no-flash handoff.

### T2.6 · Smaller smoothness wins `[S]` — ✅ PR #163 (I-NextMeta deferred)
- [x] `I-Admin`: stale-while-revalidate the admin table (dim + `aria-busy`, skeleton only on empty).
- [ ] `I-NextMeta`: **deferred to Phase 3.** `peek_next_song` (mig 029) returns only `{song_id, youtube_id, start_time}` — no title/artist — so rendering the peeked metadata instantly is not frontend-only; it needs the peek RPC to carry the metadata (a DB/RPC change, and Phase 3 is the RPC phase). The frontend-only workaround (an extra `songs` fetch wired into the fragile double-buffer preload path) isn't worth the risk for a ~150ms cosmetic gap.
- [x] "Start game" disabled state: label "Loading player…" while `!player.ready` so it reads as progress (`ManagerConsolePage`).
- [x] Player reconnect copy: "CONNECTING…" vs the wrong "WAITING for the game to start"; "RECONNECTING…" on Realtime drop before the game starts (`I-Reconnect`, shared with Phase 4).

### T2.7 · (optional) BuzzButton render isolation `[M/low]` — `I-TeamRender` — deferred
- [ ] After Phase 3's `I-Buzz1UPDATE` lands, memoize BuzzButton on a narrow `game.status`/lock slice so ROUND_CHANGE events don't re-render it. (Explicitly gated on Phase 3; not in Phase 2 scope.)

---

## Decisions touched
- None. Fully autonomous.

## Exit gate (Phase 2) — ✅ PASSED on prod 2026-07-05
- [x] Lint/typecheck/vitest green; updated buzz + manager tests pass. (frontend suite 367; e2e 28 on the CI local Supabase stack.)
- [x] **Manual phone test:** maintainer confirmed on a real device — BUZZ acknowledges instantly and flips to YOU BUZZED / SOMEONE ELSE from the RPC (not the echo); "buzz is instant, very good".
- [x] Display on a TV: scoreboard doesn't jump when a team buzzes (verified on the display screen: countdown row reserved, scoreboard held); timer bar animates via `scaleX`.
- [x] Rapid distinct manager taps (Correct Song then quickly Wrong) both register — no silent drop (unit-pinned; `busy` gate removed).
- [x] **Full-Game Exit Gate** passed on production: driven three-tab game (create→join→buzz→score→Continue→artist→Next→Bonus→End→export) + maintainer feel-check; Hebrew rendered on all three screens; no app-console errors.
- [x] No regression in the optimistic-toast latency (still zero-perceived-latency clicks).
