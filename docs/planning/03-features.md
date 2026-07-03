# 03 — Features (new capabilities)

New things a host/player/display can do, ranked by **party-night impact ÷ build cost** on this exact architecture (direct-RPC + Realtime + free tiers, no accounts). Each maps concretely onto the existing schema/RPC/Realtime patterns. Effort S/M/L; impact high/med/low. Big/strategic ones are cross-referenced to [05-decisions-needed.md](05-decisions-needed.md).

Tiers below are the recommended build order once Phases 1–4 (perf + resilience) are in.

---

## Tier 1 — High impact, cheap, frontend-mostly (ship first)

- **X-SFX · Sound effects on the display (buzz / correct / wrong).** `[S, high]` The TV is the room's shared speaker but is silent between clips. DisplayPage already detects the exact events — `buzzed_team_id` going non-null (`:162`) and per-team score deltas (`:115`). Add short buzzer/ding/fail cues. **Binary-asset decision** (short audio files) — needs your sign-off on where they live per repo rules. Big crowd-energy lift for near-zero code.
- **X-Presets · One-tap curated presets on the create screen.** `[S, high]` Hosts hand-pick genres+decades every game. A preset row — "80s Party", "Israeli Classics", "Movie Night", "Everything" — is frontend-only: a hardcoded `{label, genreSlugs[], decades[]}` list resolved against already-loaded genres. Speeds setup, drives replay.
- **X-Skip · Host "Skip song" button.** `[S, high]` Also the fix for dead videos (F-P1-4). A one-tap skip that advances to a fresh pick without the current song counting — invaluable when a video is broken, boring, or too obscure. Reuses `select_next_song`; blocklist the skipped id for the game.
- **X-AutoRelease · Auto lock-release when the answer countdown expires.** `[S, high]` The display already shows a 10s answer countdown (`ANSWER_DURATION_SEC`) with no teeth. When `locked_at + 10s` elapses with no verdict, auto-fire `release_buzz_lock` to re-arm buzzers. Keeps rounds moving without host babysitting. (Make it an opt-in host toggle so it doesn't surprise.)
- **X-DarkRoom · Dark-room projector theme for the display.** `[S, medium]` Parties are dim; the display is on a TV. A high-contrast oversized "dark room" theme (near-black bg, glowing large scores) as a toggle or via `prefers-color-scheme`. Frontend-only CSS variant.

## Tier 2 — High/medium impact, medium build

- **X-Recovery · Host recovery link/QR in the console.** `[M, high]` (fixes F-P1-6) A re-openable host URL/QR embedding the `manager_token`, so a host whose localStorage is wiped re-authenticates from the same or another device. Removes the single-point-of-failure that can orphan a whole game.
- **X-Extend · Token-gated "extend game" + expiry countdown.** `[M, high]` (see I-Expiry) new RPC bumping `expires_at`; the biggest resilience+feature two-fer for long parties.
- **X-Recap · Shareable post-game recap card (PNG).** `[M, medium]` SongExport already gives an HTML list + YouTube playlist; nothing is shareable to a group chat. A canvas/SVG recap card on the end screen — podium, winner, round count, top songs — styled like the existing OG link-preview card (`tools/og-image`), downloadable/shareable. Drives organic reach.
- **X-Practice · Practice / solo single-device mode.** `[M, medium]` No way to warm up before guests arrive. A single-device mode reusing the player + peek/select flow with zero teams and no buzzers (a zero-team game already starts rounds): the host flips songs and self-reveals. Low-risk, reuses existing machinery.
- **X-Reclaim · Per-team reclaim token.** `[M, medium]` (fixes F-P2-1) Mirror `manager_token` for teams: join returns a team token; a refreshed/evicted player re-attaches instead of 409-ing. Keeps a team's score alive across eviction/device-swap. **Touches the join contract — coordinate with D-4** (per-team secret also closes the buzz-spoofing hole, so build them together).

## Tier 3 — Medium impact, involves the DB / additive migration

- **X-Streaks · Team streak "on fire" badge.** `[M, medium]` `game_round_attempts` already records every buzz outcome per team but the frontend never subscribes it. Add it as a 4th `postgres_changes` stream, derive consecutive-correct streaks, show a flame badge on the display. (Note: this re-introduces a subscriber for `game_round_attempts` — do it deliberately *after* I-AttemptsPub, re-adding the table to the publication as part of this feature.)
- **X-GenreSpotlight · Per-round genre spotlight (+ optional roulette).** `[M, medium]` `select_next_song` already picks a random genre then song but discards which genre. Add the chosen genre name/slug to the `RETURNS TABLE` (purely additive `CREATE OR REPLACE`, PostgREST routing unchanged) so the display can announce "This round: 80s Rock." Roulette mode is a fun UI layer on top.

## Tier 4 — Strategic (decisions, not quick wins) — see `05`

- **X-Win · Win conditions (target-score / round-limit with auto-end).** `[M, high — DECISION D-5]` Games have no finish line (`total_rounds` was dropped in mig 015). Optional win conditions set at create, mirroring the `selected_decades` additive pattern (mig 032): nullable `win_target_score` / `win_round_limit`; `select_next_song` (or a client check) ends the game when hit. **Game-rule change → decide first.**
- **X-i18n · Hebrew (RTL) UI.** `[L, high — DECISION D-6]` ~half the catalog is Hebrew and the core audience is Israeli, yet the UI is English-only (roadmap lists i18n out-of-scope). A Hebrew RTL UI would widen the audience but touches all six pages, needs an RTL layout pass, and a translation workflow. **Strategic call.**

---

## Notes for whoever builds these
- Anything storing new durable data (recap assets, sound files, team tokens) must respect the ephemerality model and the binary-asset rule (ask before committing audio/images).
- Additive RPC columns via `CREATE OR REPLACE` keep PostgREST routing stable — prefer that over new function signatures (see the mig-021 overload lesson in `.claude/rules/lessons-learned.md`).
- Every feature ships with a CHANGELOG entry and a test at the right layer, and passes the Full-Game Exit Gate.
