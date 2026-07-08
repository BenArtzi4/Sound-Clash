# 02 — Improvements (performance & resilience)

Improvements to *existing* behavior. This is where the north star lives: **fast loads, instant buttons, no lag, no mid-game surprises.** Each item tags its lever — `load` / `smoothness` / `buzz-latency` / `resilience` — and effort (S/M/L). Almost all are low-risk autonomous work.

**Framing reminder:** the `<200ms` buzz number is network+fan-out bound; the items below labeled `load` and `smoothness` are what a user actually *feels* as speed. We ship them as smoothness/load wins, not as "buzzer latency fixes."

> **§A (Load — Phase 1), §B (Smoothness — Phase 2), and §C (Backend-path & Realtime — Phase 3) all shipped and were removed 2026-07-05.** Detail in git history / `CHANGELOG.md`. Section letters below are kept stable (§D, §E) so existing cross-references don't break.
> **Removed 2026-07-07 (verified against code):** I-Resume ✅ shipped (Phase 4 T4.2, PR #187 — `useResumeOnVisible` + `YouTubePlayer.resumeIfPaused()`); I-Reconnect ✅ shipped earlier than planned (PR #163, Phase 2 — `TeamGameplayPage` distinguishes CONNECTING…/RECONNECTING…, closes T4.9); I-Skip ❌ de-scoped (PR #186 — no Skip button, no blocklist; Next round + played-song exclusion already cover dead videos).
> **Removed 2026-07-08:** I-QueueDrain ✅ shipped (Phase 4 T4.3, PR #190 — event gate opens only on a successful snapshot; pending queue capped at 500 with overflow resync).

---

## D. Resilience — mid-game failure modes — Phase 4

Make a real party survive the things that go wrong. (Several of these are also bugs in `01`; here they're framed as the resilience posture.)

- **I-Expiry · Expiry countdown + token-gated extend RPC.** `[M]` `state.game.expires_at` is already synced. Render a subtle countdown that becomes a warning banner in the last ~20 min; add a token-gated `extend_game` RPC that pushes `expires_at` forward. Removes the abrupt 4h party-death. Note `expires_at` counts from *creation*, so lobby time eats into it — factor into the warning.
- **I-GoneDerive · Cascade-ordering guard on the team page.** `[S]` (see F-P1-2) the "gone" derivation from `active_games` is already in `useGameChannel`; what remains is the team-page guard for the teams-deleted-before-game ordering + the T-CascadeTest.
- **I-NextRecover · Revert the double-buffer on Next-round failure.** `[M]` (see F-P1-3) the catch already stops the promoted player and clears the optimistic ref; it still doesn't revert the `activeKey` swap or defer the swap to after the RPC confirms.
- **I-FinalBoard · Host-visible final board that survives the abrupt delete.** `[M]` When a game ends/expires the host loses the live board (`game_history` has no UI). Render the final scoreboard from last-known state (and/or an admin-gated `game_history` read).

## E. Disaster recovery & ops (`resilience`/ops) — remaining

> I-DR (committed catalog dump + CI drift-guard) **shipped** in Phase 1 (`catalog-backup.yml`); removed here.

- **I-Liveness · Proactive dead-YouTube-ID check.** `[M]` Batch-validate `youtube_id`s off-line (oEmbed/Data API) on a schedule; flag dead songs out of the `select_next_song` pool or into a review queue. Stops the steady drip of "video unavailable" mid-party across ~1025 aging videos. (Directly reduces how often F-P1-4's Skip is needed.)
- **I-Alert · Grafana alerts on Realtime connections + message quota.** `[S]` Alert as concurrent Realtime connections approach the ~200 free-tier cap and on monthly message consumption — surfaces both the DoS vector (D-3) and organic overload before players hit "can't subscribe." **Maintainer-only** (needs Grafana dashboard access) — this is the open leftover from Phase 1 T1.7.
- **I-Vitals · Web-Vitals dashboard once Faro sends.** `[S]` `getWebInstrumentations()` already collects vitals; once #145 is fixed, a Grafana dashboard for LCP/TTFB/INP by route makes the load wins measurable.
- **I-BuzzMetric · Server-authoritative buzz-latency metric.** `[M — partial]` A fanout metric now exists (`telemetry.ts` emits `realtime.fanout_ms` from commit_timestamp→local receipt). Still missing: emit `locked_at` so DB-lock latency separates from fanout latency and the buzz span stops conflating RPC + WAL + fanout.
