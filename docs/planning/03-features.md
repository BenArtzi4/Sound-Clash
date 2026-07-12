# 03 — Features (new capabilities)

New things a host/player/display can do, ranked by **party-night impact ÷ build cost** on this exact architecture (direct-RPC + Realtime + free tiers, no accounts). Each maps concretely onto the existing schema/RPC/Realtime patterns. Effort S/M/L; impact high/med/low. Big/strategic ones are cross-referenced to [05-decisions-needed.md](05-decisions-needed.md).

Tiers below are the recommended build order once Phases 1–4 (perf + resilience) are in.

---

## Tier 1 — High impact, cheap, frontend-mostly (ship first)

- **X-SFX · Sound effects on the display (buzz / correct / wrong).** `[S, high]` The TV is the room's shared speaker but is silent between clips. DisplayPage already detects the exact events — `buzzed_team_id` going non-null (`:162`) and per-team score deltas (`:115`). Add short buzzer/ding/fail cues. **Binary-asset decision** (short audio files) — needs your sign-off on where they live per repo rules. Big crowd-energy lift for near-zero code. **→ [issue #244](https://github.com/BenArtzi4/Sound-Clash/issues/244)** (not started; must not slow the buzz — display-only).
- **X-Presets · One-tap curated presets on the create screen.** `[S, high]` Hosts hand-pick genres+decades every game. A preset row — "80s Party", "Israeli Classics", "Movie Night", "Everything" — is frontend-only: a hardcoded `{label, genreSlugs[], decades[]}` list resolved against already-loaded genres. Speeds setup, drives replay. ✅ **SHIPPED live on prod (PR #241, 2026-07-11).**
- ~~**X-Skip · Host "Skip song" button.**~~ **Declined 2026-07-07 (Phase 4 T4.1, PR #186).** The existing **Next round** button already moves past a dead/boring song, the persistent "Video unavailable" state ships, and select/peek exclude already-played songs, so the blocklist is redundant. Don't rebuild this; revisit only if a real re-pick of an errored video is ever observed.
- **X-AutoRelease · Auto lock-release when the answer countdown expires.** `[S, high]` The display already shows a 10s answer countdown (`ANSWER_DURATION_SEC`) with no teeth. When `locked_at + 10s` elapses with no verdict, auto-fire `release_buzz_lock` to re-arm buzzers. Keeps rounds moving without host babysitting. (Make it an opt-in host toggle so it doesn't surprise.) ❌ **VETOED by maintainer ("don't do it") — dropped.**
- **X-DarkRoom · Dark-room projector theme for the display.** `[S, medium]` Parties are dim; the display is on a TV. A high-contrast oversized "dark room" theme (near-black bg, glowing large scores) as a toggle or via `prefers-color-scheme`. Frontend-only CSS variant. **→ [issue #243](https://github.com/BenArtzi4/Sound-Clash/issues/243)** (not started; deferred this session).

## Tier 2 — High/medium impact, medium build

- **X-Recovery · Host recovery link/QR in the console.** `[M, high]` (fixes F-P1-6) A re-openable host URL/QR embedding the `manager_token`, so a host whose localStorage is wiped re-authenticates from the same or another device. Removes the single-point-of-failure that can orphan a whole game. ✅ **SHIPPED** (`HostRecoveryLink.tsx` on the manager console; closes F-P1-6).
- **X-Extend · Token-gated "extend game" + expiry countdown.** ✅ shipped 2026-07-09 (PR #195, T4.8 — see I-Expiry in `02-improvements.md`).
- **X-Recap · Shareable post-game recap card (PNG).** `[M, medium]` SongExport already gives an HTML list + YouTube playlist; nothing is shareable to a group chat. A canvas/SVG recap card on the end screen — podium, winner, round count, top songs — styled like the existing OG link-preview card (`tools/og-image`), downloadable/shareable. Drives organic reach. **→ [issue #245](https://github.com/BenArtzi4/Sound-Clash/issues/245)** (not started).
- **X-Practice · Practice / solo single-device mode.** `[M, medium]` No way to warm up before guests arrive. A single-device mode reusing the player + peek/select flow with zero teams and no buzzers (a zero-team game already starts rounds): the host flips songs and self-reveals. Low-risk, reuses existing machinery. ❌ **VETOED by maintainer ("don't do it") — dropped.**
- **X-Reclaim · Per-team reclaim token.** **D-4 declined the *player-held* token version** (a secret threaded through every player device); that stays declined. Two paths shipped instead: (1) the lightweight **same-name reclaim** (Phase 5 T5.7): `join_team` returns the existing team row when the same name rejoins the same game, so a refreshed/evicted player re-attaches without a token — kept fully open, consistent with the buzz-spoofing tradeoff; and (2) a **host-only** secure reconnect (issue #183): ✅ **SHIPPED** — a per-team `rejoin_token` in the anon-invisible `team_secrets` table (mig 046, mirrors `game_secrets`), disclosed only to the authenticated host via the manager-token-gated `GET /games/{code}/teams/{id}/rejoin-token`, shown as a "Reconnect a team" QR (`…/join/<code>#rt=<token>`) the player scans to rejoin their exact row with preserved score. No player-held secret, no SECURITY DEFINER RPC (rejoin is a FastAPI endpoint off the buzzer hot path), so D-4's posture is unchanged.

## Tier 3 — Medium impact, involves the DB / additive migration

- **X-Streaks · Team streak "on fire" badge.** `[M, medium]` `game_round_attempts` already records every buzz outcome per team but the frontend never subscribes it. Add it as a 4th `postgres_changes` stream, derive consecutive-correct streaks, show a flame badge on the display. (Note: this re-introduces a subscriber for `game_round_attempts` — do it deliberately *after* I-AttemptsPub. Migration 037 removed the table from the `supabase_realtime` publication and RLS-locked it (analytics-only, zero subscribers); this feature must re-add it to the publication **and** grant/loosen anon read via a new migration, as a deliberate part of the work.) ❌ **VETOED by maintainer ("don't do it") — dropped.**
- **X-GenreSpotlight · Per-round genre spotlight (+ optional roulette).** `[M, medium]` `select_next_song` already picks a random genre then song but discards which genre. Add the chosen genre name/slug to the `RETURNS TABLE` (purely additive `CREATE OR REPLACE`, PostgREST routing unchanged) so the display can announce "This round: 80s Rock." Roulette mode is a fun UI layer on top. **→ [issue #246](https://github.com/BenArtzi4/Sound-Clash/issues/246)** (not started; value case "why is it good?" owed before building — it's a DB migration).

## Tier 4 — Strategic — OUT OF SCOPE for now (resolved 2026-07-04)

These were deferred per the maintainer's call; kept here so the rationale isn't lost when they're revisited.

- ~~**X-Win · Win conditions (target-score / round-limit).**~~ **D-5: out of scope for now.** Would be an optional additive setting (nullable `win_target_score`/`win_round_limit` mirroring `selected_decades`, mig 032), default off. Revisit later.
- ~~**X-i18n · Hebrew (RTL) UI.**~~ **D-6: out of scope for now.** ~Half the catalog is Hebrew and the audience is largely Israeli, but a full RTL UI touches all six pages + a translation workflow. Revisit if growing the Hebrew audience becomes a goal.

---

## Content (maintainer-led, not a phase task)

- **C-Catalog · Finish the song-curation batch: Hebrew + soundtrack genres.** The global-genre expansion shipped; Hebrew and soundtrack genres still need their ~25 net-new songs/genre pass. Runbook: `tools/song-curation/PLAYBOOK.md`. The maintainer has **uncommitted in-flight tooling work** there (adding per-song `release_year` capture to review.js/verify.py + a new add-songs.html) — agents must not touch those files; the maintainer lands them when ready. Tracked here so the work is visible in the plan; previously it lived only in the tool's own playbook.

## Notes for whoever builds these
- Anything storing new durable data (recap assets, sound files, team tokens) must respect the ephemerality model and the binary-asset rule (ask before committing audio/images).
- Additive RPC columns via `CREATE OR REPLACE` keep PostgREST routing stable — prefer that over new function signatures (see the mig-021 overload lesson in `.claude/rules/lessons-learned.md`).
- Every feature ships with a CHANGELOG entry and a test at the right layer, and passes the Full-Game Exit Gate.
