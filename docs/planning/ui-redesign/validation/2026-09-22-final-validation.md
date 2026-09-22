# UI redesign — final validation, 2026-09-22

Mode: **full** (tasks live: T0 … T11; skipped tags: none). Prod build: `index-TBFd5Vnn.js` (main @ `6829298`, PR #327). Prod window (UTC): 2026-09-22 04:15 – _(end filled in Part D)_. Session model: Fable 5.1 (subagents Opus).

## Verdict: _(pending — filled in Part F)_

## Findings

| id | sev | where | route / state | symptom | evidence | spec | proposed fix | status |
|---|---|---|---|---|---|---|---|---|

## Re-verify after merge

_(filled in Part F)_

## Owed to the maintainer

```
- [ ] iPhone (Safari 17/18): /join → /team → one buzz race, one Correct Song, one Wrong, End → podium. Check: dvh fill, no tap flash, black label on orange legible outdoors, fonts load, View Transitions or instant swap with no glitch.
- [ ] Android Chrome (mid-range): same flow; the idle pulse stays smooth (60 fps) with the phone at 50 % brightness; INP on the BUZZ press feels instant.
- [ ] Samsung Internet: /team only — buzz works, tones correct.
- [ ] TV / laptop → HDMI Chrome 1920×1080, from 3 m: code chip and rank numerals readable, QR scannable from a phone, board reorder visible, podium readable.
- [ ] Firefox desktop: / → Host → Play → Display: instant swaps, no blank frame, no console error.
- [ ] Two real phones in one game (06 §9): both join by QR, race, score every button once, soundtrack round, Keep playing +1h (only if within 20 min of expiry), End → podium on both, Export on the host.
- [ ] Chrome "Install app" still offered on prod (PWA unchanged).
```

## Part 0 — setup

- **0.1** Report branch `feature/ui-final-validation-report` from `origin/main` @ `6829298`. (`main` itself is checked out by a leftover worktree at `C:/Users/yulin/GBA/sc-validation`, clean and empty, so the branch was cut from `origin/main` directly.)
- **0.2 Fingerprints** (all twelve live → full mode):

| Task | Fingerprint | Result |
|---|---|---|
| T0 fonts | woff2 files in `public/fonts` | 4 (anton-latin, instrument-sans-latin, secular-one-hebrew, heebo-hebrew) |
| T1 tokens | `--accent: #FF7A00` in `styles.css` | present as lowercase `--accent: #ff7a00` (the fingerprint grep is case-sensitive; the token is live at line 27) |
| T2 icons | `src/components/icons.tsx` | present |
| T3 wordmark | `EqualizerMark` in `Logo.tsx` | 2 |
| T4 home copy | `Name the song` in `HomePage.tsx` | 1 |
| T5 code field | `src/components/GameCodeField.tsx` | present |
| T6 create | `scroll-snap` in `ManagerCreateGamePage.module.css` | 3 |
| T7 buzz screen | `data-round-live` in `TeamGameplayPage.tsx` | 1 |
| T8 console | `--accent` in `ManagerConsolePage.module.css` | 9 |
| T9 display | `@formkit/auto-animate` in `package.json` | 1 |
| T10 transitions | `src/hooks/useViewTransitionNavigate.ts` | present |
| T11 cleanup | `--space-xs` in `styles.css` | 0 |

  Merged redesign PRs on `main`: #303 #304 #307 #308 #309 #310 #311 #312 #313 #314 #315 #316 #320 #323 #324 #326 #327.

- **0.3 Prod serves the merged tree.** Deployed eager chunks: `index-TBFd5Vnn.js`, `index-B_7KuYU6.css`, `vendor-fHMnGTVz.js`; lazy: `DisplayPage-DLuFfpnK.js` / `-BYeJ2BG_.css`, `ManagerConsolePage-Bx55kyZG.js` / `-1feokujN.css`, `TeamGameplayPage-Dar2IVVN.js` / `-bGrUi-Nq.css`, `useGameChannel-DAmMvcMI.js` / `-CjH373gG.css`. Local build (`npm ci && npm run build` on `6829298`): **every one of the 11 hashes above is byte-identical** to the deployed set (eager + lazy), so Parts C–E ran against the merged tree. Note: the first `npm ci` failed silently inside the Bash sandbox (registry egress blocked) and a second attempt hit a Windows file lock held by a `vite preview --outDir dist-branch` process left running since 2026-09-20 (PID 39228, port 4173); that stale preview was stopped before the install.
- **0.4 Local stack.** `supabase start` already up (CLI 2.117.0); DB at migration 047 (`award_attempt` single overload, `set_song_availability`, `team_secrets`, `game_secrets`, `total_rounds` gone), seed catalog 13 songs / 12 `song_genres` / 11 genres (the 13th song is the harmless `measure0001` leftover noted in lessons-learned 2026-09-20); Realtime publication carries all three ephemeral tables; `MigrationCountMismatch` count in the Realtime log = 0. `tests/e2e/.env` points at 127.0.0.1:54321 / localhost:8000; Playwright 1.61.1 with chromium-1228, firefox-1532, webkit-2311 installed.
- **0.5 Prod prerequisites.** `/health` → `{"status":"ok","supabase":"ok"}` at 04:15:29Z; `VITE_SUPABASE_URL=https://jvfddxuaqcsrguibkymp.supabase.co` + anon key present in `frontend/.env.production`; live games (`status='playing' and expires_at > now()`) = **0**; no non-ended games at all. Grafana MCP answers (`grafanacloud-logs` Loki, `grafanacloud-traces` Tempo).

## Part A — automated gates

- **A.1 Frontend gate** — all exit 0: `format:check` (Prettier clean), `lint` (eslint clean), `typecheck` (tsc clean), `test:run` **600 passed / 59 files** (baseline 521 → +79, nothing removed), `test:coverage` **93.66 % lines / 86.27 % branches / 94.6 % functions / 97.1 % statements** (thresholds 85/80/85/85 met), `build` ends with `check-bundle: 20 chunks scanned; "@formkit/auto-animate" only in DisplayPage-DLuFfpnK.js`.
- **A.2 Source sweeps** (ripgrep 14.1.1 over `frontend/src`):
  - emoji: 0. `transition: all`: 0. `backdrop-filter`: 0 (one comment only). "Welcome to": 0. `how-to-play-hero.png`: 0 refs and the file is gone. Legacy aliases (`--space-xs|--easing-spring|bg-drift`): 0 in source (the one hit is `styles.test.ts:118`, a `not.toContain` guard). `startViewTransition`: exactly `hooks/useViewTransitionNavigate.ts`. `auto-animate`: exactly `pages/DisplayPage.tsx`.
  - `gradient(`: `EndScreen.module.css:135` (the winner light sweep — allowed) **and `components/YouTubePlayer.module.css:19`** (`linear-gradient(135deg, #1e293b 0%, #0f172a 100%)` on the console's player cover, with the old slate palette, `rgba(255,255,255,.7)` text, `#fecaca` error text and a fifth easing `ease`) → **F-01**. The plan's "code-field cells" allowance is obsolete: PR #317 rebuilt the field as a grid and it no longer uses a gradient.
  - `box-shadow`: `--shadow-modal` on Toast, ConfirmDialog, TeamRescueModal and PointChange (the pill's shadow is specified by 07 Task 3); the rest are `box-shadow: none` resets or **inset** 3 px rules (rank-1 accent bar on the board and podium, the code-field caret stand-in) which are lines, not elevation. No finding.
  - `translateY(-6px)|rotate(`: only the two submit-spinner keyframes (`JoinTeamPage.module.css:64`, `ManagerCreateGamePage.module.css:306`, `rotate(360deg)`) — 04 §5 row 6 allows spinner rotation. No finding.
  - `hover-guard.mjs`: **2 `:hover` rules outside `@media (hover: hover)`** — `styles.css:149 a:hover { text-decoration: underline }` (global, reaches every page) and `AdminSongsPage.module.css:87 .table tbody tr:hover` → **F-02**.
- **A.3 Fonts** — 4 woff2, **68,724 bytes** total (anton-latin 18,612 · instrument-sans-latin 30,092 · secular-one-hebrew 7,984 · heebo-hebrew 12,036; ≤ 120 KB ✓). `_headers` has `/fonts/*  Cache-Control: public, max-age=31536000, immutable`; `index.html:19` preloads `anton-latin.woff2` (`as="font" type="font/woff2" crossorigin`); `fonts.css` declares Anton, Instrument Sans, Secular One, Heebo, all `font-display: swap` with `unicode-range` subsets.
- **A.4 Bundle vs baseline (gzip)** — `index-TBFd5Vnn.js` **62.70 KB** (baseline 60.94, Δ +1.76), `vendor-fHMnGTVz.js` **74.14 KB** (Δ 0), all CSS chunks **19.61 KB** (baseline 20.93, Δ −1.32). Eager JS +1.76 KB against a +20 KB budget; CSS under baseline. Chunk guard: `check-bundle.mjs` (sourcemap-based) confirms `@formkit/auto-animate` lives only in `DisplayPage-*.js`; no `framer-motion`/`lenis`/`gsap` anywhere (0 hits in the deployed `index`, `vendor` and all lazy chunks). The literal grep of the deployed chunks for `auto-animate` returns 0 even for DisplayPage — Rolldown minifies the package name away (lessons-learned 2026-09-19), which is why the guard reads sourcemaps.
- **A.5 Backend + DB gate** (throwaway testcontainer, `DATABASE_URL=""`): `ruff check` clean, `ruff format --check` 28 files formatted, `mypy app` no issues in 28 files; `pytest -m "not stress"` **390 passed, 1 skipped, 1 deselected** in 222 s (no `test_rls_anon` rerun needed); `pytest -m stress` **1 passed** (the 10-concurrent → 1-winner race, 100×) in 14.5 s.
- **A.6 CI on `main` @ `6829298`** — `Frontend` success, `E2E` success, `CodeQL` success (all 2026-09-21T14:47Z); `Backend` is path-filtered and last ran on `3d4b73b` (2026-09-20, success) — no backend file changed since. The `E2E` run for the previous SHA `f9f00f0` shows `cancelled` only because the #327 merge superseded it (concurrency group).

## Part B — local e2e

_(pending)_

## Part C — prod protocol

- **C.1** `post_deploy.sh` → `PASS game=ETY4ZR` (health → create → Alpha + Bravo join → end, `ended_at=2026-09-22T04:30:32Z`).
- **C.2** `buzzer_recovery.sh` → `PASS game=VVJXDE`, all 8 steps (lock atomic, release re-arms, round 2, ended).
- **C.3** prod Realtime smoke — _(first run + rerun recorded below)_
- **C.4** `api-matrix.sh` → **`ALL PASS (44 cases)`**, game `J4XYYG` created and ended by the script. Every case in the plan's list passed: validation errors for slugs / empty list / 31-char / whitespace names, bidi override stripped, `not_found` for an unknown code, same-name reclaim returns the same id, bonus `unauthorized` ×2 and `validation_error` for 0 and 51 with 50 accepted, rejoin-token gating + round-trip (same id, score 50, bogus → `not_found`), `buzz_in` on `waiting` → `locked=false`, `manager_token_required`, `no_buzz_to_score`, atomic lock (A wins, B sees A, foreign id → false), `wrong_buzz_with_correct`, `+10`, `title_already_claimed`, release re-arms, free guess `0` then `−3`, `peek_next_song` one row, `extend_game` +1 h, kick → 204 and the kicked team can no longer buzz, round 2, end auth, `ended`, `gone`, `game_ended` ×2, `buzz_in` after end → false.
- **C.5** _(pending)_
- **C.6** _(pending)_
- **C.7** _(pending)_

## Part D — prod real-browser game

_(pending)_

## Part E — design conformance

_(pending)_

## Screenshots (scratchpad, not committed)

_(pending)_
