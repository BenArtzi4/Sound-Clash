# UI redesign — motion & transitions

_Status: draft for maintainer review (2026-09-17). Companion to [README.md](README.md). Library verdicts are in [03-library-evaluation.md](03-library-evaluation.md); this file says **what** moves, **when**, **how long**, and **with which technique**, so every animation can be checked against the validation plan._

## 1. Principles (the five rules every animation must pass)

1. **Motion explains, never decorates.** Every animation answers "what just changed and where did it go?" — a page replaced another, a team moved up the board, a token was claimed, a score changed. Anything that does not carry that information (background drift, hover wiggles, icon rotations) is removed.
2. **Compositor only.** Animate `transform`, `opacity`, `filter`, `clip-path`. Never `width`, `height`, `top`, `left`, `margin`, `padding`, `background-position`, or `box-shadow` on anything that can be on screen during a round. The validation pass audits `document.getAnimations()` for this.
3. **Fast and asymmetric.** Enter is slower than exit (the eye needs to find new content, not watch old content leave). Pressed feedback is 0 ms; user-triggered state changes ≤ 250 ms; arrivals ≤ 400 ms; only one-shot reveals go longer (score count-up 600 ms, podium rise 800 ms). Route transitions are capped at 240 ms because a running view transition suspends hit-testing (see §4).
4. **The buzz path owns the frame budget.** On the team page the only continuous animation is the button's pulse ring (already composited). No new continuous animation may run on `/team/:code`. Tone changes, chips, and pills animate for ≤ 200 ms and then stop.
5. **Reduced motion is a first-class mode, not an afterthought.** The global `prefers-reduced-motion: reduce` rule stays and is extended to route transitions (`::view-transition-*` animations set to `none`). Every screen must be fully usable with zero motion; nothing is revealed *only* by an animation.

## 2. Timing & easing tokens (added to `styles.css`)

The tiers and the two workhorse easings are lifted from the reference site's own stylesheet (Rogue Studio uses `cubic-bezier(.645,.045,.355,1)` and `cubic-bezier(.155,.055,.14,1)` for ~440 of its transitions, with a reserved overshoot curve for the few things meant to feel physical — see [01-design-system.md](01-design-system.md) §1).

```css
:root {
  --dur-instant: 0ms;      /* press-in */
  --dur-micro:   150ms;    /* hover, focus ring, chip fill, counter swap, press release */
  --dur-state:   250ms;    /* tone crossfade, toggle, toast enter, banner in */
  --dur-route:   240ms;    /* page crossfade — capped by the hit-testing freeze */
  --dur-enter:   400ms;    /* element enter, reveal wipe, FLIP reorder */
  --dur-reveal:  600ms;    /* score count-up */
  --dur-intro:   800ms;    /* first-paint stagger, podium rise (one-shot) */

  --ease-move:      cubic-bezier(0.645, 0.045, 0.355, 1);  /* symmetric: moves that go and return (route, FLIP, toggles) */
  --ease-arrive:    cubic-bezier(0.155, 0.055, 0.14, 1);   /* fast attack, long settle: enters, reveals, count-ups */
  --ease-exit:      cubic-bezier(0.4, 0, 1, 1);            /* exits */
  --ease-overshoot: cubic-bezier(0.075, 0.82, 0.17, 1.34); /* RESERVED: buzz press release, buzz lock, point pill */
}
```

Only these four easings exist; a PR that adds a fifth needs a reason in its description. The existing `--easing-spring` token is kept as an alias of `--ease-overshoot` for one release so untouched CSS keeps compiling, then removed. Stagger is expressed with a per-item `--i` custom property and `animation-delay: calc(var(--i) * 60ms)`, never with extra keyframes.

## 3. Technique map

