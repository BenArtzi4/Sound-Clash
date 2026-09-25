# Home — colour, warm ground, and the diagonal fill

_Status: agreed 2026-09-20. Amends [05-page-by-page.md](05-page-by-page.md) §1 (Home) and §5 (Team), [01-design-system.md](01-design-system.md) §2 (colour) and §9 (banned list), and [08-final-validation.md](08-final-validation.md) §E.4's Home row. This is the spec and the build plan for one PR._

## Why

Post-redesign, Home was the least designed page in the app: a 20 px wordmark in the corner while the headline ran at 52 px, a `14ch` headline floating in a 1052 px column, ~196 px of dead space at the bottom on a 1440×900 desktop, and **zero accent colour anywhere** — while How to play already shipped orange chips, green and red score chips, cards and icons.

The maintainer asked for three things: the wordmark bigger and centred, the page happier but still professional, and more colour than "black and white with a bit of grey".

Three research passes informed the choices — a computed-style census of 44 live dark sites, a party-game/music-product survey, and a CSS-techniques pass. Four findings shaped this document:

1. **Tinted fills barely exist on black.** 10 % orange over `#000` composites to `#1A0C00` — **1.10:1**. Colour belongs on edges, marks and knockouts, not fills.
2. **No measured product ships pure `#000` as a visible ground** — Jeopardy `#121319`, Jackbox `#1A1F26`, Rockstar Bingo `#161519`, Spotify `#191414`, Linear `#08090A`, Sofar `#1C1C1C`. Sound Clash was alone.
3. **Pure `#000` with pure `#FFF` and nothing between is a recognised "unfinished" tell.** The app already ships the cream to fix it (`--bone`) and simply wasn't using it for headlines.
4. **`#FF7A00` is `OKLCH(0.723 0.190 50.5)`** — so near the sRGB edge that four of five hue-rotated siblings at equal L and C fall outside the gamut. The palette must be **hierarchical, not egalitarian**; a balanced ring of role colours is not reachable.

## What changes

### Colour (`01-design-system.md` §2.1 amended)

| Token | Was | Now | Why |
|---|---|---|---|
| `--bg` | `#000000` | `#14120e` | Finding 2. Warm near-black. Lift over pure black is 1.12:1 — imperceptible as brightness, felt as warmth. |
| `--surface` | `#121111` | `#1d1a14` | Steps up from the new ground by 1.08:1. |
| `--periwinkle` | — | `#a9b4ff` | **The only genuinely new colour.** 8.81:1 on the card. |
| `--role-host` | — | `var(--accent)` | Role alias, so the decorative use is named rather than implied. |
| `--role-play` | — | `var(--positive)` | Reuses the existing green; see below. |
| `--role-display` | — | `var(--periwinkle)` | |

`--text` stays `#ffffff` as a token, but **Home's headings use `--bone`** (finding 3). Everything else is unchanged; `--accent` and `--accent-ink` stay frozen at `#ff7a00` / `#000000`, which `redesign_guards.spec.ts` asserts.

**Why `--positive` and not a new mint.** Mint `#5BE7A9` and `--positive #4ADE80` are **ΔE 17.8 apart in normal vision** — indistinguishable, so shipping both would put two near-identical greens in the token file and guarantee the wrong one gets used later. Reusing `--positive` under the alias `--role-play` keeps one green and names the decorative intent.

**Why not butter.** The first draft used butter `#FFC94A` for Play. It collapses with orange under deuteranopia — **ΔE 18.0**, against a ~25 threshold — so Host and Play would have read as the same colour for roughly 8 % of men.

Verified separation of the shipped trio (worst case across protanopia, deuteranopia, tritanopia):

| Pair | Worst ΔE |
|---|---|
| orange vs `--positive` | 30.9 |
| orange vs periwinkle | 103.2 |
| `--positive` vs periwinkle | 67.1 |

Contrast on the new ground `#14120E`: cream **14.75:1**, `--text-muted` **7.96:1**. On the new card `#1D1A14`: orange **6.64:1**, `--positive` **9.96:1**, periwinkle **8.81:1**. Black on each hue (the fill state): **8.04:1**, **12.05:1**, **8.81:1**.

### Home (`05-page-by-page.md` §1 amended)

