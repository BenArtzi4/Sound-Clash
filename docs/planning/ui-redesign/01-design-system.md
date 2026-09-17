# UI redesign — design system

_Status: draft for maintainer review (2026-09-17). Companion to [README.md](README.md). This file is the source of truth for tokens, type, colour, components and iconography. Page-level application is in [05-page-by-page.md](05-page-by-page.md); motion in [04-motion-and-transitions.md](04-motion-and-transitions.md)._

## 1. The reference: Rogue Studio (rogue.studio) — and why

The maintainer asked for one site from the Barba.js showcase to anchor the look and the palette. The research pass (2026-09-17) enumerated all 80 showcase entries, found 66 still live, loaded 12 in a real browser to read computed colours and fonts, and measured WCAG contrast on every candidate accent. The pick is **Rogue Studio** — https://rogue.studio — for four reasons:

1. **It is a complete, transferable system, not one pretty screen.** A pure-black ground, a warm cream neutral (`#E9E4D9` / `#B4A88F`) as the *third* tone between black and white, one saturated orange (`#FF7A00`), and a poster-typography hierarchy: a fat condensed display face for the few words that matter, and a small tracked grotesk for metadata. That is the vocabulary of gig posters and record sleeves — the register a music game should live in — and it is the opposite of the "one geometric sans at three sizes on a blue gradient" look that reads as AI-generated.
2. **It measures well for our two hardest surfaces.** Orange on black is 8.0:1; cream on black is 16.6:1; muted cream on black is 8.9:1. A BUZZ button in that orange is legible from across a dim room; a scoreboard in cream on black is legible from a sofa. (The runner-up, Wolf & Whale, is beautiful on a laptop but its electric blue is 2.45:1 on black — invisible on a TV.)
3. **Its motion is disciplined and library-free.** Rogue's own CSS uses two easings for almost everything, four duration tiers, delay-based stagger, and animates only `transform`/`opacity` with `will-change` — no `clip-path`, no canvas, no WebGL. That is exactly the budget our buzz path can afford, and it maps one-to-one onto CSS Modules + tokens.
4. **The warm black avoids the cold "dark mode default".** Near-black `#121111` surfaces with a cream text tint look designed rather than toggled, and pure `#000` is free on OLED phones.

Runners-up, kept as secondary references: **Studio MOTIO** (black + electric mint `#00FFD3` at 16:1 — the best single accent in the showcase, but a thinner system and a colour that is becoming its own cliché) and **jaro.io** (the best phone-sized type hierarchy: huge headline / mid-grey body / tiny tracked label). Anti-references from the same showcase — what we are explicitly *not* doing: Qode Kaleidoscope (pastel lavender + rainbow), Viens-là (peach gradient + brush script), Studio KINO (cream ground + hairline type).

**One deliberate departure from Rogue:** Rogue runs four type roles (condensed display, display serif, italic serif, grotesk). An app UI cannot carry four; we use **two** (condensed display + grotesk UI) and keep the serif italic as an *optional* single-use flourish for the Home tagline, decided in the README's open questions. Default: two faces.

## 2. Colour