| Technique | Dependency | Used for | Fallback |
|---|---|---|---|
| **CSS transitions** on tokens above | none | hover/press/focus, tone crossfade, chip fill, toggles, countdown bar scale | none needed |
| **CSS `@keyframes`** | none | pulse ring, first-paint stagger, reveal wipe, banner slide, podium rise, light sweep, skeleton pulse | none needed |
| **`@starting-style`** (+ `transition-behavior: allow-discrete` on `visibility`/`opacity` only) | none | toast / modal / banner **enter** without JS; **exit** via an `exiting` state flag + timeout (Firefox does not transition `display`, so exits never depend on it) | Older browsers: element appears/disappears instantly — acceptable |
| **View Transitions API** via a hand-written `useViewTransitionNavigate()` hook + `TransitionLink` wrapper | none | route changes; the wordmark kept in place via `view-transition-name` | Firefox < 144 / Safari < 18: instant swap, same DOM. Feature-detect `document.startViewTransition` in the hook; **no polyfill**. **Every WebKit browser (Safari, all of iOS) also takes the instant swap since 2026-09-22**: Playwright's WebKit 26.5 crashed the page on a transition into a lazy route taller than the viewport (final validation F-04), so the hook bails out when `navigator.vendor` is `Apple Computer, Inc.` until a real device proves the engine clean. Note: react-router's own `viewTransition` prop is a silent no-op under this app's declarative `<BrowserRouter>` ([03](03-library-evaluation.md) §2.1), hence the hook |
| **`@formkit/auto-animate`** (`useAutoAnimate` on the board `<ol>`) | **one approved dependency** (decision 7): 3.2 kB gzip, zero transitive deps, WAAPI, imported only by `DisplayPage.tsx` so it never loads on a phone | Display board row reorder | Bails out under `prefers-reduced-motion` by default; inert in jsdom (no `ResizeObserver`) |
| **Count-up hook** (`useCountUp`, rAF, ≤ 600 ms) | none | Display score numerals; standing chip score | Number swaps instantly under reduced motion |
| `motion` (`motion/react`, LazyMotion `m` components) | **one new dependency, NOT in the default plan** | only if the maintainer wants spring physics or shared-element morphs the CSS route can't do | — |

Why the budget is one tiny, scoped dependency: everything in the moment catalogue below except the board reorder is plain CSS or a hand-written hook; the buzz screen and the console must stay free of any JS-driven animation runtime; and the repo's dependency rule asks for a reason before every install. The maintainer approved `@formkit/auto-animate` for the Display chunk on 2026-09-17 (decision 7) because it does the reorder in 3 kB with no `startViewTransition` freeze and no bespoke FLIP code to maintain. `motion` stays documented in `03` only as the answer if spring physics are ever wanted; it is not planned.

## 4. Route transitions

- **Where:** user-initiated internal navigations — Home → Host/Play/Display, Join → Team, Create → Console, Display code → Board, and the Cancel/back links. Not on programmatic redirects (`navigate(..., { replace: true })` after a kick, an expired game, a missing team) — those stay instant. Browser back/forward is instant too (declarative router; acceptable).
- **What:** old page fades out 100 ms (`--ease-exit`); new page fades in and slides up 12 px over 240 ms (`--ease-arrive`). The wordmark (`view-transition-name: wordmark`) morphs between its positions (small header ↔ large hero) so the eye has an anchor. Total ≤ 240 ms: **a running view transition suspends pointer hit-testing for its duration**, so it must be short and must only happen when the user just clicked something.
- **Never on live-state updates.** `startViewTransition` is never used for Realtime-driven changes (buzz lock, scores, round advance, banners) and never on the manager's scoring buttons — those would freeze the very buttons the host is pressing. Route changes only.
- **Scroll:** `ScrollToTop` remains; the new page is captured after scroll reset, so there is no jump inside the transition.
- **Lazy routes:** the hook **preloads the destination chunk before starting the transition** (`await import("../pages/X")`, deduped with the `lazy()` import) so the transition never animates to the `RouteFallback` spinner. If the preload rejects (stale chunk after a deploy), `lib/preloadError.ts` handles the reload as today.
- **Implementation surface:** `hooks/useViewTransitionNavigate.ts` (~25 lines: preload → feature-detect `document.startViewTransition` → bail to plain `navigate()` under `prefers-reduced-motion` → `startViewTransition(() => flushSync(() => navigate(to)))`), `components/TransitionLink.tsx` (a `<Link>` that keeps its real `href`/role and routes the click through the hook), ~25 lines of CSS on `::view-transition-old(root)` / `::view-transition-new(root)` / `::view-transition-group(wordmark)`, and the ~12 navigation sites switched to `TransitionLink` / the hook. `frontend/eslint.config.js` globals get `ViewTransition` if the type is referenced.
- **Tests:** jsdom has no `startViewTransition` and no `matchMedia`; the hook guards both (`typeof … === "function"`), so existing route tests take the plain-`navigate` branch unchanged. Hook tests stub `document.startViewTransition` to assert the transition branch, the preload order, and the reduced-motion bail-out. The e2e `full_game.spec.ts` already navigates every route and would catch a broken swap.
- **Reduced motion:** two guards, both required — the JS bail-out in the hook (also avoids the hit-testing freeze) and `@media (prefers-reduced-motion: reduce) { ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; } }` (the global `*` rule does not reach these pseudo-elements).