The page was specified as "wordmark top-left (small)" with "three full-width numbered role rows 01/02/03". Both change.

- **Hero wordmark.** `<Logo size="hero">`, centred, mark beside the text on desktop and **stacked above it on phones**. Stacking is not cosmetic: measured, the side-by-side lockup caps at ~44 px on a 360 px phone before it overflows, while stacking removes the mark from the governing width and allows ~56 px.
- **Headline** drops from `--text-display-m` to a smaller step so the hierarchy reads wordmark → headline → subhead. Copy is unchanged: `App.test.tsx` requires the `<h1>` to match `/name the song/i`.
- **Three role cards** replace the numbered rows — a 3-up grid on desktop, a compact icon+text row on phones. Each carries a 3 px left rule and a matching icon in its role hue.
- **Vertical centring** on desktop, which is what removes the dead space.
- The header element and its small wordmark are deleted; the reassurance line trialled during design is **not** shipped.

The numbered `01/02/03` markers go. Per the design-system principle that structural devices must encode something true, three peer entry points are not a sequence — the numbering implied an order that does not exist.

**Known departure from §9.** The banned list includes "centred-everything layouts on desktop". This page is now centred. The maintainer asked for the centred wordmark explicitly and approved the centred composition; §9 is amended to scope that ban to content pages rather than the landing page.

### The hover fill

The card flips to its hue with black type — but the colour **travels in** rather than switching on.

Each card holds **two stacked copies of itself**: the normal face, and an inverted copy on the hue with black type, `aria-hidden`. Only the inverted copy is clipped. The ink therefore flips exactly at the wipe edge instead of cross-fading, which a `background-color` transition cannot do.

Geometry is a **diagonal sweep**, 200 ms:

```css
clip-path: polygon(0 0, 0 0, -34% 100%, -34% 100%);              /* rest */
clip-path: polygon(0 0, 134% 0, 100% 100%, -34% 100%);           /* filled */
```

Both states carry four vertices, which is what makes them interpolate. The leading edge starts fully off the left side, so no corner pops in.

Only `clip-path` animates — on the allowed list, compositor-only, no layout.

