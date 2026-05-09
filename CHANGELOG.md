# Changelog

All notable user-visible changes to Sound Clash. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project does not currently cut versioned releases; every change lands directly in `main` and ships to `https://soundclash.org` via the deploy hooks. The `[Unreleased]` block below is therefore the canonical "what's currently live" list. Internal refactors, test-only changes, CI tweaks, and doc syncs are deliberately omitted; see `git log` for that level of detail.

## [Unreleased]

### Fixed

- 2026-05-09: Refreshing the manager tab mid-round no longer drops the host into a "No round started yet" view. The current song is now re-fetched from the round row and pushed back into the YouTube player so the host can keep scoring the buzz instead of being forced to start over with Next round.
- 2026-05-09: When a song plays through to its natural end, the manager (and any other YouTube view) no longer leaks YouTube's endscreen tiles, which could include other tracks from the same artist's channel and spoil future rounds. The player now stops playback on `ENDED` and re-shows the "Song ended" cover.
- 2026-05-09: YouTube player on the manager screen no longer fails with error 153 / "video player settings" - the embed iframe was being rebuilt every render with no video ID and bombarding the YouTube CDN (~10 req/s, hundreds of MB/min). Stabilised the player's mount effect so it initializes once per page lifetime.
- 2026-05-09: Sentry error reporting works again on production. The deployed CSP `connect-src` listed `o*.ingest.sentry.io` (mid-host wildcard, invalid per CSP spec), which Chrome rejected, generating thousands of `'<URL>' will be ignored` console errors and silently blocking Sentry traffic. Wildcards moved to the leftmost label.
- 2026-05-07: `/award-points` no longer 500s on prod. The PR-#38 deploy regressed `_award_blocking` by assuming `supabase-py.rpc().data` was always a dict; real PostgREST returns a list of row-dicts for TABLE-returning functions. (PR #40)

### Changed

- 2026-05-09: Round timer reworked. There is no longer a 20-second pre-buzz countdown. Instead, when a team buzzes, a 10-second countdown starts on the team and display screens so the buzzed team has a clear answer window. The manager screen no longer shows the timer.
- 2026-05-07: Repo README pivots to a player-facing pitch with a "Play it at https://soundclash.org" CTA. The developer "Quick start" is removed; the repo is a public showcase, not soliciting external PRs. (PR #41)
- 2026-05-07: Trimmed the home page intro and moved "How to Play" to its own `/how-to-play` page (with roles, game flow, and scoring sections). The home page now shows only the title, tagline, three role cards, and a small "How to Play" link.
- 2026-05-07: Bumped role-card and hero font sizes on the home page so the three role CTAs (Host / Join / Display) read as primary actions; smaller copy bumps on the How-to-Play page.
- 2026-05-07: Team page (player's phone) now shows a "Round N" pill in the header and highlights the player's own row in the scoreboard with a "you" tag.
- 2026-05-07: Display screen empty state now shows a scannable QR code so players can join without typing the 6-letter code; the round number stays visible on screen even when a team buzzes in.

### Removed

- 2026-05-09: Removed the "Invite players" QR/URL panel from the manager console - the game code is already prominent in the header and on the empty-teams hint, so the second copy was clutter.
- 2026-05-09: Removed the per-team "Kick" button from the manager console. To get rid of a team, the host can end the game and start a fresh one.
- 2026-05-07: Removed the "Rounds" picker from the Create-Game form. Games now run for as many rounds as the host wants and end only when the host clicks "End game"; round counters across the team page, display, and manager console show "Round N" without a denominator.

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
- The legacy AWS-based stack (CloudFront, ECR repos, S3 buckets, ACM cert, CloudWatch logs). Replaced by the free-tier stack. See `docs/aws-teardown-checklist.md`.
