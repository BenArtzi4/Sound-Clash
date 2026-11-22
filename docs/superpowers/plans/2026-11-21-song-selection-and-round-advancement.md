# Song selection and round advancement implementation plan

> For implementation, follow the Superpowers executing-plans workflow and verify each behavior against the existing game.

**Goal** Improve variation and genre balance, reject stale automatic round commits, and measure song-start latency.

**Architecture** Keep the picker and the round commit in Postgres and retain direct manager RPCs. Use the existing browser peek to start playback inside the host’s tap.

**Scope** The decisions below apply to the behavior requested in issue #424 and the follow-up approval. Every new game starts with a fresh eligible pool.

## 1. Genre balance and random selection

- [x] Add database regression cases for multi-tag overshoot, a smaller cover share, consecutive songs from the same genre, catalog filters and pool exhaustion. Verify the new behavior fails against migration 055.
- [x] In migration 056, update `pick_next_song` using the existing eligible song and history sets. Calculate projected spread once per distinct selected-genre tag set. Credit all selected tags and compare genres that would retain eligible songs after the draw. Allow a spread of two, or use the smallest achievable spread when a game is already outside that range.
- [x] Give `israeli-cover` a half-rate target in a mix by counting each of its plays as two balance units and drawing it at half the weight of a typical genre. When it is the only viable genre, draw normally. Replace hard genre exclusion with a half-weight for genres heard on the previous round. Drop the song-level penalty for sharing a genre with the previous round. Preserve the existing artist cooldown and weighted draw.
- [x] Verify the targeted database suite, then compare warmed picker timings with the existing function across single-genre, mixed and long-game pools. Replay the four-team, 20-round browser scenario.

## 2. Round-safe peek and commit

- [x] Add database tests for exact peek commits, stale and concurrent commits, filtered-out, unavailable and played candidates, exhaustion, wrong token and legacy compatibility. Add manager tests for an advance while another host is on the same turn and for a delayed Realtime update.
- [x] In migration 057, return `expected_round` with `peek_next_song` and add a four-argument `select_next_song` signature. Serialize advances using a per-game transaction advisory lock to keep the scoring lock order, validate the expected round and automatic candidate, and share the write with the existing three-argument signature. Preserve the three-argument explicit override for older clients.
- [x] Pass the expected round from the manager. Keep the synchronous player load from a peek. On a rejected stale candidate, clear it and reconcile the confirmed round without automatically advancing again. Scope candidates to one game and replace expired in-flight peeks.
- [x] Run the database and manager tests, then repeat the four-team browser scenario and the scoring and recovery specs. Confirm each archived song is unique.

## 3. Latency telemetry and final validation

- [x] Add trace tests for peeked and fallback clicks, both orderings of RPC and player completion, timeout and failure.
- [x] Record parallel RPC and YouTube load durations in the existing song-start span. Keep the serial wait span for the fallback path and tag traces with the pick path. Reuse existing telemetry and add no network request to the click path. Use the measured click-to-audio attribute for the existing Grafana panel.
- [x] Update game rules, RPC and schema documentation. Apply the migrations twice locally. Run the focused and full local checks, compare picker latency, and repeat the four-team browser scenario plus the scoring, video and recovery specs.

## Verification

- The four-team, 20-round Chromium playthrough passed after the picker change, after the round guard, and after the telemetry and review fixes. The expanded playthrough verified distinct archived song and video IDs, scoring, Wrong including the free guess, Continue, Bonus, skip, podium and final totals.
- All 48 Chromium cases passed across the full run and targeted reruns. Host recovery passed on retry. Its YouTube iframe readiness timeout also reproduced on unchanged main. The local PostgREST pool recovered after recycling its aborted connection before the rejoin and larger-game reruns.
- 977 frontend tests and 497 backend and database tests passed. Lint, type checking, production build, migration replay and the local Supabase cron registration passed.
- On a local database with 1,715 songs, median SQL time for a peeked commit was 1.10 ms before and 1.24 ms after. The fallback median was 10.90 ms before and 12.60 ms after. The fallback p95 was 18.44 ms before and 25.33 ms after. These timings exclude browser playback and production network latency.
