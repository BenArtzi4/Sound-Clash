# Changelog

All notable user-visible changes to Sound Clash. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project does not currently cut versioned releases; every change lands directly in `main` and ships to `https://soundclash.org` via the deploy hooks. The `[Unreleased]` block below is therefore the canonical "what's currently live" list. Internal refactors, test-only changes, CI tweaks, and doc syncs are deliberately omitted; see `git log` for that level of detail.

## [Unreleased]

### Changed

- 2026-06-16: **Next round now starts almost instantly.** The host console quietly prebuffers the upcoming song in a hidden second YouTube player during the current round, so pressing **Next round** resumes an already-loaded video instead of waiting ~1 second for YouTube to buffer from scratch. The very first song of a game is unchanged; every round after it starts near-immediately.
- 2026-05-31: Soundtrack rounds now reveal the **film/show name** (taken from the song's Artist field) as the answer on the display and manager screens, instead of the song-clip title. This corrects ~28 soundtrack songs whose Title was the track name (e.g. "Hakuna Matata", "He's a Pirate") rather than the work — they now show "The Lion King", "Pirates of the Caribbean", etc. The manager screen additionally shows the clip title as a small hint. The admin Songs form and CSV import follow the same convention: put the film/show name in **Artist**, the clip name in **Title** (set them equal when there's no distinct clip).
- 2026-05-31: The host console now keeps the API warm while a game is running, so **Bonus**, **End game**, **Kick team**, and late team joins stay fast even after long rounds. Previously the backend could idle-sleep mid-game (all gameplay goes straight to the database), making the host's next button press wait several seconds on a cold start.
- 2026-05-30: Re-tuned the playback start time for 588 songs in the catalog so each clip begins on a more recognizable part of the song.
- 2026-05-25: Team buzzer screen is now full-bleed — the BUZZ button reaches every edge of the phone, with the team name + current round shown as a small pill overlay in the top corner. Larger tap target, no chrome competing for the screen.

### Removed

- 2026-05-25: The 10-second post-buzz countdown bar is gone from the team screen. Players watch the display for time; the team's own phone is now just the BUZZ button.

### Fixed

- 2026-05-31: The manager **Bonus** picker now shows each team in its own separated, bordered box (an equal-sized grid of cells) instead of a run of plain names, so the host no longer risks tapping the wrong team and awarding +4 to the wrong side.
- 2026-05-30: Songs in the **Soundtracks** / **Israeli Soundtracks** genres now always play as +15 soundtrack rounds. Soundtrack-ness is derived from genre membership instead of a separate per-song flag, fixing ~28 songs (e.g. Hungry Eyes, Shallow, the Star Wars and Disney themes) that were tagged as soundtracks but still scored as normal title/artist rounds. The admin Songs page drops the "Soundtrack round" checkbox — tagging a soundtrack genre is now the single marker.
- 2026-05-25: Soundtrack rounds no longer auto-resume the song or re-arm the buzzers after the host taps **Correct (+15)**. The round now waits for an explicit **Next round** press, matching how regular rounds behave once both title and artist have been scored.

### Added

- 2026-05-24: How-to-play page now opens with a hero illustration showing the three-screen setup at a glance — host's phone with the manager console, TV/laptop running the display + scoreboard + join QR, and team phones with the BUZZ button — so first-time visitors can see how everything connects before reading the steps.
- 2026-05-24: New **Israeli Soundtracks** genre, separated from the existing soundtrack bucket so hosts can run a Hebrew-only (or English-only) soundtrack round. Six Israeli titles (גבעת חלפון אינה עונה, גברת פלפלת, נילס הולגרסון, הדרדסים, איזה עולם, הפיג'מות) moved into the new genre.
- 2026-05-16: How-to-play page reworked into a numbered seven-step walkthrough (Host a game → genres → Display screen → teams join with QR → start → buzz/judge → optional Bonus) plus a short "Rules & FAQ" section covering the free-guess sweetener, two tokens per song, wrong-buzz-doesn't-lock-you-out, +4 Bonus anytime, and one-phone-per-team reconnect.
- 2026-05-15: Display screen now keeps the join QR (and game code) visible at the bottom of the page for the whole game — late players can scan and join mid-round instead of being locked out the moment the first team appears.
- 2026-05-10: Team's own phone now shows a "+10 / −3" pill the instant their score changes — same look as the projector toast — so a player gets immediate feedback on the device they're already looking at.
- 2026-05-10: Display screen now reveals the song title and artist name in a dedicated panel once the manager confirms the corresponding correct answer. Unrevealed halves show "???" so the audience can see what's still secret. Token chips below still show which team claimed each.
- 2026-05-10: Display screen now pops a small floating pill ("Alpha +10", "Bravo -3") whenever a team's score changes, so the audience watching the projector can see *who* just got points and how many without having to re-read the scoreboard.
- 2026-05-10: New manager Continue button is the explicit "release the buzz lock and resume the song" action. Used after Correct Song / Correct Artist, where the buzz lock now stays on the answering team so they get a free swing at the other token without anyone cutting in.

### Removed

- 2026-05-24: Display screen no longer plays its own synthesized buzz / round-start / score chime, and the "Enable sound" toggle in the header is gone. The YouTube song audio is the only sound on the projector now — one less setup step for the host.

### Changed

- 2026-05-24: Soundtrack songs in the catalog now use a dedicated boolean flag instead of the old free-text `source` column. For soundtracks, the song's title and artist both hold the show / film / game name (so the display reveals the show name once), and the admin Songs page has a "Soundtrack round" checkbox that auto-mirrors the artist field. The bulk-import CSV header is now `title,artist,youtube_id,start_time,is_soundtrack,genres` — soundtrack rows can leave `artist` blank and the importer fills it from `title`. Existing soundtrack rows had their title/artist overwritten with the show name as part of the migration.
- 2026-05-24: Manager Bonus picker no longer pushes the Continue / Next-round row down when it opens, so the host's next tap can't accidentally land on a team button. Also disabled the iOS double-tap-zoom delay on every button (not just the BUZZ button).
- 2026-05-24: Renamed the **Soundtrack** genre to **Soundtracks** (plural) to match the new Israeli Soundtracks sibling. The admin Songs page's auto-tag-on-save behaviour now routes Hebrew-language sources to Israeli Soundtracks and everything else to Soundtracks.
- 2026-05-24: Soundtrack rounds now play differently. When the current song has a `source` set, the manager and display screens show a 🎬 **Soundtrack** badge, and the manager's two scoring buttons collapse to a single **Correct (+15)** button — the team only has to name the work (film / TV / game / musical), and a correct call awards 15 points instead of the usual 10/5 title-vs-artist split. Wrong (−3) still applies. Correct (+15) also releases the buzz lock and resumes playback immediately, so the host can press Next round in one tap (no separate Continue, since both tokens land together). The display screen reveals "Title" + "from <source>" once the manager confirms.
- 2026-05-24: Admin Songs page no longer has a separate "Mark as soundtrack" checkbox. The **Source** field is now the single soundtrack marker — setting it auto-tags the song with the Soundtrack genre on save, and the gameplay 15-pt rule fires off the same field.
- 2026-05-23: Admin Songs page now shows two extra columns at a glance — **Start time** (seconds, or `—` when 0) and **Genres** (chips, including "Soundtrack" when the song is flagged as one even if it's not tagged with the Soundtrack genre). The edit form also now preselects the song's current genres so the operator doesn't have to re-check them on every edit.
- 2026-05-23: Team BUZZ button is now a full-screen rounded rectangle and fires the instant a finger touches it (not on tap-release), so fast presses and finger-slides no longer fail to register. Also disables the iOS double-tap-zoom delay.
- 2026-05-16: Manager "Next round" / "Start game" buttons are now noticeably faster. The browser calls Postgres directly (same pattern as the buzzer and the scoring buttons) instead of going through the Render-hosted backend, and what used to be two chained transatlantic API hops collapses to a single round-trip. Perceived end-to-end latency drops from ~500-900ms (with up to a 30s spike on a cold Render dyno) to ~150ms; with the optimistic "Loading next round..." toast the click-to-feedback gap is effectively immediate.
- 2026-05-16: Manager Continue / End game / Next round buttons now show their confirmation toast the instant the button is pressed, instead of after the network round-trip — the click feels immediate even on a slow connection. Browser also pre-warms the YouTube connection at app load so the first song's player mounts faster.
- 2026-05-16: Manager Correct Song / Correct Artist / Wrong / Continue now feel snappy. They call Postgres directly (same pattern as the buzzer) instead of going through the Render-hosted backend, so the click no longer waits on a transatlantic API hop. Perceived end-to-end latency drops from ~400-600ms (with up to a 30s spike on a cold Render dyno) to ~150ms; the optimistic "+10 to <team>" toast appears the moment the button is pressed.
- 2026-05-16: Manager console: song title and artist now sit above the token-state chips on their own line, and the "Round controls" heading was removed. Easier to read on phones.
- 2026-05-15: Manager Continue / Next-round buttons now match the size and grid of the four scoring buttons above them — equal-width 2-column row instead of right-aligned text buttons — so the round-controls block reads as one coherent surface.
- 2026-05-15: Home page button copy: "Join as Team" → "Join a game" (mirrors "Host a game"), and "Display Screen" → "Display screen" so all three role buttons share the same sentence case.
- 2026-05-15: Manager Bonus button now feels instant: the team picker closes and the "+4 bonus to <team>" toast appears the moment a team is clicked. The score still arrives on the display via Realtime as before; the manager just isn't waiting on the round-trip anymore.
- 2026-05-15: Manager YouTube player no longer overlays loading / "Song ended" / "Video unavailable" covers on the iframe — the raw YouTube player is visible the whole game. Errors are surfaced as a toast instead so the host knows to pick a different song.
- 2026-05-15: Manager End-Game button moved from the top header to a footer at the bottom of the page. It's a once-per-game action; no need for it to compete with round controls.
- 2026-05-15: Cut per-client REST traffic during a game by ~4x. The Realtime backstop that re-fetches game / teams / rounds rows now runs every 20s instead of every 5s; a 10-round game drops from ~360 backstop requests to ~90. A missed Realtime event still self-heals well inside any "huh, the page is stuck" wait.
- 2026-05-12: When the host marks a Correct Song / Correct Artist, the buzzed team keeps control of the round for the other token (as before) **and** its 10-second answer countdown restarts — so the team that got one half right gets a fresh window to also guess the missing half.
- 2026-05-12: The manager's Wrong button now also resumes the song immediately (in addition to re-arming the buzzers) — no separate Continue round press needed to un-pause playback.
- 2026-05-12: The BUZZ button on the team (player) screen is bigger — it now fills most of a phone screen.
- 2026-05-10: Manager Correct Song / Correct Artist buttons now apply their score the moment they're clicked — no second Continue press needed. The buzz lock stays held on the answering team until the manager presses Continue (which also resumes the song) or Wrong (which immediately re-arms the buzzers).
- 2026-05-10: Team-page score pill no longer prefixes the team name. A player on their own phone now sees just `+10` / `-3` instead of `<team-name> +10`. The shared display screen still shows the team name in its score pill since multiple deltas can stack there.
- 2026-05-10: Display screen waiting view (QR code + team list) is bigger on desktop — larger QR, taller team rows, larger scores — so a TV-mounted display is readable from across the room.
- 2026-05-10: Manager round-control bar (Continue / Next round) now sits inline below the four scoring buttons on every viewport. The mobile sticky bottom bar is gone; the inline buttons stack vertically on phones.
- 2026-05-10: Manager round chips now read `Song ✓` / `Artist ✓` without naming which team claimed each token. The host doesn't need that bookkeeping mid-round; the display screen still surfaces it for the audience.
- 2026-05-10: Bonus button on the manager screen is amber-tinted by default (not white) so it reads as the always-on action even when the buzz-dependent buttons next to it are greyed out. It also remains enabled before any team has joined — the picker just opens to an empty list.
- 2026-05-10: Manager Wrong button is now a one-click verdict: pressing Wrong fires the score immediately and re-arms the buzzers (no separate Continue Round press).
- 2026-05-10: Wrong buzz waives the −3 penalty when the round already has a correct answer recorded ("free guess" sweetener). Round-wide and one-shot: the next attempt after a correct is free, then normal scoring resumes. Rewards teams who got one half of the song right.
- 2026-05-10: Rounds now allow multiple buzzes on the same song. The +10 Title token and +5 Artist token are claimed independently — Team A can take Title, Team B can take Artist, all on the same song. A wrong buzz still costs −3 (unless the free-guess rule above applies) but no longer locks the team out: the same team can buzz again. The manager has a new "Continue round" button (re-arm buzzers, same song) alongside "Next round" (advance song). Display screens show small chips for each token's claim state.
- 2026-05-10: Team buzzer page is now a single-purpose surface: just team name, round pill, and the buzz button. Status banner ("Waiting for the host…", "Buzz when you know it!", "{team} locked it.", "You buzzed in!"), the "Connected" pill, the game code, and the secondary scoreboard are all removed - the buzz button's own colour and label communicate the round state.
- 2026-05-10: The "You buzzed" buzz button is now blue (was amber) so the colour no longer reads as a yellow "warning / waiting" cue.
- 2026-05-10: BUZZ button copy slimmed down: idle reads just "BUZZ" (no subtitle), waiting reads "WAITING / for the game to start", you-buzzed reads just "YOU BUZZED".
- 2026-05-10: End-of-game podium heights are now strictly ordered 1st > 2nd > 3rd in pixel height, so when 1st place has one team but 2nd holds two tied teams the gold card still visibly outranks silver.

### Removed

- 2026-05-24: Songs no longer carry a separate `is_soundtrack` boolean. The same information is now derived from the `source` field (set → soundtrack round). Existing songs that had the flag but no Soundtrack genre tag get the tag added automatically by the migration. CSV bulk-import format drops the `is_soundtrack` column; old CSVs that still include it are accepted (the column is ignored).
- 2026-05-23: Dropped five unused genres from the catalog (Classical, Country, Jazz, Metal, R&B). They were seeded but never had songs attached, so the host's "Pick genres" picker and the admin filter no longer offer them. The remaining ten genres cover everything in the catalog.
- 2026-05-16: Retired the legacy `POST /games/{code}/select-song` and `POST /games/{code}/end-round` REST endpoints, the Python song-picker service, and the un-tokenised legacy overloads of `award_attempt` / `release_buzz_lock` in the database. None of these had a caller in the running stack after the direct-RPC migrations (021, 022) stabilised. No user-visible behaviour change; the cleanup is dead-code hygiene.
- 2026-05-10: One-buzz-per-round model is gone, along with the `/award-points` endpoint. Replaced by the multi-buzz model with `/attempt` (per-buzz scoring) + `/end-round` (close the round explicitly).
- 2026-05-10: Removed the "Home" and "Restart song" buttons from the manager console. The header trims to just "End game"; the round-controls toolbar trims to "End round" + "Next round" / "Start game".

### Fixed

- 2026-05-19: Final Results page now lists every team individually in a "Full scoreboard" section below the podium. Previously, when two teams tied on a score (e.g. two teams that never buzzed both finished at 0), they shared a podium card and the trailing rank's slot rendered as an invisible placeholder — making it look like a team had been dropped. The scoreboard shows each team with its dense rank (tied teams share a rank, next rank is +1), so no team can ever be hidden.
- 2026-05-17: Manager Wrong button is no longer stuck disabled after the first wrong-buzz of a round. In a multi-buzz round (team A wrong → team B buzzes → host wants to mark wrong again), the second Wrong press was being silently swallowed because the previous click's "just-pressed" marker stayed set until the round changed. Fix: the marker now clears the moment the buzz lock releases, so the next buzzer's Wrong press registers normally.
- 2026-05-17: Manager scoring buttons (Correct Song / Correct Artist / Wrong) no longer "double flash" after a click — they used to go disabled → enabled → disabled in the gap between the RPC returning and the Realtime update landing. They now stay disabled cleanly from the moment of the click until the round changes. Continue round and Next round buttons also no longer go disabled when pressed; they keep their natural press effect and only disable when the underlying state actually changes (buzz lock cleared / player loading).
- 2026-05-15: Manager YouTube player no longer gets stuck showing "Video unavailable" on every subsequent song after a single failed video. The error state now clears whenever a new song is loaded, so a transient YouTube hiccup on round 1 no longer breaks rounds 2-N.
- 2026-05-15: Reduced per-second re-rendering on the team and display screens during a buzz. The round countdown now ticks in its own small component so the surrounding scoreboard, buzz button, and YouTube player don't re-render every second — smoother gameplay on lower-end phones and TVs.
- 2026-05-12: Song selection now mixes the selected genres evenly. Each round picks a random genre among those chosen, then a random unplayed song within it, so a game with several genres no longer front-loads whichever genre happens to have the most songs in the catalog.
- 2026-05-12: The host's Correct Song / Correct Artist buttons no longer go inactive a moment after a click — the answering team keeps control of the round for the other token until the host presses Continue round or Wrong.
- 2026-05-10: Manager YouTube player no longer overlays a black "Ready" splash when a team buzzes. The cover that hides the iframe still appears (so YouTube's pause-state "more videos" tiles can't leak song titles), but it stays empty rather than re-using the pre-load loading text.
- 2026-05-10: Quieter YouTube embed; switched to youtube-nocookie host to stop ad-tracking CORS errors (and reduce the IFrame API's postMessage warm-up warning) in the browser console while a game runs.
- 2026-05-09: When a team buzzes, the manager's YouTube player no longer flashes the paused-state "more videos" tiles (which can include other songs in the same artist's channel and spoil future rounds). A blank cover stays on top of the iframe whenever a buzz is being scored.
- 2026-05-09: Manager scoring buttons no longer act as a footgun after a round was already scored. `End round` and `Restart song` are now disabled once the current round has an `ended_at`, so a second click can't fire a `round_already_ended` error toast - the host's only enabled action is `Next round`.
- 2026-05-09: YouTube embed chrome (player labels, captions) is forced to English regardless of the host's browser/IP locale, so a host on a Hebrew-locale browser no longer sees Hebrew controls bleeding through the iframe overlay.
- 2026-05-09: Refreshing the manager tab mid-round no longer drops the host into a "No round started yet" view. The current song is now re-fetched from the round row and pushed back into the YouTube player so the host can keep scoring the buzz instead of being forced to start over with Next round.
- 2026-05-09: When a song plays through to its natural end, the manager (and any other YouTube view) no longer leaks YouTube's endscreen tiles, which could include other tracks from the same artist's channel and spoil future rounds. The player now stops playback on `ENDED` and re-shows the "Song ended" cover.
- 2026-05-09: YouTube player on the manager screen no longer fails with error 153 / "video player settings" - the embed iframe was being rebuilt every render with no video ID and bombarding the YouTube CDN (~10 req/s, hundreds of MB/min). Stabilised the player's mount effect so it initializes once per page lifetime.
- 2026-05-09: Sentry error reporting works again on production. The deployed CSP `connect-src` listed `o*.ingest.sentry.io` (mid-host wildcard, invalid per CSP spec), which Chrome rejected, generating thousands of `'<URL>' will be ignored` console errors and silently blocking Sentry traffic. Wildcards moved to the leftmost label.
- 2026-05-07: `/award-points` no longer 500s on prod. The PR-#38 deploy regressed `_award_blocking` by assuming `supabase-py.rpc().data` was always a dict; real PostgREST returns a list of row-dicts for TABLE-returning functions. (PR #40)

### Changed

- 2026-05-09: Team buzzer now shows four explicit status modes with matching colors: grey **Waiting** before the host starts the round, green **Playing** when the song is live, gold **You Buzzed** when this team is locked in awaiting adjudication, red **Someone else buzzed** when another team got there first. Replaces the old single-label BUZZ / LOCKED button.
- 2026-05-09: Team page now shows the same celebratory "FINAL RESULTS" podium (with confetti, trophy, WINNER label) that the display and manager already show, instead of a small "Game over." banner with a still-rendered (disabled) BUZZ button.
- 2026-05-09: Round timer reworked. There is no longer a 20-second pre-buzz countdown. Instead, when a team buzzes, a 10-second countdown starts on the team and display screens so the buzzed team has a clear answer window. The manager screen no longer shows the timer.
- 2026-05-07: Repo README pivots to a player-facing pitch with a "Play it at https://soundclash.org" CTA. The developer "Quick start" is removed; the repo is a public showcase, not soliciting external PRs. (PR #41)
- 2026-05-07: Trimmed the home page intro and moved "How to Play" to its own `/how-to-play` page (with roles, game flow, and scoring sections). The home page now shows only the title, tagline, three role cards, and a small "How to Play" link.
- 2026-05-07: Bumped role-card and hero font sizes on the home page so the three role CTAs (Host / Join / Display) read as primary actions; smaller copy bumps on the How-to-Play page.
- 2026-05-07: Team page (player's phone) now shows a "Round N" pill in the header and highlights the player's own row in the scoreboard with a "you" tag.
- 2026-05-07: Display screen empty state now shows a scannable QR code so players can join without typing the 6-letter code; the round number stays visible on screen even when a team buzzes in.

### Removed

- 2026-05-09: Removed the duplicate scoreboard and teams list from the manager console. Both already render on the Display screen (the projector view), and the host's screen now focuses purely on round controls.
- 2026-05-09: Removed the "Invite players" QR/URL panel from the manager console - the game code is already prominent in the header and on the empty-teams hint, so the second copy was clutter.
- 2026-05-09: Removed the per-team "Kick" button from the manager console. To get rid of a team, the host can end the game and start a fresh one.
- 2026-05-07: Removed the "Rounds" picker from the Create-Game form. Games now run for as many rounds as the host wants and end only when the host clicks "End game"; round counters across the team page, display, and manager console show "Round N" without a denominator.

### Security

- 2026-05-12: Hardened the database so the host-only round actions (scoring a buzz, awarding a bonus, starting/ending a round, ending the game) can only be performed through the backend's manager-token gate — they can no longer be invoked directly with the public anon key. (`buzz_in`, the team buzzer, is unchanged.)

## 2026-05-07: Phase 7 cutover

`https://soundclash.org` cut over from the legacy AWS stack to the new free-tier Supabase + Render + Cloudflare Pages stack. AWS resources torn down; bill drops to $0/month. See `docs/roadmap.md` §7.

### Added

- Manager game-end polish: restart-song button, tied-winner end screen, automatic transition to the end screen after the final round. (`f6ccf34`)
- `/admin/songs` UI page for song catalog CRUD. (`acce6d4`)
- Two new genre seeds for Hebrew-speaking audiences: Israeli and Mizrahit. (`4728815`)
- A11y polish on the frontend: focus indicators, contrast tweaks, screen-reader live regions on the scoreboard. (`b1378ad`)

### Changed

- **Scoring revamp.** Replaced the old (title=10, artist=5, source=5, timeout=−2) checkbox UI with four toggle buttons: **Correct Song +10**, **Correct Artist +5**, **Wrong −3** (mutually exclusive with the positives), **Bonus +4** (host-discretion award to any team at any time). Source/soundtrack-only scoring and the timeout penalty are gone. (`8eb0cef`, migration `014_scoring_revamp.sql`)
- **Open hosting.** Anyone can host a game without a password. The "manager login" was replaced with a per-game `manager_token` (uuid) that the host's browser stores in `localStorage` and presents as `X-Manager-Token` on host-only endpoints. The single env-var `ADMIN_PASSWORD` now gates only the durable song catalog (`/admin/songs/*`). (`2a71aaa`, migration `012_manager_token.sql`)

### Removed

- Manager login screen. The whole `/manager/login` route + `RequireAuth` gate are gone. (`2a71aaa`)
- The legacy AWS-based stack (CloudFront, ECR repos, S3 buckets, ACM cert, CloudWatch logs). Replaced by the free-tier stack.
