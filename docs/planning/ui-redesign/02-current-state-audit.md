# UI redesign — current-state audit (pre-redesign baseline)

_Status: audit complete (2026-09-17, read-only pass over every page, component, stylesheet, vitest file, e2e spec and fixture, `playwright.config.ts`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.github/workflows/e2e.yml`). Companion to [README.md](README.md). Sections 3 and 4 are the safety net: they list every glyph, test id, text string, class name and ARIA contract a test depends on. When a redesign PR fails a test, look here first._

Scoping notes: the 27 `frontend/src/{hooks,lib}/*.test.ts` files contain zero DOM queries and are redesign-immune. `tests/e2e/smoke/prod_realtime.spec.ts` is `testIgnore`d and not in CI. `tests/smoke/` is bash only.

---

## 1. Screen & state inventory

### Global shell (`App.tsx`)

`ErrorBoundary` → `BrowserRouter` → `ScrollToTop` → `ToastProvider` → `Suspense fallback={<RouteFallback/>}` → `Routes`; `*` → `<Navigate to="/" replace>`.

| Cross-route surface | Component | Driven by |
|---|---|---|
| Crash screen ("Something went wrong" + Reload) | `ErrorBoundary.tsx:43-54`, `role="alert"` | `state.hasError` |
| Lazy-chunk loading (pulsing Logo) | `RouteFallback.tsx:10`, `role="status" aria-label="Loading"` | `Suspense` |
| Toast stack (top-right, portal, z 9999) | `ToastContext.tsx:58-87`, `role="region" aria-label="Notifications"`, each `role="status" aria-live="polite"` | `items[]`, variants info/success/error, 3500 ms auto-dismiss |
| Scroll reset on route change | `ScrollToTop.tsx` | `pathname` (skipped when a hash is present) |

### `/` Home (eager)

One static state: sticky header + `<Logo size="large">`, hero (h1 "Welcome to Sound Clash" + gradient subtitle), three role cards, "How to Play ›" ghost link. Invisible: backend + genre pre-warm on mount (`HomePage.tsx:21-22`). No loading, error or empty state.

### `/how-to-play` (lazy)

One static state: intro + 2.3 MB hero PNG, Roles (3 cards), Steps (Set up 1–4 / Play 5–7 + 🔊 audio note), Scoring (4 chips), Rules & FAQ (5 `<dt>/<dd>`), Back link. Content lives in module-level `SETUP_STEPS` / `PLAY_STEPS` / `FAQ` arrays (`HowToPlayPage.tsx:8-85`).

### `/join`, `/join/:gameCode` (eager)

| State | Driver |
|---|---|
| Rejoin-by-link in progress ("Reconnecting…" / "Getting you back into your team.", `aria-busy`) | `rejoining` (`:27`, `:112-121`) from `parseRejoinHash(hash)` |
| Form idle | submit disabled unless `codeValid && nameValid && !busy` (`:87`) |
| Submitting < 2.5 s | `busy` → spinner (`submit-spinner`) + "Joining…" |
| Submitting > 2.5 s | `useSlowPending(busy)` → "Getting you into the game…" |
| Submitting > 30 s | `useSlowPending(busy, 30000)` → `<p role="status">Still loading — hang tight, almost ready.</p>` |
| Error banner (`.error`) | `error`, 7 strings (§8) |
| Counters `n/6`, `n/30` | `aria-hidden` |

### `/team/:gameCode` (lazy)

| State | Driver |
|---|---|
| No stored team → redirect to `/join/:code` (renders null) | `getStoredTeam` (`:46-53`, `:109`) |
| Swept/gone with snapshot → `FinalBoard` (expiry banner + `EndScreen`) | `status === "gone" \|\| removedByExpiry` + `finalBoard` (`:121-134`) |
| Swept/gone without snapshot → "This game has ended or expired." | `:135-139` |
| Host ended → `FinalBoard(expired=false)`, no buzzer | `state.game.status === "ended"` (`:147-149`) |
| Kicked (team row gone, game live) → `navigate("/", {replace:true})` | `:90-97` |
| Live buzzer, 7 tones | `buzz` IIFE (`:197-218`) |

Buzz tones (`BuzzButton.tsx`, `data-tone`):

| `data-tone` | Label / subtitle | Condition |
|---|---|---|
| `idle` | BUZZ | playing, no lock |
| `pending` | BUZZED! | `buzzer.isBuzzing` |
| `winner` | YOU BUZZED | `lockedByMe` |
| `locked-other` | SOMEONE ELSE BUZZED / `{team} got it first` | `lockedTeam` |
| `waiting` | RECONNECTING… / hold tight | `status === "reconnecting"`, not playing |
| `waiting` | CONNECTING… | `!state \|\| status === "connecting"` |
| `waiting` | WAITING / for the game to start | connected, waiting |

Overlays: `.identityOverlay` (team name + `R{n}` pill, `round-indicator`), `.standingsOverlay` (`#N` + `N pts`/`1 pt`), `.pointStack` (`PointChange`, `aria-live="polite"`), `<p class="error">` for `buzzer.error`. There is **no** wrong-buzz cooldown state (a wrong verdict releases the lock; the button returns to idle) and no rescue modal on the team page (rescue is host-side).

### `/manager/create` (lazy)

| State | Driver |
|---|---|
| Genres loading → 6 × `<Skeleton height={44}>`, presets hidden | `genresLoading` (`:220-225`) |
| Loaded → Quick start (6 presets, `aria-pressed`), genre checkbox grid, decade pill rows | `genres.length > 0 && !genresLoading` |
| Submit disabled | `selected.size === 0 \|\| busy` |
| Submitting / slow / very slow | `busy` → spinner + "Creating game…" → "Loading songs…" (> 2.5 s) → `role="status"` helper (> 30 s) |
| Genre-load failure | error toast only |

### `/manager/game/:gameCode` (lazy) — five top-level branches

| # | State | Driver |
|---|---|---|
| 1 | Not the host — "You're not the host of this game." + 3 paragraphs + "Back to home" | `!managerToken` (`:112-131`) |
| 2a | Gone with snapshot — banner + `EndScreen` + `SongExport` + Back to home | `status === "gone"` + `finalBoard` (`:139-152`) |
| 2b | Gone without snapshot — "This game no longer exists." | `:154-158` |
| 3 | Connecting — `aria-busy`, "Connecting to game…" + skeletons | `!state \|\| status === "connecting"` (`:161-172`) |
| 4 | Ended — `EndScreen` + `SongExport` + Back to home | `game.status === "ended"` (`:177-194`) |
| 5 | Live console | otherwise |

Live-console sub-states: status pill waiting/playing; expiry banner (hidden until ≤ 20 min; overdue variant; `expiry-banner`, `extend-game`); backup host link collapsed/expanded with copy states idle/copied/failed; "Reconnect a team" trigger (`rescue-open`, only with teams); rescue modal (team list / per-team QR / generating / error); double-buffer player (`activeKey A|B`; `youtube-player` / `youtube-player-preload`, `data-ready`); song card (soundtrack badge + lines, or "No round started yet."); token chips (`token-chip-title/-artist`, non-soundtrack playing only); reserved status strip (`{Team} buzzed in — score it:` / "Waiting for a buzz…", `role="status" aria-live="polite"`); score row (soundtrack `Correct +15` vs `Correct Song +10` / `Correct Artist +5`, plus `Wrong -3`, `Bonus +4`; per-button pending flags, deliberately not a shared busy); bonus picker closed (reserved 100 px slot) / open (`aria-expanded`, `aria-controls="bonus-team-picker"`, `bonus-team-{id}`); action row `Continue round` + `Loading player…` / `Start game` / `Next round`; End-game `ConfirmDialog`; 20+ toasts from `useScoring.ts`.

### `/display` entry

One card: h1 "Display", "Enter the game code to open a read-only scoreboard.", code input + `n/6`, "Open" disabled until `/^[A-Z2-9]{6}$/`.

### `/display/:gameCode` board

| State | Driver |
|---|---|
| Gone → "Game has ended or expired." (+ `EndScreen` if `finalBoard`) | `status === "gone"` (`:161-174`) |
| Hydrating → `aria-busy` skeletons | `!state` (`:176-188`) |
| Ended → `EndScreen` only (QR footer suppressed) | `game.status === "ended"` (`:216-227`) |
| Banner: `{Team} buzzed in!` (pulsing) + `Round N` / `Round N` / "Waiting for the host…" | `lockedTeam`, `roundLabel`; `role="status" aria-live="polite"` |
| Soundtrack badge row | `isSoundtrackRound && playing` |
| Reveal panel: 1 row (🎬 film or `???`) on soundtrack, 2 rows (🎵 title / 🎤 artist) otherwise | `display-reveal-title` / `-artist` |
| Token chips `Song ✓ {name}` / `Artist ✓ {name}` | `display-token-title` / `-artist` (unused by tests) |
| Timer slot (reserved 88 px) — `RoundCountdown` 10 s when locked | `role="timer" aria-label="Time remaining"` |
| Empty board — "Waiting for teams" / "Scan the code below or enter it on your phone." | `teams.length === 0` |
| Top-5 board — `<ol style="--rows:N">` of `<li data-team-id data-rank>` with three spans (rank / name / score); medal classes when `score > 0 && rank <= 3` | `MAX_BOARD_TEAMS = 5`, `denseRanks()` |
| Buzzed-row highlight | `.bigRowBuzzed` |
| `+N more team(s) playing` | `more-teams` |
| QR footer (96/118/140/172 px by viewport height) | `QRPanel` |
| `<main data-density="normal">` | always "normal" since #179 |

### `/admin/songs` (lazy)

Password gate; console (search / genre select / "+ New song" / "Bulk import CSV"); create / edit form (`SongEditForm`, "Saving…"); table skeleton; "No songs found."; stale-while-revalidate (`.tableStale`); pagination "Page X of Y (N songs)"; delete confirm; auth failure → gate + toast.

---

## 2. Motion inventory

Global `prefers-reduced-motion` handling: `styles.css:339-347` (animation/transition durations → 0.01 ms on `*`, `*::before`, `*::after`). Two components handle it themselves: `RouteFallback.module.css:23-27` (`animation: none`) and `EndScreen.tsx:21-27` (`prefersReducedMotion()` guarding the JS count-up). The body drift is additionally gated behind `@media (pointer: fine)` (`styles.css:88-92`).

| File | Selector | Property | Duration / easing | Trigger | Buzz hot path? |
|---|---|---|---|---|---|
| `styles.css:88-107` | `body` (`bg-drift`) | **`background-position`** on a fixed 3-layer gradient | 32 s infinite alternate | always (fine pointer) | No, but full-viewport repaint per frame |
| `styles.css:159-163` | inputs | border-color, box-shadow, background | 200 ms | focus | No |
| `styles.css:198-216` | `.btn`, `:active` | background/border/color/box-shadow 200 ms + transform 80 ms; `:active` 0 ms | — | hover/press | No |
| `BuzzButton.module.css:27-31` | `.button` | box-shadow, **filter**, **background** | 200 ms | tone change, hover | **Yes** |
| `BuzzButton.module.css:37-47,153-162` | `.button::after` (`buzz-pulse`) | transform scale + opacity | 2 s infinite | armed | **Yes** — composited by design |
| `BuzzButton.module.css:57-64` | `:active`, `.pressed` | filter brightness + box-shadow, 0 ms in | 200 ms out | pointerdown | **Yes** — instant by design |
| `BuzzButton.module.css:107-130` | `.toneWinner` (`winner-celebrate`) | **filter** brightness/saturate | 700 ms spring, once | lock won | **Yes** — paints the full-screen button |
| `PointChange.module.css` | `.pill` | opacity + transform in (280 ms spring), out (360 ms, 2140 ms delay) | — | score delta | adjacent |
| `Logo.module.css:77-102` | `.animated .bar` (`bar-bounce`) | transform scaleY | 1.2 s infinite, staggered | always | No |
| `RouteFallback.module.css:9-21` | `.pulse` | opacity | 1.4 s infinite | chunk fetch | No |
| `Skeleton.module.css:1-20` | `.skeleton` | **background-position** | 1.4 s infinite | loading | paint-bound |
| `Toast.module.css:26,75-84` | `.toast` | opacity + transform | 220 ms spring | mount | No |
| `ConfirmDialog.module.css`, `TeamRescueModal.module.css` | `.backdrop` / `.dialog` | opacity / opacity + transform | 180 / 240 ms | open | No |
| `EndScreen.module.css:23-49` | `.confettiPiece` × 40 | transform + opacity | 3.5–6 s, 3 iterations | podium mount | No |
| `EndScreen.module.css:51-70,437` | `.heading`, `.thanks` (`heading-in`) | opacity + transform | 700 ms spring | mount | No |
| `EndScreen.module.css:145-182` | `.gold/.silver/.bronze` (`podium-rise`) | opacity + transform | 500–600 ms spring, staggered | mount | No |
| `EndScreen.module.css:152-195` | `.gold` (`gold-glow`) | **box-shadow** | 2.4 s, 6 iterations | mount | No — iteration-capped because it forces a full repaint |
| `EndScreen.tsx:53-89` | `CountUp` (rAF) | numeric text | 900 ms | mount | No — reduced-motion aware |
| `YouTubePlayer.module.css:32` | `.cover` | opacity | 320 ms | load/pause/ended | No |
| `DisplayPage.module.css:136-140` | `.banner` | background, border, color | 280 ms | lock change | No |
| `DisplayPage.module.css:158-173` | `.bannerLocked` (`locked-pulse`) | transform scale | 1 s infinite | buzzed | No |
| `DisplayPage.module.css:212-222` | `.timerFill` | **transform scaleX** + background | 950 ms linear | tick | No — migrated off `width` on purpose |
| `DisplayPage.module.css:237-250` | `.timerLow .timerValue` | transform scale | 0.7 s infinite | ≤ 5 s | No |
| `DisplayPage.module.css:276-281,334-339` | `.bigRow` / `.bigRowBuzzed` | background, border, transform scale, box-shadow | 250 ms | score/lock | No |
| `HomePage.module.css:58,86,242` | `.hero` / `.actions` / `.howToPlayLink` (`fade-in-up`) | opacity + transform | 0.8 s, staggered | mount | No |
| `HomePage.module.css:100` | `.roleBtn` | **`transition: all 0.4s`** | spring | hover/press | No — the one `all` in the codebase |
| `HomePage.module.css:118-196` | `.roleBtn::before`, `:hover`, `.roleIcon` | opacity; translateY(-6px); scale/rotate | 0.4–0.5 s | hover | No |
| `HowToPlayPage.module.css` | `.intro` / `.section` (`fade-in-up`) | opacity + transform | 0.7 s | mount | No |
| `JoinTeamPage`, `ManagerCreateGamePage` | `.spinner` | transform rotate | 0.6 s infinite | pending | No |
| `ManagerCreateGamePage.module.css:74-78,150-154,200-204` | `.preset` / `.decade` / `.genre` | border, background, color, box-shadow | 200 ms; hover gated `(hover: hover)` :288 (#282) | hover/selection | No |
| `ManagerConsolePage.module.css:142` | `.playerLayer` | opacity | 200 ms | buffer swap | No |
| `ManagerConsolePage.module.css:281-285` | `.statusStrip` | background, border, color | 200 ms | buzz lands | adjacent (host) |
| `ManagerConsolePage.module.css:394-418` | `.scoreBtn`, `:active` | border/background/color/box-shadow 200 ms, transform 100 ms; `:active` scale(.98) 0 ms | — | hover/press | adjacent (host) |
| `ManagerConsolePage.module.css:213-264` | `.timerRing` / `.timerLow` | background (conic), transform | — | **dead code** | — |

Non-composited offenders: `bg-drift` (background-position), `skeleton` shimmer (background-position), `gold-glow` (box-shadow), `winner-celebrate` (filter, on the hot path, one-shot), the `.button` base transition (filter + box-shadow + background, hot path), `.timerRing` (dead), and `HomePage .roleBtn { transition: all }`. Nothing animates width/height/top/left/margin directly.

---

## 3. Emoji & unicode-glyph inventory

| Glyph | file:line | Purpose | Asserted by a test? |
|---|---|---|---|
| 🎬 | `SoundtrackBadge.tsx:20` | icon inside the `role="img" aria-label="Soundtrack round"` badge (span `aria-hidden`) | **No** — badge asserted via `soundtrack-badge` only |
| 🎬 | `DisplayPage.tsx:284` | soundtrack reveal-row icon, `aria-hidden` | **No** (comments only) |
| 🎵 / 🎤 | `DisplayPage.tsx:299,310` | title / artist reveal-row icons, `aria-hidden` | **No** |
| 🔊 | `HowToPlayPage.tsx:191` | audio-note icon, `aria-hidden` | **No** (`/audio plays from the host's phone/i`) |
| 🥇 🥈 🥉 | `DisplayPage.module.css:323,327,331` (`content:` on `.bigRowGold/Silver/Bronze .bigRank::before`) | medal before the rank | **Not the glyph**, but the carrier classes are: `ten_teams_thirty_rounds.spec.ts:480,497,499` `toHaveClass(/bigRowGold\|bigRowSilver\|bigRowBronze/)` |
| ★ | `EndScreen.tsx:224` | winner crown, `aria-hidden` | **No** |
| ✓ | `ManagerConsolePage.tsx:340` (`Song ✓`) | claimed token chip | **YES (e2e)** — `token_claim_constraints.spec.ts:31` `toContainText("✓")` |
| ✓ | `ManagerConsolePage.tsx:348` (`Artist ✓`) | claimed token chip | **YES (vitest)** — `ManagerConsolePage.test.tsx:1521` `/artist\s+✓/i` |
| ✓ | `DisplayPage.tsx:327,333` (`✓ {name}`) | display token chips | **No** |
| ✓ | `HostRecoveryLink.tsx:97`, `TeamRescueModal.tsx:203` (`Copied ✓`) | copy confirmation | **No** (`/copied/i`) |
| × | `TeamRescueModal.tsx:62`, `ToastContext.tsx:81` | close / dismiss (have `aria-label`) | **No** |
| ← | `TeamRescueModal.tsx:152` | back link | **No** (`/back to teams/i`) |
| · | `EndScreen.tsx:290` | separator | **No** |
| … | `EndScreen.tsx:353` + 12 pending-copy sites | ellipsis | **No** (ASCII-only matchers) |
| › / ‹ (`&rsaquo;`/`&lsaquo;`) | `HomePage.tsx:75`, `HowToPlayPage.tsx:236` | chevrons, `aria-hidden` | **No** |
| − (`&minus;`) | `HowToPlayPage.tsx:212` | "−3" chip | **No** |
| — (em dash) | `SongTable.tsx:78,81,86` | empty admin cell | **YES (vitest, exact)** — `AdminSongsPage.test.tsx:161,169` `getByText("—")` |
| — (em dash) | `JoinTeamPage.tsx:191`, `ManagerCreateGamePage.tsx:286` | "Still loading — hang tight, almost ready." | **YES** — `JoinTeamPage.test.tsx:204`, `ManagerCreateGamePage.test.tsx:314` `/still loading — hang tight/i` |
| — (em dash) | ~15 other prose sites | punctuation | safe (matchers stop before the dash) |
| “ ” ’ | `SongEditForm.tsx:114-117`, `SongExport.tsx:152` | prose | **No** |

### Tests to update when a glyph is replaced

| Glyph | Tests |
|---|---|
| ✓ (manager token chips) | `frontend/src/pages/ManagerConsolePage.test.tsx:1521`; `tests/e2e/token_claim_constraints.spec.ts:31` |
| — (admin empty cell) — only if changed | `AdminSongsPage.test.tsx:161,169` |
| — (slow-pending copy) — only if changed | `JoinTeamPage.test.tsx:204`; `ManagerCreateGamePage.test.tsx:314` |
| 🥇🥈🥉 — only if the `.bigRow*` classes are renamed | `ten_teams_thirty_rounds.spec.ts:480,486-490,497,499` |

Every other glyph (🎬 🎵 🎤 🔊 ★ × ← · … › ‹ − and "Copied ✓") is free to replace with zero test changes.

---

## 4. Regression surface

### 4.1 `data-testid` values and consumers

| testid | Source | vitest | e2e |
|---|---|---|---|
| `buzz` | `BuzzButton.tsx:85` | `BuzzButton`, `TeamGameplayPage` (+ `.staleLock`, `.provisionalStranding`) | `buzzer_race`, `buzzer_realtime_drops`, `manager_cleanup_yt_csp`, `mobile_team`, `reconnection`, `team_rejoin`, `ten_teams_thirty_rounds`, fixtures `team-context`, `realtime-drop` |
| `round-indicator` | `TeamGameplayPage.tsx:237` | `.staleLock:145`, `.provisionalStranding:185` (`R{n}`) | — |
| `standings` / `standing-rank` / `standing-score` | `TeamGameplayPage.tsx:244-248` | `TeamGameplayPage.test.tsx:301-443` | — |
| `point-change` | `PointChange.tsx:24` | `TeamGameplayPage`, `DisplayPage` tests | — |
| `final-scoreboard` | `EndScreen.tsx:333` | `EndScreen.test.tsx` ×7 | `four_teams`, `full_game`, `ten_teams` |
| `final-scoreboard-more` | `EndScreen.tsx:352` | `EndScreen.test.tsx:57,78,102` | — |
| `more-teams` | `DisplayPage.tsx:389` | `DisplayPage.test.tsx:448-462` | `display_fit:160,164`, `ten_teams:247,467` |
| `display-reveal-title` / `-artist` | `DisplayPage.tsx:281,296,307` | `DisplayPage.test.tsx` | `soundtrack_playthrough`, `ten_teams` |
| `display-token-title` / `-artist` | `DisplayPage.tsx:325,331` | — | — (unused) |
| `soundtrack-badge` | `SoundtrackBadge.tsx:17` | `ManagerConsolePage.test.tsx:360,571,619` | `soundtrack_playthrough`, `ten_teams` |
| `token-chip-title` | `ManagerConsolePage.tsx:338` | — | `token_claim_constraints:31` |
| `token-chip-artist` | `ManagerConsolePage.tsx:346` | `ManagerConsolePage.test.tsx:1521` | — |
| `score-title/-artist/-wrong/-bonus/-soundtrack` | `ManagerConsolePage.tsx:384-430` | `ManagerConsolePage.test.tsx` (heavy) | `fixtures/manager-context` + 9 specs |
| `bonus-team-{id}` | `ManagerConsolePage.tsx:455` | `ManagerConsolePage.test.tsx` | — (e2e binds the aria-label) |
| `continue-round` / `start-round` / `end-game` | `ManagerConsolePage.tsx:470-491` | `ManagerConsolePage.test.tsx` | `fixtures/manager-context` + 12 specs |
| `rescue-open` | `ManagerConsolePage.tsx:281` | — | `team_rejoin:40,41` |
| `rescue-close` / `rescue-team-{id}` / `rescue-qr` / `rescue-url` / `rescue-copy` | `TeamRescueModal.tsx` | `TeamRescueModal.test.tsx` | `rescue-url` (`team_rejoin:44,45`) |
| `host-link-toggle/-panel/-url/-copy` | `HostRecoveryLink.tsx` | `HostRecoveryLink.test.tsx`, `ManagerConsolePage.test.tsx:2276-2279` | `host_recovery:17,18` |
| `expiry-banner` / `extend-game` | `ExpiryCountdown.tsx:52,67` | `ExpiryCountdown.test.tsx`, `ManagerConsolePage.test.tsx:2107-2168` | — |
| `export-download` / `export-playlist` | `SongExport.tsx:134,143` | `SongExport.test.tsx`, `ManagerConsolePage.test.tsx` | — |
| `submit-spinner` | `JoinTeamPage.tsx:180`, `ManagerCreateGamePage.tsx:275` | both page tests | — |
| `youtube-player` / `youtube-player-preload` | `YouTubePlayer.tsx` via `testId`; `ManagerConsolePage.tsx:301,315` | `YouTubePlayer.test.tsx:306-307`, `ManagerConsolePage.test.tsx:2029-2030` | `fixtures/manager-context:81`, `host_recovery:45`, `manager_cleanup_yt_csp:207,210` |
| `kick-team` | does not exist | — | `manager_cleanup_yt_csp:44` `toHaveCount(0)` (negative guard) |
| `expiry-hint` | does not exist | absence-only assertions | — |

Non-testid attributes that are equally load-bearing: **`data-tone`** (vocabulary `idle`/`pending`/`winner`/`locked-other`/`waiting`; ~10 e2e specs + `BuzzButton.test.tsx`), **`data-ready`** (the 40 s YouTube gate every manager e2e waits on), **`data-team-id`** + **`data-rank`** (Display rows + EndScreen rows), **`data-density`** (`DisplayPage.test.tsx:398,412`).

### 4.2 Visible-text assertions (by page)

**Home** — `/welcome to sound clash/i` (heading, `App.test.tsx:23`); links `/host a game/i`, `/join a game/i`, `/display screen/i`, `/how to play/i` (`HomePage.test.tsx:13-27`, `App.test.tsx:31,37`, `fixtures/manager-context.ts:43`, `manager_cleanup_yt_csp:189`). Links must stay `<a href>`.

**How to Play** (`HowToPlayPage.test.tsx`) — `/how to play/i` as heading level 1; `/^roles$/i`, `/steps to run a game/i`, `/^scoring$/i`, `/rules & faq/i`; `/^set up$/i`, `/^play$/i`; step titles `/host a game/i`, `/^pick genres$/i`, `/open the display/i`, `/^teams join$/i`, `/^start$/i`, `/buzz & judge/i`, `/^bonus$/i`; **`getByText("1")` … `getByText("7")` unique-match** (a second bare digit 1–7 anywhere on the page throws); `/audio plays from the host's phone/i`; the 5 FAQ terms; hero `img` alt `/three-screen setup/i` **and `src="/how-to-play-hero.png"`** (`:82`); `/back/i`.

**Join** — `/join game/i` (×7 + fixtures); labels `/game code/i`, `/team name/i`; errors `/does not exist/i`, `/already ended/i`, `/already taken/i`, `/something went wrong/i`, `/didn't work/i`, `/missing a valid game code/i`; `/joining/i` → `/getting you into the game/i`; `/still loading — hang tight/i`; negative `/waking the server/i`.

**Manager create** — `"Rock"` (exact, ×11 render gate); `/create game/i`; `getByLabelText` on genres and decades (`/rock/i`, `/^pop$/i`, `/israeli pop/i`, `/soundtracks/i`, `/80s/i`, `/^2010s$/i`, …); presets `/hot now/i`, `/^everything$/i`, `/movie night/i`; `/cancel/i` link; `/creating game/i` → `/loading songs/i`; `/still loading — hang tight/i`. e2e: `fixtures/manager-context:49` `getByLabel(^genre$)`, `:55` `/create game/i`.

**Manager console** — `/you're not the host of this game/i`; `/back to home/i`; `/connecting to game/i`; `/round 0$/i` and `` `Round ${n}$` `` (the round-advance gate in `fixtures/manager-context:155,160` + 6 specs); `/buzzed in/i` + `.closest('[role="status"]')`; `/waiting for a buzz/i`; `/no round started yet/i`; song titles/artists from fixtures; `/loading player/i` → `/start game/i` → `/^next round$/i`; toasts (`/loading next round/i`, `/round continued/i`, `/ending game/i`, `/game extended/i`, `/\+10 to Alice/i`, `/-3 to Alice/i`, …); `/^end game$/i` (page button and dialog button); `/this game has ended or expired/i`; `/this game no longer exists/i`; `/game expires in/i`; `"Award +4 bonus to {name}"` exact aria-label (`bonus_flow:71-78`, `fixtures/manager-context:201`); negatives `/invite players/i`, `/^kick$/i` must be absent.

**Team** — `/you buzzed/i`; `/Bob got it first/i`; `/someone else buzzed/i`; `/connecting/i`, `/waiting/i`, `/reconnecting/i`; `/^final results$/i`; `/this game has ended or expired/i`; standings format `"#1"`, `"20 pts"`, `/^1 pt$/`, and **`not.toHaveTextContent("of")`** (`TeamGameplayPage.test.tsx:304,441`); `"R{n}"`; team names in e2e.

**Display** — `/ABCDEF/i` placeholder; `/open/i`; `/waiting for the host/i`; `/round 2$/i`; `/Alice buzzed in/i` (+ `getByRole("status").filter({hasText})` in `buzzer_race:75,78`); `role="timer"` named `/time remaining/i`; `/waiting for teams/i`; **`"???"`** (×4 vitest; `toContainText`/`not.toContainText` in `ten_teams:617,626`); revealed titles; **exact** `"+3 more teams playing"` / `"+1 more team playing"` / `"+5 more teams playing"`; `/game has ended or expired/i`; team names.

**EndScreen** — `/final results/i` as `role="heading"` (5 e2e specs); **`getByText("WINNER")` exact, case-sensitive** (`EndScreen.test.tsx:213`; `full_game:74`, `four_teams:140`, `soundtrack_playthrough:184`, `ten_teams:514`); `/winners/i`; `/final standings/i` vs `/top teams/i`; `/and 2 more teams/i`; `/ended without any teams/i`; `"ABCDEF"`; **`` getByText(`${runningTotal}pts`) ``** (`full_game:82`) — score number and literal `pts` as adjacent text.

**Admin** — password/sign in/out/catalog strings; cell values incl. **`"—"`**; pagination `/page 1 of 2/i` …; toolbar and form labels; buttons `/\+ new song/i`, `/create song/i`, `/save changes/i`, `/^cancel$/i`, `/^delete$/i`.

**Components** — `ConfirmDialog`: `"This cannot be undone."`, defaults `"Confirm"` / `"Cancel"`. `ErrorBoundary`: `/something went wrong/i`, `/reload/i`. `ExpiryCountdown`: exact `"Game expires in 15:00"`, `"Game expires in 13:59"`, `/may close at any moment/i`. **`RouteFallback`: `getByText("Sound Clash")` — the wordmark must keep the literal text "Sound Clash" in the DOM** (uppercase via CSS only). `HostRecoveryLink`: `/anyone with this link controls the game/i`, `/copied/i`, `/copy link/i`, `/copy failed/i`. `TeamRescueModal`: `/no teams have joined/i`, `/back to teams/i`, `/couldn't load/i`. `SongExport`: `/no songs to export/i`, `/opens the first 50 songs/i`. `YouTubePlayer`: `/video unavailable/i`, `/song ended/i`, `/loading player/i`. **`BuzzButton`: `getByRole("button", { name: /BUZZ Tap or press space/i })` — the accessible name is label + subtitle concatenated; nothing may be inserted between them.**

### 4.3 CSS-class assertions

Vitest runs with `css: false`; CSS-module imports become a Proxy returning `` `_${key}_${filenameHash}` `` (verified in vitest's `CSSEnablerPlugin`), so **substring** matching works (`toContain`, `toMatch`, `[class*=]`) and exact matching does not. No vitest uses `toHaveClass`.

| Test | file:line | Couples to |
|---|---|---|
| vitest | `ConfirmDialog.test.tsx:114` | the **global** class `btn-danger` (`styles.css:249`) |
| vitest | `YouTubePlayer.test.tsx:177-238` | module keys **`cover`**, **`coverHidden`**; `[class*="cover"]` is the cover element |
| e2e | `ten_teams_thirty_rounds.spec.ts:480,486-490,497,499` | module keys **`bigRowGold` / `bigRowSilver` / `bigRowBronze`** |
| e2e | `manager_cleanup_yt_csp.spec.ts:147` | `[class*='songLine']` — module key **`songLine`** |

Complete list: **four module keys (`cover`, `coverHidden`, `bigRow{Gold,Silver,Bronze}`, `songLine`) and one global class (`btn-danger`) are load-bearing.** Every other class name is free (including `revealRowOpen`, `tokenChipClaimed`, the tone classes).

### 4.4 ARIA / role / live-region assertions

| Contract | Where asserted |
|---|---|
| `role="heading"` level 1 on "How to Play" | `HowToPlayPage.test.tsx:13` |
| `role="heading"` on FINAL RESULTS | `four_teams:137`, `full_game:65`, `soundtrack_playthrough:181`, `ten_teams:511,650` |
| `role="link"` on Home CTAs, Cancel, Back to home | `HomePage.test.tsx`, `App.test.tsx:37`, `HowToPlayPage.test.tsx:92`, `ManagerCreateGamePage.test.tsx:275-276`, `ManagerConsolePage.test.tsx:234,1684`, `fixtures/manager-context:43` |
| `role="dialog"` (+ `aria-labelledby="confirm-title"`) | `ConfirmDialog.test.tsx`, `AdminSongsPage.test.tsx`, `ManagerConsolePage.test.tsx:1618`, 5 e2e specs, `team_rejoin:42` |
| `role="alert"` on the crash screen + YouTube error cover | `ErrorBoundary.test.tsx`, `YouTubePlayer.test.tsx` |
| `role="status"` + `aria-label="Loading"` on RouteFallback | `RouteFallback.test.tsx` |
| `role="status"` wrapping the buzz banner via DOM ancestry | `ManagerConsolePage.test.tsx:438` `.closest('[role="status"]')`; `buzzer_race:75,78` on manager and display |
| `role="timer"` + `aria-label="Time remaining"` — Display only | `DisplayPage.test.tsx:141,157`; `TeamGameplayPage.test.tsx:226` (negative); `manager_cleanup_yt_csp:73-107` (count 0 on manager+team; visible then gone on display) |
| `svg[role='img'][aria-label*='QR']` must be absent on the manager | `manager_cleanup_yt_csp:41` |
| `role="img"` hero alt `/three-screen setup/i` | `HowToPlayPage.test.tsx:82` |
| `aria-expanded` on the backup-host toggle | `HostRecoveryLink.test.tsx:25,28` |
| `aria-pressed` on presets | `ManagerCreateGamePage.test.tsx:255-262` |
| `getByLabelText` needs real `<label>`↔`<input>` pairs | Join (2), Manager create (~25 genre/decade), Admin (~14) |
| Focus management in `ConfirmDialog` (autofocus, Escape, two-element Tab trap, focus restore) | `ConfirmDialog.test.tsx:30-100` |
| BuzzButton accessible name = label + subtitle | `BuzzButton.test.tsx:79` |
| Bonus buttons bound by aria-label `Award +4 bonus to {name}` | `bonus_flow`, `fixtures/manager-context:201` |

Present but never asserted (free to change): every `aria-live="polite"`, every `aria-busy`, `aria-modal` on TeamRescueModal, the bonus picker's `aria-expanded`/`aria-controls`, and the `aria-label`s "Your standing", "Team identity", "Round token state", "Song reveal", "Notifications".

### 4.5 Geometry, inline-style and element-count assertions

**vitest** (no layout engine):

| file:line | Expectation |
|---|---|
| `DisplayPage.test.tsx:398,412` | `<main data-density="normal">` |
| `DisplayPage.test.tsx:399-415` | board is an `<ol>` with inline `style="--rows: N"` |
| `DisplayPage.test.tsx:410-411` | `li[data-team-id]` length 5 |
| `DisplayPage.test.tsx:417-418, 435-440, 475-478` | **rank = 1st span, name = 2nd span** (positional) |
| `EndScreen.test.tsx:52-178` | `[data-team-id]` counts and `data-rank` mappings / row order |
| `EndScreen.test.tsx:213-216` | `getByText("WINNER").parentElement.parentElement` contains all tied names |
| `AdminSongsPage.test.tsx:160,167` | `.closest("tr")` — the catalog stays a `<table>` |
| `ManagerConsolePage.test.tsx:2029-2030` | `getAllByTestId(/^youtube-player/)` — active player first in DOM order |
| `HostRecoveryLink.test.tsx:36`, `TeamRescueModal.test.tsx:69,85` | QR is an `<svg>` inside the panel |

**e2e** (real layout):

| file:line | Expectation |
|---|---|
| `display_fit.spec.ts:99-119, 125-136, 157, 179-182` | at **10 viewports** (1920×1080 → 1024×640, incl. 1280×640 and 1366×680): exactly `min(teams,5)` rows, every row inside the viewport (1 px tolerance), `scrollHeight <= clientHeight + 2`, no empty score cell, in the worst-case playing + buzzed state; name = `span:nth-child(2)`, score = `span:nth-child(3)` |
| `ten_teams_thirty_rounds.spec.ts:135` | score = 3rd span |
| `ten_teams_thirty_rounds.spec.ts:165` | `dispatchEvent("pointerdown", {button:0})` on `buzz` — **the buzz handler must stay on `onPointerDown`** |
| `ten_teams_thirty_rounds.spec.ts:251,464,479-501,516-519` | `[data-team-id]` count 5; row 0 is gold and carries the leader's id; medal class per rank; final-scoreboard `data-rank="1"` |
| `four_teams_twenty_rounds.spec.ts:118-152` | `[data-team-id]:has-text(name):has-text(score)`; `data-rank="1"` |
| `mobile_team.spec.ts:16,39-40` | per-test `devices["iPhone 12"]`; buzz button has a bounding box |
| `manager_cleanup_yt_csp.spec.ts:90-102` | display timer text stripped of `\D` is 1–10 and ticks down — **no other digits inside the `role="timer"` element** |
| `manager_cleanup_yt_csp.spec.ts:207,210` | both YouTube players reach `data-ready="true"` within 40 s |
| `manager_cleanup_yt_csp.spec.ts:226-227` | idle network budget: < 60 requests total, < 20 to YouTube, over 20 s |
| `soundtrack_playthrough.spec.ts:111-123` | exactly one reveal row on soundtrack rounds, two otherwise (`toHaveCount` counts DOM presence — hiding with CSS fails) |
| ~15 `toHaveCount(0)` absence guards | `bonus_flow:79`, `manager_cleanup_yt_csp:37-47`, `soundtrack_playthrough`, `ten_teams:420-615` |

### 4.6 CI gating (`.github/workflows/e2e.yml`, read-only)

Job `e2e` runs on `push` to main, `workflow_dispatch`, or a PR carrying the **`run-e2e`** label (the `labeled` event re-fires the workflow). Job `buzz_race_stress` runs only on `workflow_dispatch` or the **`run-stress`** label (pytest, no Playwright). The run step is `npx playwright test --project=chromium` against a throwaway `supabase start` stack. **A frontend-only PR gets zero Playwright coverage unless someone adds `run-e2e`.**

### 4.7 Playwright projects

`chromium` (Desktop Chrome, 1280×720) is the only project CI runs; `firefox`, `webkit` and `mobile` (iPhone SE) are declared but never run. `mobile_team.spec.ts:16` overrides per-test with `devices["iPhone 12"]` so it ships inside the chromium run. The e2e `webServer` is the **Vite dev server**, so `public/_headers` (the CSP) is **not** applied during e2e — CSP checks are prod-only.

---

## 5. Design-token usage & hard-coded colours

Tokens (`styles.css:1-47`): 17 `--color-*`, 4 `--radius-*`, 3 `--shadow-*`, 6 `--space-*`, `--font-display`, `--easing-spring`. **No dark-mode block exists**; `index.html:11` declares `color-scheme: light`.

| File | `var(--color-*)` | hex | rgb/rgba |
|---|---|---|---|
| `styles.css` | 26 | 29 | 17 |
| `ManagerConsolePage.module.css` | 38 | 39 | 35 |
| `ManagerCreateGamePage.module.css` | 34 | 13 | 8 |
| `DisplayPage.module.css` | 30 | 30 | 17 |
| `AdminSongsPage.module.css` | 23 | 0 | 0 |
| `HowToPlayPage.module.css` | 7 | 30 | 25 |
| `HomePage.module.css` | 1 | 16 | 23 |
| `JoinTeamPage.module.css` | 7 | 6 | 1 |
| `TeamGameplayPage.module.css` | 2 | 5 | 5 |
| `EndScreen.module.css` | 11 | 56 | 13 |
| `TeamRescueModal.module.css` | 16 | 3 | 2 |
| `Toast.module.css` | 8 | 1 | 0 |
| `HostRecoveryLink.module.css` | 8 | 3 | 1 |
| `ErrorBoundary.module.css` | 7 | 8 (token fallbacks) | 1 |
| `QRPanel.module.css` | 5 | 4 | 1 |
| `ConfirmDialog.module.css` | 3 | 1 | 1 |
| `PointChange.module.css` | 3 | 8 | 0 |
| `ExpiryCountdown.module.css` | 2 | 2 | 2 |
| `YouTubePlayer.module.css` | 1 | 4 | 2 |
| `BuzzButton.module.css` | **0** | 15 | 16 |
| `Logo.module.css` | 0 | 6 | 0 |
| `SoundtrackBadge.module.css` | 0 | 3 | 1 |
| `Skeleton.module.css` | 0 | 0 | 3 |
| `SongExport.module.css` | 0 | 1 | 0 (uses a non-existent `var(--muted, #666)`) |
| **Total** | **232** | **283** | **174** |

457 literals vs 232 token references: ~66 % un-tokenised. Top literals: `#ffffff` (66), `#3b82f6` (21), `#0f172a` (21), `#06b6d4` (17), `#92400e` (12, no token), `#10b981` (11), `rgba(245,158,11,0.18)` (11, no token), `#b45309` (9), `#f8fafc` (8), `#f59e0b` (8), `#2563eb` (8), `#94a3b8` (7), `#059669` (7), `#475569` (6), `#b91c1c` / `#78350f` / `#047857` (5 each). Seven distinct alphas of the primary blue. The redesign's token set replaces all of it.

**Fonts:** one stack (`--font-display`, system) on `body` and re-declared on `BuzzButton .button`; the mono stack `ui-monospace, "SF Mono", Menlo, monospace` is repeated verbatim **10 times** (needs `--font-mono`). Zero `@font-face`, zero external fonts.

**Radii:** 25 declarations bypass the tokens (28 px BuzzButton, 20 px Home cards, 18 px / 14 px How-to-play, 3 px / 2 px, 999px duplicates, 50 % circles). **Shadows:** 67 declarations, 44 literal (coloured glows). **z-index** (no tokens): 0, 1, 2, 40, 50, 100, 9000, 9999.

**Dead CSS:** `ManagerConsolePage.module.css` `.checkRow/.checkLabel/.checkChecked` (303-363), `.headerActions` (80-84), `.statusEnded` (67-71), the whole timer block `.timerWrap/.timerRing/.timerValue/.timerLow` + `@keyframes timer-pulse` (196-264) and its mobile overrides (639-645) — ~135 lines; `DisplayPage.module.css` `.emptyBoardQR` (377-379), `.emptyBoardCode` (415-424); `AdminSongsPage.module.css` `.soundtrackToggle` (185-201). Also a latent bug: `styles.css:321-325` `.roleBtn:focus-visible` is a global selector that never matches the module-scoped `.roleBtn` on Home.

---

## 6. Accessibility & responsiveness

**Live regions:** `aria-live="polite"` on `PointChange`, both point stacks, the Display banner and the manager status strip (both `role="status"`), each toast; visually-hidden one-shot announcers in `ExpiryCountdown.tsx:48` and `RoundCountdown.tsx:46` (the ticking value sits under `role="timer"`, implicit `aria-live: off`). `aria-busy` on `SongTable`, Display hydrate, Join rejoin, console connecting. `.visually-hidden` at `styles.css:327-337`.

**Focus:** global `.btn:focus-visible` ring (`styles.css:321-325`); `BuzzButton` triple ring; `ManagerCreateGamePage` moves the ring to the pill via `:has(input:focus-visible)` and suppresses the pointer ring; `ConfirmDialog.tsx:41-68` autofocus + Escape + two-element Tab trap + restore; `TeamRescueModal` has Escape + initial focus but **no Tab trap**.

**Touch:** `touch-action: manipulation` + transparent tap-highlight on `.btn`, BuzzButton, `.scoreBtn`, presets/decades/genres; tap-highlight only on `.rescueTrigger`, HostRecoveryLink, TeamRescueModal buttons. The `@media (hover: hover)` gate at `ManagerCreateGamePage.module.css:288-325` is the #282 fix. Targets: 44 px presets/decades, 48 px bonus team buttons, 52–64 px score buttons.

**Breakpoints per file:** `styles.css` `(pointer: fine)`, `(prefers-reduced-motion)`; Home / How-to-play 1100 / 768 / 480; Join 480; Create `min-width: 601` (decades `display: contents`), `(hover: hover)`, 600; Console 480 / 600 ×3 (one-screen fit at :672) / `600 and max-height: 660`; Display `min-width: 769 and min-height: 640` (TV frame), `769 and max-height: 860`, `769 and max-height: 700`, `max-width: 768`; Admin 600; Team none; EndScreen 720; Toast 480; QRPanel 600; HostRecoveryLink 600; Logo `min-width: 1400`. Inconsistent (480/600/601/720/768/769/1100/1400) — unify in the cleanup PR if cheap.

**Display TV frame (≥ 769 × ≥ 640):** `DisplayPage.module.css:514-627` — `.shell` `height: 100dvh; overflow: hidden`; `--row-h: 78px`, `--row-font: 1.8rem`, `--list-gap: 12px`; `.bigList` is a column-major grid with elastic `minmax(0,1fr)` rows driven by inline `--rows`, `container-type: size`; `.bigRow` font `clamp(0.72rem, calc(42cqh / var(--rows)), var(--row-font))`; shorter-frame refinements at max-height 860 / 700. Below 640 tall the page scrolls. Enforced by `display_fit.spec.ts` at 10 resolutions.

**Manager one-screen (#177 / PR #264):** `ManagerConsolePage.module.css:672-754` (`max-width: 600`) + `:758-793` (`and max-height: 660`): `.shell`, `.header`, `.code`, `.hostTools`, `.column`, **`.playerStack { height: clamp(116px, 19dvh, 168px) }`** → `clamp(96px, 16dvh, 140px)` (both layers stay laid out, never `display:none`), `.card`, `.songBlock`, `.songLine`, `.tokenChips`, `.statusStrip` (3.25 → 2.4 → 2.1 rem), `.scoreRow`, `.scoreBtn` (64 → 52 → 48 px), `.bonusPickerSlot` collapsed while `:empty`, `.awardBtn`/`.continueBtn`, `.endGameFooter`. No `overflow: hidden`. Verified 360×640 → 430×932.

**dvh:** `ErrorBoundary`, `TeamGameplayPage` (`100vh` fallback then `100dvh`), Display frame, console clamps, TeamRescueModal max-height.

**Colour scheme:** `index.html` `theme-color #06b6d4`, `color-scheme light`; `manifest.webmanifest` `theme_color #06b6d4`, `background_color #f8fafc`. A dark redesign changes all four.

---

## 7. Bundle / chunk structure

Eager: `HomePage`, `JoinTeamPage` (in `index-*.js`). Lazy: `HowToPlayPage`, `TeamGameplayPage` (**prefetched from `JoinTeamPage.tsx:42-44`** while the player types), `ManagerCreateGamePage`, `ManagerConsolePage`, `AdminSongsPage`, `DisplayPage`. `ErrorBoundary` is outermost so a stale chunk after a deploy shows Reload; `lib/preloadError.ts` auto-reloads.

`vite.config.ts`: `manualChunks` splits only `react-dom|react-router-dom|react-router|react|scheduler` into `vendor`. Any new UI dependency would land in the **app entry chunk, not `vendor`** (and must be flagged per the dependency rule). `vitest.config.ts`: jsdom, `css: false`, coverage thresholds 85/80/85/85 on `src/`. CI also runs a separate `prettier --check "src/**/*.{ts,tsx,css}"` step, and `eslint.config.js:34-73` keeps a hand-maintained `globals` allowlist (add `ResizeObserver`, `matchMedia`, `ViewTransition`, … as needed or `no-undef` fails).

Asset weight: `public/how-to-play-hero.png` 2.3 MB; `og-image.jpg` 134 KB; icons 15–199 KB.

---

## 8. Copy inventory (frozen unless a PR lists the change)

**Home:** "Welcome to Sound Clash" · "The ultimate music trivia buzzer game" · "Host a game" / "Pick genres and start playing" · "Join a game" / "Play on your phone" · "Display screen" / "Show scoreboard" · "How to Play ›".

**How to play:** "How to Play" · "Roles, the quick setup, scoring, and the rules that come up most often." · "Roles" / "Steps to run a game" / "Scoring" / "Rules & FAQ" · role cards Host / Team / Display · "Set up" (once, about 2 min) / "Play" (every round) · steps 1–7 · the audio note · scoring "+10 Correct song" / "+5 Correct artist" / "−3 Wrong buzz (cannot combine with title or artist)" / "+4 Manager bonus…" · 5 FAQ entries · "‹ Back".

**Join:** "Join a team" · "Enter the code your host shared with you." · "Game code" / "Team name" · "ABCDEF" / "The Champions" · "Already had a team? Enter the same name to rejoin and keep your score." · "Cancel" / "Join game" → "Joining…" → "Getting you into the game…" · "Still loading — hang tight, almost ready." · "Reconnecting…" / "Getting you back into your team." · 6 error strings.

**Team:** BUZZ · BUZZED! · YOU BUZZED · SOMEONE ELSE BUZZED / "{team} got it first" · RECONNECTING… / hold tight · CONNECTING… · WAITING / for the game to start · "R{n}" · "#{rank}" · "{n} pts" / "1 pt" · "This game has ended or expired."

**Create:** "Host a game" · "Pick at least one genre to start." · "Quick start" · Everything / Israeli Mix / International / Hot Now / Movie Night / 80s & 90s · "Genres ({n} selected)" · "Release decade (optional — any year if none picked)" · 60s…2020s · "Cancel" / "Create game" → "Creating game…" → "Loading songs…" · toasts "Game {CODE} created", "Failed to load genres", "Failed to create game".

**Console:** "Game code" · waiting/playing · "Round {n}" · not-host copy · gone copy · "Connecting to game…" · "Game expires in {m:ss}" · "Game has passed its play window — it may close at any moment." · "Keep playing +1h" · "Backup host link" / "Hide backup host link" + explainer · "Copy link" / "Copied ✓" / "Copy failed — select the link text above instead." · "Anyone with this link controls the game — share it only with a co-host." · "Reconnect a team" · "No round started yet." · "Soundtrack" · "Song ✓ / Song open" · "Artist ✓ / Artist open" · "{team} buzzed in — score it:" · "Waiting for a buzz…" · "Correct Song +10" / "Correct Artist +5" / "Correct +15" / "Wrong -3" / "Bonus +4" / "Award +4 to:" · "Continue round" · "Loading player…" / "Start game" / "Next round" · "End game" · confirm copy · rescue modal copy · ~12 toasts · export copy.

**Display:** "Display" / "Enter the game code to open a read-only scoreboard." / "Open" · "Sound Clash" · "Waiting for the host…" · "Round {n}" · "{team} buzzed in!" · "Waiting for teams" / "Scan the code below or enter it on your phone." · "+{n} more team(s) playing" · "Game has ended or expired." · "???" · "Scan to join" / "Generating…" / "QR unavailable".

**EndScreen:** "FINAL RESULTS" · "Game {CODE} · {n} team(s)" · "WINNER" / "WINNERS" · "Final standings" / "Top teams" · "…and {n} more team(s)" · "Game ended without any teams." · "Thanks for playing!" · "pts".

**Chrome / metadata:** `<title>Sound Clash` · description / OG / manifest "Real-time multiplayer music trivia. Buzz in, name the tune, win the round." · YouTube overlay "Loading player..." / "Song ended" / "Video unavailable; manager can pick a new song." · ErrorBoundary "Something went wrong" / "The app hit a snag — reloading usually fixes it. Your game is still running." / "Reload".

---

## 9. The ten hardest constraints, and the safest levers

1. **Display row shape** — `<li data-team-id data-rank>` with **exactly three `<span>` children in rank / name / score order** (five tests assert positionally).
2. **`display_fit.spec.ts`** — 5 rows, fully on-screen, zero page scroll, at 10 resolutions from 1920×1080 to 1024×640, in the buzzed state.
3. **Load-bearing class names** — module keys `bigRowGold/Silver/Bronze`, `songLine`, `cover`, `coverHidden`; global `btn-danger`.
4. **`HowToPlayPage.test.tsx`** — unique `getByText("1")`…`("7")`, ~20 copy assertions, a level-1 heading pin, and the hero `img` alt + `src`.
5. **Real `<input>` + `<label>` pairs** — ~40 `getByLabelText` calls across Create, Admin, Join.
6. **`EndScreen.test.tsx:213-216`** — `getByText("WINNER").parentElement.parentElement`.
7. **ARIA as selectors** — `role="status"` on both buzz banners, `role="timer"` only on Display during a lock, `role="dialog"`, `role="heading"` on FINAL RESULTS, no QR `role="img"` on the manager.
8. **Two YouTube players** on the console (`youtube-player` + `-preload` both `data-ready`), and the idle network budget.
9. **`onPointerDown` on the buzz button** and the `data-tone` vocabulary.
10. **~40 exact copy strings** used as selectors (`+N more team(s) playing`, `This game has ended or expired.`, `{team} buzzed in`, `Round {n}`, `WINNER`, `{n}pts`, `???`, `✓`, `—`, `Award +4 bonus to {name}`, `Host a game`, `Create game`, `Join game`, `End game`, `Still loading — hang tight`, `Game expires in {m:ss}`, `#{n}` / `{n} pts` and never "#N of M", "Sound Clash" in the wordmark).

**Safest levers:** every CSS value (never loaded in vitest), every `aria-live`/`aria-busy`/`aria-modal`, every glyph except `✓` (manager chips) and `—` (admin cells, slow-pending copy), the `&rsaquo;`/`&lsaquo;`/`&minus;` entities, the unused `display-token-*` ids, the ~135 lines of dead console CSS, and everything under `src/hooks/` and `src/lib/`.
