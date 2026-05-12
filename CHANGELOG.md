# Changelog

All notable user-visible changes to Sound Clash. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project does not currently cut versioned releases; every change lands directly in `main` and ships to `https://soundclash.org` via the deploy hooks. The `[Unreleased]` block below is therefore the canonical "what's currently live" list. Internal refactors, test-only changes, CI tweaks, and doc syncs are deliberately omitted; see `git log` for that level of detail.

## [Unreleased]

### Added

- 2026-05-10: Team's own phone now shows a "+10 / −3" pill the instant their score changes — same look as the projector toast — so a player gets immediate feedback on the device they're already looking at.
- 2026-05-10: Display screen now reveals the song title and artist name in a dedicated panel once the manager confirms the corresponding correct answer. Unrevealed halves show "???" so the audience can see what's still secret. Token chips below still show which team claimed each.
- 2026-05-10: Display screen now pops a small floating pill ("Alpha +10", "Bravo -3") whenever a team's score changes, so the audience watching the projector can see *who* just got points and how many without having to re-read the scoreboard.
- 2026-05-10: New manager Continue button is the explicit "release the buzz lock and resume the song" action. Used after Correct Song / Correct Artist, where the buzz lock now stays on the answering team so they get a free swing at the other token without anyone cutting in.

### Changed

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

- 2026-05-10: One-buzz-per-round model is gone, along with the `/award-points` endpoint. Replaced by the multi-buzz model with `/attempt` (per-buzz scoring) + `/end-round` (close the round explicitly).
- 2026-05-10: Removed the "Home" and "Restart song" buttons from the manager console. The header trims to just "End game"; the round-controls toolbar trims to "End round" + "Next round" / "Start game".

### Fixed

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