## 5. Moment catalogue

| # | Moment | Page | Technique | Duration / easing | Notes |
|---|---|---|---|---|---|
| 1 | First paint of Home | Home | keyframes, stagger via `animation-delay` | 320 ms, 60 ms apart, `--ease-arrive` | Once per full load; not on client-side return |
| 2 | Role row hover / press | Home | transition | 120 ms / 0 ms press | Hover only under `(hover: hover)` |
| 3 | Route change | all | View Transitions | 120 out / 240 in | §4 |
| 4 | Input focus ring | Join, Create, Display | transition on `outline-color` | 120 ms | |
| 5 | Preset / genre / decade toggle | Create | transition (background, border-color) + check icon stroke draw | 160 ms | These are small paint areas, acceptable; press scale 0 ms |
| 6 | Create / Join submit | Create, Join | spinner keyframes (rotate) | continuous while pending | Existing spinner ids kept |
| 7 | **Buzz press** | Team | transition-duration 0 on `.pressed` (filter + scale) | 0 ms in / 160 ms out | Unchanged mechanism |
| 8 | **Buzz tone change** (idle → pending → winner / locked-other / waiting) | Team | opacity crossfade of a stacked tone layer | 180 ms, `--ease-move` | Replaces the `background` transition (paint) with opacity (composite) |
| 9 | Buzz live pulse | Team | keyframes on `::after` (transform + opacity) | 2 s loop | Kept verbatim |
| 10 | Winner flash | Team | keyframes (filter brightness) | 480 ms once | Kept |
| 11 | Point pill in / out | Team, Console, Display | keyframes | 280 ms spring in, 360 ms out at 2140 ms | Kept; uses `--ease-overshoot` |
| 12 | Standing chip score change | Team | `useCountUp` + 1 scale pulse | 400 ms / 200 ms | Off the hot path (runs after the Realtime score event) |
| 13 | Toast enter / exit | all | enter `@starting-style`; exit = `exiting` flag (ToastContext already schedules dismissal with a timer — add a 160 ms exiting phase before removal) + `opacity`/`transform` transition | 250 ms in / 160 ms out | Fake-timer testable; no `display` transition (Firefox) |
| 14 | Modal enter / exit | Console, Join | enter `@starting-style`; exit via the same `exiting` flag pattern; backdrop fades with it | 250 / 150 ms | `ConfirmDialog` / `TeamRescueModal` keep their roles and focus handling |
| 15 | Score button press | Console | transform scale | 0 ms / 160 ms | Optimistic toast fires first (unchanged) |
| 16 | Token chip claimed | Console, Display | transition (background, color) + check icon draw | 160 ms | |
| 17 | Round counter change | Console, Team, Display | opacity swap | 120 ms | |
| 18 | Expiry banner in | Console | `@starting-style` translateY | 240 ms | |
| 19 | Buzz banner in | Display | keyframes translateY(-100 %) → 0 | 240 ms `--ease-arrive` | Transform only |
| 20 | Countdown bar | Display | `transform: scaleX()` driven by the existing timer | per tick, linear | Never animate `width` |
| 21 | Reveal unmask (title / artist claimed) | Display | `clip-path: inset(0 100% 0 0)` → `inset(0)` | 320 ms `--ease-arrive` | Hebrew text: the wipe direction is layout-neutral (always left→right in the LTR card) |
| 22 | **Board reorder** | Display | `@formkit/auto-animate` on the `<ol>` (transform + opacity via WAAPI) | ~400 ms, library default easing | The single biggest "wow" on the TV; rows slide to their new rank. Final Results rows never reorder live, so `EndScreen` (shared with phones) gets no library |
| 23 | Score count-up | Display | `useCountUp` | 600 ms | Tabular numerals so the row doesn't shift width |
| 24 | Row score highlight | Display | keyframes (background-color flash on the row) | 800 ms once | Small paint area, ≤ 5 rows; acceptable |
| 25 | Board → podium | Display, Team, Console | crossfade (opacity) | 240 ms | Podium mounts once; ended → swept keeps the same component (existing rule) |
| 26 | Podium rise | EndScreen | keyframes translateY + opacity, staggered | 400 ms, 120 ms apart | Replaces confetti (open question in README) |
| 27 | Winner light sweep | EndScreen | keyframes on `::after` transform | 900 ms once | |
| 28 | Skeleton pulse | any loading | keyframes opacity | 1.6 s loop | Replaces gradient sweep |
| 29 | Route fallback pulse | all | keyframes opacity + scale on the mark | 1.2 s loop | |
| 30 | Wordmark equaliser bars | header | existing keyframes (scaleY) | continuous | The one signature motion; pauses on `/team/:code` during `playing` (via a class on the page root) and under reduced motion |