Dark only. The app sets `<meta name="color-scheme" content="dark">` and `theme-color` `#000000`; there is no light theme (a light theme would double every visual test for a product used in dim rooms — this also delivers the approved X-DarkRoom idea, issue #243, as the base theme rather than a toggle).

### 2.1 Core tokens (`styles.css` `:root`)

| Token | Value | Role | Contrast on `--bg` |
|---|---|---|---|
| `--bg` | `#000000` | page ground, all roles | — |
| `--surface` | `#121111` | cards, panels, board rows | — |
| `--surface-2` | `#1C1A17` | hover/pressed rows, chips, input backgrounds, waiting tone | — |
| `--border` | `rgba(233, 228, 217, 0.14)` | 1 px hairlines | — |
| `--border-strong` | `rgba(233, 228, 217, 0.32)` | focused/selected outlines | — |
| `--text` | `#FFFFFF` | primary text, team names, labels | 21.0:1 |
| `--text-muted` | `#B4A88F` | captions, metadata, round labels, counters | 8.9:1 |
| `--text-dim` | `rgba(255, 255, 255, 0.42)` | disabled text | 4.6:1 |
| `--accent` | `#FF7A00` | BUZZ idle, primary button, live indicator, rank-1 ring | 8.0:1 |
| `--accent-ink` | `#000000` | text ON `--accent` (white on orange is 2.6:1 and fails — **never white on orange**) | 8.0:1 |
| `--accent-soft` | `rgba(255, 122, 0, 0.14)` | selected tile fill, focus halo | — |
| `--bone` | `#E9E4D9` | big numerals (scores), secondary accent, wordmark on dark | 16.6:1 |
| `--positive` | `#4ADE80` | correct / winner / success | 12.1:1 |
| `--positive-ink` | `#000000` | text on `--positive` | 12.1:1 |
| `--negative` | `#F2352B` | wrong / locked-by-other / destructive | 5.3:1 |
| `--negative-ink` | `#FFFFFF` | text on `--negative` — **large text only** (≥ 24 px, 4.0:1); small text uses `--negative` on `--surface` (4.7:1) | — |
| `--warning` | `#F6CC00` | expiry banner, "last 20 minutes" | 16.4:1 |
| `--warning-ink` | `#000000` | text on `--warning` | — |

Rules:

- **Orange is the buzzer's colour.** It is not used for "correct" and never sits next to `--negative` red in the same component (they converge across a room). The manager's Wrong button is red *and* outlined with an icon; Correct is green.
- **No gradients, anywhere.** Not on backgrounds, not on buttons, not on text. Depth = one surface step + one hairline.
- **No drop shadows on resting elements.** `--shadow-modal: 0 24px 64px rgba(0,0,0,0.6)` exists for modals and toasts only.
- **No blur / glassmorphism.** `backdrop-filter` is removed from the header.

### 2.2 Semantic mappings

| UI state | Fill | Ink |
|---|---|---|
| BUZZ `idle` | `--accent` | `--accent-ink` |
| BUZZ `pending` | `--accent` at `filter: brightness(0.92)` | `--accent-ink` |
| BUZZ `winner` | `--positive` | `--positive-ink` |
| BUZZ `locked-other` | `--negative` | `--negative-ink` (label is ≥ 3 rem) |
| BUZZ `waiting` | `--surface-2` | `--text-muted` |
| Status pill WAITING / PLAYING / ENDED | outline `--bone` / fill `--positive` / outline `--text-muted` | matching |
| Correct Song / Correct Artist / Correct (soundtrack) | outline `--positive`, fills on press | `--positive` → `--positive-ink` |
| Wrong | outline `--negative` + icon | `--negative` |
| Bonus | outline `--bone` | `--bone` |
| Next round / Start game / Create / Join / Open (primary) | `--accent` | `--accent-ink` |
| Continue round / Cancel (secondary) | `--surface` + `--border` | `--text` |
| End game (danger ghost) | none | `--negative` |
| Token chip open / claimed | `--surface-2` + `--border` / `--accent-soft` + `--accent` border | `--text-muted` / `--text` |
| Board rank 1 / 2–3 / 4–5 | ring `--accent` / ring `--bone` / ring `--border` | `--bone` numerals |
| Score numerals (Display) | — | `--bone` |
| Point pill + / − | `--surface` + `--positive` border / `--negative` border | `--positive` / `--negative` |
| Expiry banner | `--warning` | `--warning-ink` |
| Error inline | `rgba(242,53,43,0.12)` + `--negative` border | `--negative` |

## 3. Typography

### 3.1 Faces (all OFL, self-hosted as woff2 under `frontend/public/fonts/`)

| Role | Face | Why | Files |
|---|---|---|---|
| **Display** — wordmark, BUZZ label, h1/h2, scores, game code, rank numerals | **Anton** (400 only) | The open stand-in for Rogue's Druk Condensed: fat, condensed, uppercase-friendly; digits are near-uniform width so scores don't jitter | `anton-latin.woff2` (~25 KB) |
| **Display · Hebrew fallback** | **Secular One** | Hebrew display face of matching weight; also carries Latin so mixed titles stay one weight | `secular-one-hebrew.woff2` (~30 KB) |
| **UI** — body, buttons, inputs, captions, table text | **Instrument Sans** (variable 400–700) | Closest open neo-grotesk to Rogue's PP Neue Montreal; neutral, tabular figures available | `instrument-sans-latin-var.woff2` (~40 KB) |
| **UI · Hebrew fallback** | **Heebo** (400, 700) | Hebrew coverage for team names typed in Hebrew and Hebrew song metadata in UI text | `heebo-hebrew.woff2` (~20 KB) |
| *(optional)* **Editorial** — Home tagline only | **Instrument Serif** italic | Rogue's Swear Cilati role; one line on one page | `instrument-serif-italic-latin.woff2` (~20 KB) |

Stacks:

```css
--font-display: "Anton", "Secular One", Impact, "Arial Narrow Bold", sans-serif;
--font-ui:      "Instrument Sans", "Heebo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-serif:   "Instrument Serif", "Suez One", Georgia, serif;   /* optional */
--font-mono:    ui-monospace, "SF Mono", Menlo, monospace;         /* code field only */
```

Hebrew handling: the Latin faces contain no Hebrew glyphs, so the browser falls through per-run to Secular One / Heebo automatically — a Hebrew song title inside an LTR row renders in the Hebrew face at the same optical weight. Elements that show catalog text (`song_title`, `song_artist`, team names) get `dir="auto"` so punctuation and mixed-script titles order correctly. This is not the vetoed RTL UI (D-6) — the interface stays LTR; only the text runs are bidi-aware.

Loading: `@font-face` with `font-display: swap` for UI faces and `font-display: optional`-style behaviour avoided for the display face because the BUZZ label must never render in a fallback then swap mid-round — instead the display face is **preloaded** (`<link rel="preload" as="font" type="font/woff2" crossorigin>` in `index.html`) so it is resolved before first paint on any realistic connection. `unicode-range` subsets keep each file small. `_headers` gets `/fonts/*  Cache-Control: public, max-age=31536000, immutable` (file names carry a version suffix). CSP needs **no change**: with no `font-src`, fonts fall back to `default-src 'self'`, which allows same-origin files.

Budget: ≤ 5 files, ≤ 150 KB total (≤ 120 KB without the optional serif). Each font file is a binary asset → confirmed with the maintainer before commit (rule D-9).

### 3.2 Scale

| Token | Size | Face / weight | Use |
|---|---|---|---|
| `--text-display-xl` | `clamp(3rem, 14vw, 7rem)` | Anton, uppercase, tracking 0.02em, line-height 0.95 | BUZZ label |
| `--text-display-l` | `clamp(2.5rem, 5vw, 4.5rem)` | Anton, tabular | Display scores, game code on the TV |
| `--text-display-m` | `clamp(2rem, 4vw, 3.25rem)` | Anton | h1 (Home headline, Host a game, Join) |
| `--text-display-s` | `clamp(1.5rem, 2.5vw, 2.125rem)` | Anton | h2, board team names, podium names, buzz banner |
| `--text-title` | `1.125rem` | Instrument Sans 600 | card titles, button labels |
| `--text-body` | `1rem` / 1.5 | Instrument Sans 400 | body, inputs |
| `--text-caption` | `0.75rem` (12 px floor) | Instrument Sans 500, uppercase, tracking 0.08em | section labels ("QUICK START", "GAME CODE"), metadata, counters |

Rogue sets micro-labels at 7–12 px; our floor is 12 px — phones at arm's length and TVs at three metres do not forgive smaller. Numbers that change (scores, counters, timers) always get `font-variant-numeric: tabular-nums`.

## 4. Space, radius, lines

```css
--space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
--space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;

--radius-xs: 4px;    /* chips, tags */
--radius-sm: 8px;    /* inputs, small buttons */
--radius-md: 16px;   /* cards, panels — Rogue's default */
--radius-lg: 24px;   /* sheets, modals */
--radius-pill: 9999px;
```

The existing `--space-xs…2xl` and `--radius-sm/md/lg` names are kept as aliases for one release so untouched CSS keeps compiling; the BUZZ button's 28 px radius becomes `--radius-lg`.

Lines, not shadows: cards and rows are separated by 1 px `--border`. Section rules are 1 px `--border`. Focus is a 2 px `--accent` `outline` with 2 px `outline-offset` (visible on black, not a glow).

## 5. Components

| Component | Spec |
|---|---|
| **Wordmark** (`Logo.tsx`) | Text "SOUND CLASH" in `--font-display`, `--bone`; a 4-bar equaliser mark in `currentColor` (bars animate `scaleY`, paused during a playing round on the team page and under reduced motion). Sizes: `small` (header, 1.25 rem), `large` (hero / fallback, 2.5 rem). No gradient, no multi-colour bars. |
| **Buttons** (`.btn` roles unchanged) | Height 48 px (44 px min tap target); `--radius-sm`; label `--text-title`; primary `--accent`/`--accent-ink`; secondary `--surface` + `--border`; ghost text-only; danger outlined `--negative`. Pressed `scale(0.98)` at 0 ms. Disabled opacity 0.4. Hover only under `(hover: hover)`. |
| **Big action buttons** (manager score grid) | 2×2 grid, min-height 64 px, icon + label, outlined by tone (§2.2), fill on `:active`. |
| **Inputs** | `--surface-2` fill, 1 px `--border`, `--radius-sm`, 48 px tall; focus = `--accent` outline. Caption label above in `--text-caption`. Counter (`0/6`) right-aligned in `--text-muted`. |
| **Code field** | One `<input maxLength=6>`; `--font-display` 2 rem, `letter-spacing: 0.6em`, uppercase, centred; six cells drawn with `repeating-linear-gradient` on the background; placeholder `------` in `--text-dim`. |
| **Chips / pills** | `--radius-pill`, 36 px tall, `--surface-2` + `--border`; selected = `--accent-soft` + `--accent` border + check icon. Used for presets, decades, token state, status. |
| **Toggle tiles** (genres) | `--surface` + `--border`, `--radius-md`, 56 px min height; selected = `--accent-soft` + `--accent` border; the check icon draws in. The native checkbox stays in the DOM (visually hidden) for tests and assistive tech. |
| **Cards / panels** | `--surface`, 1 px `--border`, `--radius-md`, padding `--space-5`. No shadow. |
| **Board row** (Display) | 72–96 px tall; rank ring (40 px circle, 2 px ring by rank), team name `--text-display-s` in `--text`, score `--text-display-l` in `--bone`, tabular. Top-1 row gets a 3 px `--accent` left rule. |
| **Banner** (Display buzz / status) | Full-width bar; `--accent` fill + `--accent-ink` text when a team has buzzed; `--surface-2` when waiting; text `--text-display-s`. |
| **Reveal row** (Display) | Icon (note / mic / film) + text; masked state = five `--surface-2` blocks; claimed = text in `--text`, wiped in. |
| **Point pill** | As today, restyled: `--surface`, 2 px tone border, delta in `--font-display`. |
| **Toast** | `--surface`, `--border`, 3 px tone bar (accent / positive / negative), `--shadow-modal`. |
| **Modal** | `--surface`, `--radius-lg`, `--shadow-modal`, backdrop `rgba(0,0,0,0.7)`. |
| **Skeleton** | `--surface-2` blocks, opacity pulse. |
| **QR panel** | QR on a `--bone` inset (`--radius-sm`) — scanners want dark-on-light — code and URL beside it in `--font-display` / `--text-caption`. |
| **Podium card** | `--surface`, `--border`; rank numeral `--font-display` in `--bone`; winner card gets the `--accent` rule and the laurel icon. |

## 6. Iconography (replaces every emoji)

A single file `components/icons.tsx` exporting small React components; each is a 24×24 SVG, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.75"`, `stroke-linecap="round"`, `aria-hidden="true"`. Sized by the parent's `font-size` (`width: 1em`). Hand-drawn, not from an icon library (no dependency; ~14 icons):

| Icon | Replaces / used for |
|---|---|
| `NoteIcon` | 🎵 Display title row |
| `MicIcon` | 🎤 Display artist row; Host role |
| `FilmIcon` | 🎬 Soundtrack badge + soundtrack reveal row |
| `SpeakerIcon` | 🔊 How-to-play audio note |
| `CheckIcon` | ✓ token chips, "Copied", selected tiles |
| `LaurelIcon` | ★ podium winner |
| `RankBadge` (numeral in ring) | 🥇🥈🥉 board ranks |
| `ArrowRightIcon` / `ArrowLeftIcon` | › and ← |
| `PhoneIcon`, `TvIcon`, `HostIcon` | Home role rows, How-to-play schematic |
| `LinkIcon`, `RefreshIcon`, `QrIcon`, `CloseIcon` | console utility links, modal close |
| `EqualizerMark` | the wordmark's four bars |

Rules: never a coloured or gradient icon; never an icon without an adjacent text label except the modal close (which has `aria-label`).

## 7. Imagery

- The 2.3 MB AI-illustrated `how-to-play-hero.png` is replaced by an inline SVG schematic (three simplified devices: host phone with score buttons, TV with "ABCDEF" + board, player phone with a BUZZ tile) drawn in the icon style, or removed. Recommendation: replace.
- `og-image.jpg` and the PWA icons (`icons/*.png`, gradient equaliser) should be regenerated to the new wordmark/palette from `tools/og-image/` as a follow-up PR (binary assets, D-9 confirmation). Not blocking.
- The favicon (inline SVG in `index.html`) becomes the monochrome equaliser mark in `--bone` on black.

## 8. Layout & breakpoints

Keep the existing breakpoints so no responsive contract moves: `480`, `600`, `768/769` (TV fixed frame on Display), `1100`. Content max-width 1100 px; Display grid 12 columns at ≥ 769 px (8 board / 4 sidebar). Phones use `dvh` where the console already does. Side gutters ≥ 16 px at every width.

## 9. What "professional, not generic" means here — the banned list

- Gradient text, gradient buttons, gradient backgrounds, rainbow rules.
- Purple→pink or blue→cyan "startup" colour pairs.
- Emoji as icons or decoration.
- Glassmorphism (`backdrop-filter`), glow shadows, drop shadows on cards.
- "Welcome to …" headlines; centred-everything layouts on desktop.
- Hover lifts (`translateY(-6px)`), icon rotations, spring bounce on hover, `transition: all`.
- Illustrated AI hero art; stock-photo heroes.
- Rounded 20 px cards with 2 px pastel borders as the default container.
- More than two type faces on one screen (serif flourish excepted, once).