**Touch.** _Superseded 2026-09-25 by [10-touch-and-route-motion.md](10-touch-and-route-motion.md): touch and pen now get a ripple from the finger, the sweep is mouse-only, and the hover rule is gated on `(hover: hover) and (pointer: fine)`._ Phones get the same fill on `pointerdown`, retracting on release, driven by a `data-tapped` attribute rather than `:hover`, and at **100 ms rather than 200 ms** (`--fill-dur`, overridden under `@media (hover: none)`). _Amended 2026-09-20 after the maintainer tried it on a real phone._ A pointer rests on a card for as long as the user likes, so 200 ms of travel reads as deliberate; a tap is over in ~80-120 ms, so the same 200 ms reads as lag chasing the finger. Keyed on `(hover: none)` rather than a width, because it is the absence of hover — not a narrow screen — that makes the fill press-driven. A class cannot leave a card stuck coloured after a tap — the sticky-hover failure this repo already hit on the decade pills (PR #282).

**Reduced motion.** The global block zeroes the transition, so the fill snaps rather than disappearing. The end state still applies; only the travel is removed.

### Team waiting screen (`05-page-by-page.md` §5)

`05:86` specifies "the wordmark centred above the WAITING button" and it was never built. It ships here. `Logo.module.css` already carries `:global([data-round-live="true"]) .animated svg path { animation-play-state: paused }` — a rule that only makes sense with a Logo on this page, and which moves the bars to `playState: "paused"`. `redesign_guards.spec.ts` filters on `"running"`, so the running count during a live round stays **0**. Verified in a browser before writing this.

---

## Build plan

### Global constraints

Copied verbatim; every task inherits them.

- No `gradient(` of any kind. Swept by `rg -n "gradient\(" frontend/src -g '*.css'` and by a runtime audit reading `backgroundImage`.
- No `backdrop-filter`. No `box-shadow` on a resting element. No `translateY(-6px)` lift, no `rotate(`. No `transition: all`.
- **Every `:hover` rule must sit inside `@media (hover: hover)`** — `hover-guard.mjs` fails the build otherwise, *including* `:hover` rules inside a reduced-motion block. Use `@media (prefers-reduced-motion: reduce) and (hover: hover)` there.
- Only `transform`, `opacity`, `filter`, `clip-path`, `visibility` may animate.
- Frontend gate: `npm run lint`, `npx prettier --check "src/**/*.{ts,tsx,css}"`, `npm run typecheck`, `npm run test:coverage` (lines 85 / branches 80 / functions 85 / statements 85). CI runs Prettier as a **separate step** from lint.
- Contracts that must not break: the three links' accessible names `/host a game/i`, `/join a game/i`, `/display screen/i` with literal hrefs `/manager/create`, `/join`, `/display`; a link `/how to play/i` → `/how-to-play`; the `<h1>` matching `/name the song/i`; Logo's DOM text exactly `"Sound Clash"` with `view-transition-name: wordmark` on an ancestor and an inline `<svg>`; Home → Host must still call `startViewTransition`.

### Task 1 — tokens and the ground

**Files:** `frontend/src/styles.css`, `frontend/src/styles.test.ts`, `frontend/index.html`, `tests/smoke/ui_prod_pass.mjs`

1. `styles.css`: `--bg: #14120e`, `--surface: #1d1a14`, add `--periwinkle: #a9b4ff` and the three `--role-*` aliases.
2. `styles.test.ts:14`: `"--bg: #000000"` → `"--bg: #14120e"`; `--surface` likewise. Add an assertion for `--periwinkle`.
3. `index.html:10`: `theme-color` `#000000` → `#14120e`.
4. `ui_prod_pass.mjs:105`: the theme gate expects `#000000` → `#14120e`. `:107`: the marker `--bg:#000` → `--bg:#14120e`.
5. Run `npm run test:run -- styles.test.ts`, then the full suite. Commit.

### Task 2 — the hero wordmark

**Files:** `frontend/src/components/Logo.tsx`, `Logo.module.css`, `Logo.test.tsx`

1. Add `"hero"` to the `size` union.
2. `Logo.module.css`: `.hero { font-size: clamp(3.25rem, 6vw, 5.5rem) }`, and under `@media (max-width: 600px)` make `.hero` stack (`flex-direction: column; gap: 0.1em; font-size: clamp(2.75rem, 13vw, 3.75rem)`). Size stays on the root so the mark's `1.15em` and the `0.45em` gap scale with it — the Task 3 lesson.
3. Extend `Logo.test.tsx` for the new size. Commit.

### Task 3 — Home

**Files:** `frontend/src/pages/HomePage.tsx`, `HomePage.module.css`, `HomePage.test.tsx`

1. Delete the `<header>` and its `<Logo size="small">`; render `<Logo size="hero">` inside `.hero`.
2. Each role renders its content twice — once in `.face`, once in an `aria-hidden` `.fill`.
3. Add `data-role="host|play|display"` for the per-card hue, and the four pointer handlers for `data-tapped`.
4. CSS per the spec above: grid of three on desktop, compact rows on phone, the diagonal clip at 200 ms, all `:hover` inside `@media (hover: hover)`.
5. Extend `HomePage.test.tsx`: the three accessible names and hrefs still resolve **uniquely** despite the duplicated content, and the `data-role` attributes are present. Commit.

### Task 4 — Team waiting screen

**Files:** `frontend/src/pages/TeamGameplayPage.tsx`, `TeamGameplayPage.module.css`

Render `<Logo size="medium">` above the buzz zone, visible only while `game.status !== "playing"`. Commit.

### Task 5 — docs and changelog

**Files:** `01-design-system.md`, `05-page-by-page.md`, `08-final-validation.md`, `CHANGELOG.md`

### Task 6 — verify

1. Full frontend gate.
2. `rm -rf frontend/dist-local` before linting — eslint still walks it (standing trap).
3. Open the PR, then check the **per-PR preview** at `https://pr-<N>.sound-clash.pages.dev`: measure the wordmark and page fit at 360×640, 375×667, 390×844, 1440×900, 1920×1080; confirm no horizontal overflow; confirm the fill runs and the tap flash works.
4. Merge, then `node tests/smoke/ui_prod_pass.mjs all` (sandbox disabled) once the deploy is green.