**Removed:** body `bg-drift` (32 s viewport repaint), home card lift/rotate/`transition: all`, gradient hover fills, `filter: drop-shadow` on icons, confetti (pending decision).

## 6. Hot-path guarantees (checked in the validation plan §4.2)

- `BuzzButton.tsx` and `useBuzzer.ts` are not modified by the redesign. Only `BuzzButton.module.css` and `TeamGameplayPage.module.css` change.
- No animation library, no `useEffect`, no `requestAnimationFrame` is added to `BuzzButton` or to the render path of `TeamGameplayPage` while `game.status === "playing"` except the existing `PointChange` timer.
- The team page's continuous animation set during a round is exactly `{ buzz-pulse }`.
- A Playwright check measures pointerdown → `data-tone="pending"` (< 16 ms) and pointerdown → `buzz_in` request (< 5 ms) before and after the CSS change.

## 7. Testability

| Technique | vitest / jsdom | Playwright |
|---|---|---|
| CSS transitions/keyframes | invisible (css: false) — assert the class/attribute that triggers them | `document.getAnimations()` + `getComputedStyle` |
| `@starting-style` + `exiting` flag | assert mount, the `data-exiting` attribute, and removal after the fake-timer advance | visual + `getAnimations()` |
| View Transitions (hook) | jsdom lacks `startViewTransition`/`matchMedia` → the hook falls back to plain `navigate()`; stub `document.startViewTransition` in the hook's own tests to cover the transition branch, preload order, and reduced-motion bail-out | Chromium supports it; assert no console errors, the wordmark exists on both pages, and `contextOptions: { reducedMotion: "reduce" }` skips the transition |
| `@formkit/auto-animate` | inert in jsdom (no `ResizeObserver`), so the existing `[data-team-id]` ordering assertions keep passing unchanged; nothing to mock | visual; assert the row order under `[data-team-id]` changes after a score push, and that `getAnimations()` on the list shows only transform/opacity |
| `useCountUp` | fake timers + fake rAF | visual |
