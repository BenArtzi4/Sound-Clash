# Changelog

All notable user-visible changes to Sound Clash. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This project does not currently cut versioned releases; every change lands directly in `main` and ships to `https://soundclash.org` via the deploy hooks. The `[Unreleased]` block below is therefore the canonical "what's currently live" list. Internal refactors, test-only changes, CI tweaks, and doc syncs are deliberately omitted; see `git log` for that level of detail.

## [Unreleased]

### Fixed

- 2026-05-07: `/award-points` no longer 500s on prod. The PR-#38 deploy regressed `_award_blocking` by assuming `supabase-py.rpc().data` was always a dict; real PostgREST returns a list of row-dicts for TABLE-returning functions. (PR #40)

### Changed

- 2026-05-07: Repo README pivots to a player-facing pitch with a "Play it at https://soundclash.org" CTA. The developer "Quick start" is removed; the repo is a public showcase, not soliciting external PRs. (PR #41)

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
