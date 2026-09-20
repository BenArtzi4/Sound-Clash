# UI redesign — page by page

_Status: draft for maintainer review (2026-09-17). Companion to [README.md](README.md). Tokens are referenced by their semantic name (`--bg`, `--accent`, …); the hex values live in [01-design-system.md](01-design-system.md). Every "keep" below is a behaviour or test contract from [06-validation-plan.md](06-validation-plan.md) §3; every "change" is visual only unless marked **behaviour**._

The shared rules first, then each route in the order a player meets them.

---

## 0. Shared shell

| Element | Today | New |
|---|---|---|
| Page background | Light `#f8fafc → #e0e7ff → #dbeafe` gradient with two radial blobs, drifting on desktop (`bg-drift`, 32 s) | Flat `--bg` (near-black, see design system). No gradient, no drift. Depth comes from a single `--surface` tone and 1 px `--border` lines, not from shadows. The 32 s repaint animation is removed outright (it was gated to `pointer: fine` because it repainted the viewport). |
| Wordmark | `Logo.tsx`: four gradient equaliser bars + "Sound Clash" in gradient text | Text wordmark set in the display face, tight tracking, `--bone`; uppercase via CSS `text-transform` only — **the DOM text stays exactly "Sound Clash"** (`RouteFallback.test.tsx` does `getByText("Sound Clash")`); a small **monochrome** four-bar mark in `currentColor` (the equaliser bars keep their idle animation — it is the app's one signature motion — but in one colour, and it pauses under reduced motion). No gradient text anywhere in the app. |
| Header stripe | 2 px blue→cyan→green gradient under the header | Removed. Header is a single 1 px `--border` line or nothing. |
| Cards | White, 12 px radius, drop shadow | `--surface` on `--bg`, 1 px `--border`, radius `--radius-md` (12 px stays), **no drop shadow** by default. Elevation is reserved for modals and toasts (`--shadow-modal`). |
| Buttons | `.btn` white with 2 px border; `.btn-primary` blue gradient; `.btn-ghost`; `.btn-danger` | Same four roles, same class names. Primary = solid `--accent` with `--accent-ink` text, no gradient; secondary = `--surface` with 1 px `--border`; ghost = text only; danger = outlined `--negative`. Pressed: `transform: scale(0.98)` at 0 ms, release eases 160 ms. Hover only under `@media (hover: hover)`. |
| Inputs | 2 px border, blue focus ring | 1 px `--border`, 2 px `--accent` focus ring via `outline` (not box-shadow), `--surface-2` background. |
| Type scale | System stack, 2.4 rem h1 | Display face for h1/h2/wordmark/scores/BUZZ; text face for everything else; fluid `clamp()` steps defined in the design system. |
| Icons | Emoji + three gradient SVG role icons | One inline SVG icon set (`components/icons/`): 24 px grid, 1.75 px stroke, `currentColor`, `aria-hidden`. Icons: note, mic, film, speaker, check, arrow-right, arrow-left, qr, link, refresh, close, host, phone, tv. No gradients, no fills. |
| Toasts | White card, blue left bar, spring pop-in | `--surface` card, 1 px `--border`, 3 px accent bar by tone; enter with `@starting-style` (opacity + 8 px translate, 200 ms), exit with `transition-behavior: allow-discrete` (160 ms). Position unchanged. |
| Modals (`ConfirmDialog`, `TeamRescueModal`) | Fade | Backdrop `--bg` at 70 % opacity; panel scales 0.98→1 + fades, 200 ms; exit 140 ms. Focus trap and roles unchanged. |
| Route fallback | Pulsing gradient logo | Pulsing monochrome mark. |
| Error boundary | White card | `--surface` card, same copy, same Reload button. |
| Skeletons | Grey shimmer | `--surface-2` blocks with a slow opacity pulse (no gradient sweep). |

**Route transitions (behaviour: none; motion only).** User-initiated internal links become `TransitionLink`s and the few programmatic navigations after a click use `useViewTransitionNavigate()` — a ~25-line hook that preloads the destination chunk, then runs the navigation inside `document.startViewTransition` (react-router's own `viewTransition` prop does nothing in this app's declarative router; see [03-library-evaluation.md](03-library-evaluation.md) §2.1). The root crossfades ≤ 240 ms with a 12 px upward slide on the incoming page; the wordmark carries `view-transition-name: wordmark` so it stays put while the page changes beneath it. Redirects (kick, expiry, missing team) stay instant, and no Realtime-driven update ever uses a view transition — a running one suspends hit-testing. Browsers without same-document View Transitions (Firefox < 144, Safari < 18) get an instant swap — identical DOM, no extra code path. `ScrollToTop` keeps working (it runs on location change, before the transition captures the new frame). Details in [04-motion-and-transitions.md](04-motion-and-transitions.md).

---

## 1. Home (`/`)

**Today:** sticky white header with the gradient logo; "Welcome to Sound Clash" (h1, 4 rem) over a gradient-text subtitle "The ultimate music trivia buzzer game"; three white cards with 72 px gradient icons ("Host a game / Join a game / Display screen") that lift 6 px and rotate their icon on hover; a ghost "How to Play ›" button.

**New:**

- **Hero.** _Amended 2026-09-20 by [09-home-colour-and-fill.md](09-home-colour-and-fill.md): the wordmark is now `size="hero"`, centred, and stacked above the mark on phones; the three rows are three coloured cards; the composition is vertically centred._ Originally: wordmark top-left (small). One editorial headline in the display face, left-aligned on desktop, e.g. **"Name the song. Buzz first."** with a single-line subhead in `--text-muted`: "Real-time music trivia for a room full of people and one TV." (copy is a proposal; see README open questions). No gradient text, no "Welcome to".
- **Role list instead of icon cards.** Three full-width rows in a single column, each a `<Link>`:

  ```
  01  Host           Pick genres, run the rounds, score the room.        →
  02  Play           Join from your phone with the code on the TV.       →
  03  Display        Put the scoreboard and the QR code on the big screen. →
  ```

  Row = index numeral in `--text-muted` (tabular), title in the display face, one-line description in the text face, arrow icon. Desktop hover (hover-capable only): row background → `--surface-2`, arrow translates 4 px. Phone: rows are 72 px tall, no hover, pressed = `scale(0.99)`. Keep the same three destinations and the `Link` order so `HomePage.test.tsx` role/name queries still resolve (names may be shortened from "Host a game" → "Host" only if the test is updated in the same PR; default: keep the current link names and put the short word in the visual title with the full phrase as the accessible name).
- **How to play** becomes a quiet text link under the list ("How it works →"), not a button.
- **Entrance.** Headline and rows stagger in (opacity + 12 px translate, 60 ms apart, 320 ms) once on first paint; not on back-navigation (View Transitions handle that).
- **Keep (behaviour):** the mount-time backend warm-up + genre prefetch.
- **Tests touched by the copy change (listed here so the PR can't miss them):** `App.test.tsx:23` (`/welcome to sound clash/i` heading), and if the link names change, `HomePage.test.tsx:13-27`, `App.test.tsx:31,37`, `tests/e2e/fixtures/manager-context.ts:43`, `manager_cleanup_yt_csp.spec.ts:189` (`/host a game/i`, `/join a game/i`, `/display screen/i`). Default: keep the accessible names.

---

## 2. Join (`/join`, `/join/:code`)

**Today:** centred white card with a rainbow top border; "Join a team"; a code input with `A B C D E F` placeholder and `0/6` counter; team-name input with `0/30`; rejoin hint; Cancel + Join game.

**New:**

- Centred column (max 420 px), no card on phone (the page *is* the card), `--surface` card on desktop. Wordmark small at top.
- **Code field.** Still ONE `<input>` (tests and the QR deep-link prefill depend on it), but the characters you see are drawn by an `aria-hidden` six-column grid stacked under it; the input itself is `opacity: 0` and covers the whole box, so focus, keyboard, paste, autofill and hit-testing all stay on the real control. Display face at 2 rem, one glyph centred per `1fr` column, dividers from `border-left` (`:first-child` gets none). Auto-uppercase stays. When the code arrives from the URL the field is pre-filled and read-only-looking (muted), as today.
  - **Built 2026-09-20 (PR #317), replacing an earlier `letter-spacing` version.** Positioning glyphs with `letter-spacing` + `text-indent` cannot hold them in fixed cells in a **proportional** face: each character advances by `glyph + tracking`, not by `1ch` (Anton at 32 px: `I` 7.3 px, `M` 23.9 px, `1ch` 15.8 px), and `letter-spacing` adds a trailing space after the last character too. So a typical code drifted out of its cells and the sixth character overflowed the field, at which point the browser scrolled the input to keep the caret visible and every glyph jumped sideways. Measured at 390 px: `ABCDEF` overflowed 15 px, `K7P2QZ` 18 px, `MMMMMM` 70 px, `IIIIII` 0 px — a content-dependent bug that a mean-width test code hides. A grid column is exactly a sixth of the field and centres whatever it holds, so there is nothing to drift and nothing to scroll: after the change, `scrollLeft` and input overflow are 0 on both pages at 390/1280 px for every code tried, worst glyph distance from its cell centre 0.50 px. Test such a field with the extremes of its own alphabet (`IIIIII` and `MMMMMM`), never just `ABCDEF`.
  - **Made editable 2026-09-20 (PR #321), and both entry screens now share `components/GameCodeField.tsx`.** #317 drew the characters correctly but left the field uneditable, in three ways that all follow from hiding an input under your own rendering: the caret stand-in was pinned to the next EMPTY cell, so arrowing back to a character showed nothing; a tap could not reach a cell, because the browser hit-tests the input's own invisible text (a different font, at the left edge of the box) rather than the grid; and a full code swallowed every keystroke, so a wrong character could not be replaced without deleting back to it. Now the indicator is drawn from the input's real `selectionStart`/`selectionEnd` — a blinking bar at the insert point, an `--accent-soft` lit cell for a selected character — a click maps to a cell by grid geometry and **selects** that character (type to replace it, Backspace to delete it: the whole fix on touch, where there are no arrow keys), and an insert into an already-full code overwrites the character at the caret rather than being dropped. **`maxLength` is deliberately gone:** WebKit truncates at it *before* dispatching any input event and hands the listener an empty `data`, so a guard built on `beforeinput` silently does nothing on Safari and iOS. The six-character cap and the overwrite both come from `lib/gameCode.ts`'s `applyEdit`, which reads the value the browser actually produced and so needs no per-engine knowledge. Backspace, Delete, arrows, Home/End, select-all, drag-select, paste and autofill stay native. Verified 38/38 in Chromium, WebKit and Firefox, and again on the deployed PR preview.
- **Team name** field unchanged in behaviour; counters (`0/6`, `0/30`) stay, styled as `--text-muted` tabular captions.
- **Primary action** is full-width on phone ("Join game"), Cancel becomes a ghost link above it. Submit spinner (`submit-spinner`) keeps its test id; visually a 16 px stroke spinner in `--accent-ink`.
- **Error** (`.error`) restyled: `--negative` text on `--negative-soft`, icon "!" kept as CSS.
- **Rejoin hint** copy kept verbatim (asserted in tests): "Already had a team? Enter the same name to rejoin and keep your score."

---

## 3. Team / buzz screen (`/team/:code`) — the hot path

**Today:** full-bleed tone background (green idle, red locked-other, blue winner, grey waiting) filling the viewport; the BUZZ button is a rounded rectangle with a gradient and a pulsing ring; identity chip top-left, standing chip top-right; label text is 6.5 rem uppercase 900.

**New (visual only — `BuzzButton.tsx`, `useBuzzer.ts` untouched):**

- **Tones become the palette's five states**, each a flat colour + matching ink (no gradients):
  `idle` = `--accent` orange with a **black** label (`--accent-ink`; white on this orange is 2.6:1 and fails contrast), `pending` = the same at `brightness(0.92)` (already handled by `.pressed`), `winner` = `--positive` green with a black label, `locked-other` = `--negative` red with a white label (large text, 4.0:1), `waiting` = `--surface-2` with `--text-muted`. Full mapping in [01-design-system.md](01-design-system.md) §2.2.
- **Tone change is an opacity crossfade, not a background transition.** The button gets a second layer (`::before`) that holds the *next* tone colour and fades in over 180 ms; this keeps the change on the compositor (today's rule transitions `background`, which repaints the whole button). `data-tone` and the tone class names stay so the vitest/e2e selectors are untouched.
- **Label** in the display face, `clamp(3rem, 14vw, 7rem)`, uppercase, tracking 0.02em; subtitle in the text face. Text-shadow removed (contrast comes from the flat tone).
- **Pulse ring** kept exactly (transform + opacity on `::after`); it is the "live" cue.
- **Pressed** = `scale(0.985)` at 0 ms + brightness 0.94 (as today); release 160 ms.
- **Winner** = a single 480 ms brightness flash (as today) plus the standing chip pulsing once when the score changes.
- **Identity chip / standing chip** restyled to `--surface` at 80 % opacity over the tone, 1 px `--border`, tabular numerals. Same test ids.
- **Point pill** (`PointChange`) keeps its spring in/out (the one place the spring easing survives) but uses `--positive`/`--negative` on `--surface`.
- **Waiting screen** gets the wordmark centred above the "WAITING" button (**built 2026-09-20**, [09](09-home-colour-and-fill.md); it had been specified here since the plan was written but never implemented) and a one-line "for the game to start" subtitle (as today).
- **Keep (behaviour):** everything — pointerdown firing, provisional lock TTL, reconciler, `data-tone`, labels, `aria-live` on the point stack.

---

## 4. Host: create (`/manager/create`)

**Today:** "Host a game" h1; six white preset pills; a "Genres (0 selected)" card of checkbox tiles; a "Release decade" card of pills; Cancel + Create game.

**New:**

- Same three sections, same order, same test ids and labels.
- **Presets** become a horizontally scrollable chip row on phone (`overflow-x: auto`, scroll-snap, no scrollbar) and a wrapped row on desktop; chips are `--surface-2` with 1 px border, selected preset = `--accent` fill.
- **Genre tiles** drop the native-checkbox look: a tile is a toggle with the genre name and a check icon that draws in (stroke-dashoffset, 160 ms) when selected; selected tile = `--accent` at 12 % with an accent border; the count "(N selected)" stays in the section title. The underlying `<input type=checkbox>`/`role` stays for the tests and for accessibility.
- **Decades** become a segmented control (one bordered row, selected segment filled).
- **Sticky action bar** on phone: "Create game" full-width at the bottom with the selected count as a caption ("3 genres · 80s, 90s"); on desktop the bar sits under the sections as today. Cancel is a ghost link.
- **Tap flash fix (#282) preserved:** hover styles stay behind `@media (hover: hover)`; `touch-action: manipulation`.
- Loading state: spinner + copy from #283 unchanged; the button shows the spinner inline.

---

## 5. Host: console (`/manager/game/:code`)

**Today:** white header card (GAME CODE / PLAYING pill / Round 1), "Backup host link" + "Reconnect a team" text links, a 16:9 YouTube strip, the round card, four score buttons, Continue/Next row, End game. Fits one phone screen (#177).

**New (layout constraints unchanged — the #177 measurements are re-run in the validation pass):**

- **Header** = one row: game code as a large tabular chip (`--surface-2`), status pill (`PLAYING`/`WAITING`/`ENDED` in the tone colours), round counter right-aligned. Below it the two utility links become icon+text ghost buttons in one row (link icon "Backup host link", refresh icon "Reconnect a team").
- **Player strip** unchanged in size logic (`clamp(116px, 19dvh, 168px)` on phones); both buffer layers stay mounted and visible. Corner radius `--radius-md`, 1 px border.
- **Round card**: song title in the display face (the host sees the answer), artist in the text face, the soundtrack badge (film icon, no emoji) inline; the `songLine` class key is kept (an e2e locator uses `[class*='songLine']`). Token chips (`token-chip-title` / `token-chip-artist`) become small pills that fill with `--accent-soft` and show a check icon when claimed. The `✓` glyph is the one test-locked glyph in the app: replacing it with the icon means updating `ManagerConsolePage.test.tsx:1521` (`/artist\s+✓/i`) and `tests/e2e/token_claim_constraints.spec.ts:31` (`toContainText("✓")`) to assert a `data-claimed="true"` attribute instead — both edits ship in the same PR. The visible "Song open" / "Artist open" text and the ids stay.
- **Score buttons** as a 2×2 grid: Correct Song and Correct Artist = `--accent` outline that fills on press; Wrong = `--negative` outline; Bonus = neutral. Soundtrack rounds show the single Correct (15) button in the same slot. Labels unchanged. Disabled = 40 % opacity, no colour change.
- **Continue / Next round** stay a 2-up row; Next is the primary (filled) button.
- **End game** stays a ghost danger link at the bottom.
- **Motion:** button press scale; toast enter/exit; token chip fill 160 ms; round counter crossfades on change (`view-transition-name` on the counter is optional; a 120 ms opacity swap is enough).
- **Expiry banner** and **Keep playing +1h** keep their ids; the banner becomes a `--warning` strip at the top of the page.

---

## 6. Display / TV (`/display`, `/display/:code`)

### 6a. Code entry (`/display`)

Same as Join's code field, on a single centred column; "Open" primary button.

### 6b. Board (`/display/:code`)

**Today:** light page; white header bar ("Sound Clash" left, code right); yellow "The Beatles buzzed in!" banner; grey reveal panel with 🎵/🎤 rows and "???"; grey token chips; a countdown bar; team rows with 🥇🥈🥉 and tinted backgrounds; a QR card at the bottom.

**New — this is the screen the whole room looks at, so it gets the most contrast and the biggest type:**

- **Layout** (≥ 769 px × ≥ 640 px, fixed TV frame, no scroll): a two-column grid — header and banner span both, then the board in an elastic left column and a sidebar holding the round card (reveal rows + token chips), the countdown and the QR panel. **As built** the sidebar is `clamp(240px, 26vw, 340px)` against the board's `minmax(0, 1fr)` rather than a 4-of-12 share: measuring the rendered board showed the standings, which are the thing the room reads, using only about 40 % of their column at 1080p, and narrowing the sidebar is what buys the rows their height. The reveal text therefore **wraps** in the sidebar (three-line cap) instead of ellipsizing on one line — a long Hebrew title does not fit a 260 px column. The grid is scoped to the live board (`.shell[data-density]`): the ended, swept and loading states of the same component render children with no grid area and would otherwise be auto-placed into the board's cells. Below 769 px the sidebar `display: contents`-unwraps and its children stack under the board, QR last (existing mobile behaviour).
- **Header**: wordmark left, game code right as a very large tabular chip (people type it from across the room).
- **Buzz banner**: full-width bar in `--accent` with the team name in the display face at 2.4–3 rem; enters by sliding down 100 % → 0 (transform) in 240 ms; the round label sits at its right edge. States (`waiting` / `playing` / `buzzed` / `ended`) keep their class keys.
- **Reveal rows**: note icon + title, mic icon + artist (film icon + film name on soundtrack rounds). Unclaimed shows a **masked placeholder** (decision 8): a row of five `--surface-2` blocks of varying width inside the row, `aria-hidden`, with a visually-hidden "Not revealed yet" for screen readers. The literal `???` text goes away, so the four vitest cases and `ten_teams_thirty_rounds.spec.ts:617,626` that assert it are rewritten in PR 9 to assert a `data-revealed="false|true"` attribute on the row (and the revealed title text). On claim the blocks fade out and the text unmasks with a left-to-right `clip-path` wipe, 320 ms. Soundtrack rounds render **one** row and normal rounds **two** — as DOM presence, never CSS-hidden (`soundtrack_playthrough.spec.ts:111-123` counts rows).
- **Token chips**: "Song · open" / "Artist · The Beatles" with a check icon when claimed; same ids (these two are unused by tests).
- **Countdown**: a 4 px `--accent` bar that scales on the X axis (transform) — never width — with the seconds as tabular numerals. The `role="timer"` element must contain **no digits other than the seconds** (`manager_cleanup_yt_csp.spec.ts:90-102` strips non-digits and expects 1–10).
- **Team rows**: the markup contract is frozen — `<ol style="--rows:N">` of `<li data-team-id data-rank>` with **exactly three `<span>` children in rank / name / score order** (five tests read them positionally). Styling: the first span becomes a numeral in a thin ring (rank 1 gets the `--accent` ring, 2–3 `--bone`, others `--border`), the second is the team name in the display face at 2 rem+, the third the score right-aligned tabular at 3 rem. The medal class keys `bigRowGold` / `bigRowSilver` / `bigRowBronze` stay (an e2e spec matches them); their `::before` emoji content is deleted. The top-5 cap, `+N more team(s) playing` (exact text), `data-density="normal"`, and `.bigRowBuzzed` stay. **Row reorder animates via `@formkit/auto-animate`** (decision 7: `useAutoAnimate` on the `<ol>`, imported only in `DisplayPage.tsx`; WAAPI transform/opacity, ~400 ms, respects reduced motion by default; it sets `position: relative` on the list, which the TV grid must tolerate) when ranks change; the score numeral counts up/down over 600 ms (display-only, requestAnimationFrame, cancelled on unmount). Score-change highlight: the row flashes `--surface-2` → `--surface` over 800 ms. The new 8 + 4 grid must still pass `display_fit.spec.ts` at all ten resolutions down to 1024×640 — moving the reveal/timer matter into the sidebar frees vertical space, which makes that easier, not harder.
- **QR panel**: `--surface` card, white-on-dark QR is *not* used (scanners want dark-on-light) — the QR sits on a white inset with the code and URL beside it. Unchanged component (`QRPanel`).
- **Ended**: the podium (§7) replaces the board with a crossfade.

---

## 7. End screen / podium (`EndScreen`, shared by team, console, display)

**Today:** three podium cards with medal numerals and a ★ crown on the winner, confetti, then the full final scoreboard (top 5, `final-scoreboard-more` hint), export buttons.

**New:**

- Three columns, centre column tallest; each card = rank numeral, team name(s) in the display face, score tabular. Ties keep listing every team in the card (issue #180 behaviour).
- ★ → a laurel/crown **line icon** above the winner card + the word "Winner" as a caption. `aria-hidden` stays; the `crown` class key stays.
- **Confetti replaced** by a restrained sequence: cards rise in staggered (120 ms apart, 400 ms), then one light sweep crosses the winner card once (a `::after` gradient moved with `transform`, 900 ms). If the maintainer wants to keep confetti, it becomes monochrome `--accent` pieces (README open question).
- Final scoreboard table and export buttons restyled with the shared components; ids unchanged; the podium does not remount across ended → swept (existing contract).

---

## 8. How to play (`/how-to-play`)

**Today:** gradient logo header, "How to Play" h1, a 2.3 MB AI-illustrated hero image, then step flows with numbered cards and a 🔊 audio note.

**New:**

- Same content and order. The hero image is **replaced by a three-column SVG schematic** (Host phone · TV · Player phones as simple line drawings with the code "ABCDEF" and a BUZZ tile) built from the icon set, or removed entirely (README open question — recommendation: replace; it is the single most "AI-generated" element on the site and costs 2.3 MB). `HowToPlayPage.test.tsx:82` asserts the `img` alt `/three-screen setup/i` **and** `src="/how-to-play-hero.png"` — the inline SVG keeps `role="img"` + the same accessible name, and the `src` assertion is dropped in the same PR.
- Steps become a numbered list with a vertical rule; the "Setup / Play" phase labels stay. The step numerals 1–7 must remain the **only** bare digits 1–7 on the page (`getByText("1")`…`("7")` are unique-match).
- 🔊 → speaker icon.

---

## 9. Admin songs (`/admin/songs`)

Internal tool. Inherits the tokens, fonts, and button/input restyle automatically via `styles.css`; no bespoke work, no test changes expected beyond snapshot-free assertions. Verified by `AdminSongsPage.test.tsx` and `admin_songs_crud.spec.ts`.

---

## 10. Copy changes proposed (all optional, decided in README)

| Where | Today | Proposed |
|---|---|---|
| Home h1 | Welcome to Sound Clash | Name the song. Buzz first. |
| Home subtitle | The ultimate music trivia buzzer game | Real-time music trivia for a room full of people and one TV. |
| Home links | Host a game / Join a game / Display screen | Host / Play / Display (visual) — accessible names unchanged unless tests are updated |
| Home footer | How to Play › | How it works → |
| index.html description / OG | "Real-time multiplayer music trivia. Buzz in, name the tune, win the round." | unchanged |

Everything else (BUZZ labels, manager button labels, join/create copy, rules text) stays verbatim.
