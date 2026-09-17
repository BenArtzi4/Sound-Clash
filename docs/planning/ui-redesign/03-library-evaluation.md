# UI redesign — library evaluation

_Status: research complete (2026-09-17). Companion to [README.md](README.md). Numbers were fetched on 2026-09-17 from the GitHub REST API, the npm downloads API (week 2026-09-05 → 2026-09-11) and Bundlephobia; several claims were verified by reading the installed packages in `frontend/node_modules` and the published tarballs. Nothing was installed._

## 1. Verdict table

| Library | What it is | Verdict for Sound Clash |
|---|---|---|
| **barba.js** (`@barba/core`) | MPA page-transition library: intercepts link clicks, XHR-fetches the next page's HTML, swaps a `data-barba="container"` | **Not applicable.** Needs server-rendered HTML per URL; our `_redirects` serves the same `index.html` for every route, so there is nothing to fetch and swap. It would also fight react-router for `history`. Dormant: last release 2024-08, ~4 k downloads/week. |
| **transitions.dev** | Not a library: a static gallery of ~40 CSS transition recipes, a CLI that copies Markdown recipes, and a paid "Pro" tier. No repository licence. | **Borrow ideas only.** Reimplement 3 recipes in our own CSS Modules (`number-pop-in`, `success-check`, `skeleton-loader-and-reveal`), dropping their `filter: blur()` (expensive on low-end Android). Never vendor verbatim (no licence), never ship `transitions-refine` (injects a live panel). |
| **swup** | Same architecture as barba, better maintained (4.10.0, 2026-09-03; 26 k downloads/week); self-described as "for server-rendered websites". | **Not applicable**, same reasons as barba. |
| **Pow** (EmergeTools) | A **SwiftUI** effects package (`Package.swift`, iOS 15+). Not on npm, no JavaScript. | **Not applicable — wrong platform.** Its effect taxonomy (poof, boing, shine, rise, spray) is a useful vocabulary for game feedback moments; nothing to install. |
| **View Transitions API** (native) | `document.startViewTransition` + `::view-transition-*` pseudo-elements | **Use.** Baseline since 2025-10-14 (Chrome 111, Safari 18, Firefox 144). Zero dependencies. Two hard caveats below. |
| **`@starting-style`, `transition-behavior: allow-discrete`, `@property`** (native CSS) | Enter animations for newly mounted elements; discrete transitions; typed custom properties | **Use.** Baseline 2024. Caveat: Firefox does not transition `display`, so exits must use `visibility`/`opacity` or a JS "exiting" flag. |
| **`@formkit/auto-animate`** | 3.2 kB gzip, zero deps, WAAPI-based FLIP for list add/remove/move | **Reserve option** for the Display board only, if the zero-dependency FLIP hook disappoints. Inert in jsdom (no `ResizeObserver`), CSP-clean, respects reduced motion. Costs a `ResizeObserver` per child and a 2 s poll per element — acceptable on a TV, must not load on phones (import only from the `DisplayPage` chunk). |
| **`motion`** (framer-motion, v13.4.0) | 15.4 M downloads/week; `LazyMotion` + `m` ≈ 19.6 kB gzip with `domAnimation` | **Reserve option** only for exit orchestration / spring feel on Display + EndScreen. Rules if ever adopted: `LazyMotion strict` + `domAnimation` (never `domMax`); animate `transform`/`opacity` as **strings** (the `x`/`scale` shorthands run on the main thread — verified in `motion-dom/animation/waapi/utils/accelerated-values.mjs`); never `<AnimateView>` and never `AnimatePresence mode="popLayout"` (both inject an inline `<style>` our CSP blocks); never imported by `TeamGameplayPage`; `MotionConfig reducedMotion="user"`; `MotionGlobalConfig.skipAnimations = true` in `test-setup.ts`. |
| **react-spring** | 20 kB gzip, main-thread rAF only, manual reduced motion | **No.** Same cost as `motion`, less capability, worse on low-end Android. |
| **GSAP** | Free since 2025-04 (Webflow) but a custom non-OSI licence; 27 kB gzip; main-thread tween engine; scroll/marketing-oriented | **No.** Wrong problem, licence friction in an MIT-declared package. |
| **lenis** (smooth scroll) | Registers **non-passive** `touchstart`/`touchmove`/`wheel` listeners and a global `pointerdown` listener, continuous rAF loop | **Hard no — a buzz-latency hazard.** Also nothing to scroll: the buzz screen and console fit one screen by design. |
| **react-transition-group** | Last publish 2022; calls `findDOMNode`, which is gone in React 19 | **No.** |
| **anime.js v4, react-flip-toolkit** | Healthy / stale respectively; nothing View Transitions + CSS doesn't cover | **No.** |

## 2. Findings that change the plan

### 2.1 react-router's `viewTransition` is a no-op in this app

`App.tsx` uses `<BrowserRouter><Routes>` (declarative mode). Reading `react-router@7.18.1`: `startViewTransition` is only called inside `RouterProvider` (data mode); `useNavigate()` in declarative mode resolves to `useNavigateUnstable`, which never reads `options.viewTransition`; `useViewTransitionState` throws an invariant outside `RouterProvider`. The docs page labels the feature "Not available with Declarative". So `<Link viewTransition>` would silently do nothing.

Two ways forward; the plan takes the first:

- **Hand-written hook (chosen).** `useViewTransitionNavigate()` — ~20 lines: optionally `await` the destination chunk's `import()`, feature-detect `document.startViewTransition`, bail to plain `navigate()` under `prefers-reduced-motion`, otherwise `startViewTransition(() => flushSync(() => navigate(to)))`. A `TransitionLink` wrapper keeps `<Link>` semantics (real `href`, same accessible role) and routes the click through the hook. No refactor of `App.tsx`.
- Migrate to `createBrowserRouter` + `<RouterProvider>` — mechanical but touches the file that gates every route and changes how the single `Suspense` boundary behaves. Deferred; not needed for anything in this plan.

### 2.2 A view transition freezes hit-testing

Per the CSS View Transitions spec, while a transition runs, pointer hit-testing targets the document element only — the page is effectively `pointer-events: none` for the duration (250 ms by default). Consequences written into the motion spec:

- **Never** wrap a buzz-screen state change, a manager scoring update, or a Realtime-driven update in `startViewTransition`.
- Route transitions are ≤ 240 ms and happen only on navigations the user just initiated, where a frozen quarter-second is invisible.
- The Display board's row reorder uses a small FLIP hook (transforms only, no freeze) rather than `view-transition-name` per row; the view-transition variant is the documented alternative if the hook proves fiddly (the TV page has nothing to click, so the freeze is harmless there).

### 2.3 Lazy route chunks

Every route except `/` and `/join` is a lazy chunk behind one `Suspense`. If the destination chunk is not loaded, a view transition animates to the `RouteFallback` spinner, then pops. The hook therefore **preloads the chunk first** (`await import("../pages/X")`, which Vite dedupes with the `lazy()` import) and only then starts the transition. `lib/preloadError.ts` already handles the stale-chunk failure path.

### 2.4 The global reduced-motion rule does not reach view transitions

`styles.css` shortens every `animation`/`transition` under `prefers-reduced-motion`, but the universal selector does not match `::view-transition-old/new/group` (a separate pseudo-element tree on the root). Two guards are required: the JS bail-out in the hook (which also avoids the hit-testing freeze) and an explicit CSS block setting those pseudo-elements' `animation: none`.

### 2.5 Firefox and `display` transitions

`transition-behavior: allow-discrete` is Baseline, but transitioning `display` (and `content-visibility`) is not supported in Firefox. Exits for toasts/modals use an `exiting` state flag + timeout (unit-testable with fake timers), with `visibility`/`opacity` transitions; `@starting-style` handles enters everywhere.

### 2.6 jsdom facts (vitest 4.1.5 / jsdom 29.1.1, verified)

`document.startViewTransition`, `Element.prototype.animate`, `ResizeObserver`, `IntersectionObserver`, `requestIdleCallback` and **`window.matchMedia`** are all undefined; `MutationObserver` and `requestAnimationFrame` exist. So: the hook's feature-detect makes existing route tests take the plain-`navigate` branch unchanged; any `matchMedia` call must be guarded with `typeof window.matchMedia === "function"` (the guard `EndScreen.tsx` already uses); to test the transition branch, stub `document.startViewTransition` per test.

## 3. Recommendation

**Option A — zero new dependencies — is the plan.** View Transitions for routes (via the hook), CSS transitions/keyframes and `@starting-style` for everything element-level, a ~40-line FLIP hook and a small count-up hook for the Display board. Every moment in the motion catalogue ([04-motion-and-transitions.md](04-motion-and-transitions.md)) is covered.

**Option B — one dependency — only if A disappoints in review**, scoped to a lazy chunk that never loads on a player's phone: `@formkit/auto-animate` (3.2 kB, Display board only) or `motion` under `LazyMotion` (19.6 kB, Display + EndScreen only, with the CSP and main-thread rules above). Either would be a separate, flagged PR.

**Explicitly not doing:** any animation library in the player bundle; `motion` app-wide; smooth-scroll; a router-mode migration for the sake of `viewTransition`; GSAP.

## 4. Guardrails to add to CI / the validation pass

- **Bundle guard:** after `npm run build`, the player-reachable chunks (`index-*.js`, `TeamGameplayPage-*.js`) must not contain markers of any animation library (`framer-motion`, `auto-animate`, `lenis`). A ten-line script in the frontend test job or a vitest that reads `dist/` after build.
- **Listener guard (Playwright):** on `/team/:code`, no non-passive `touchstart`/`touchmove`/`wheel` listener on `window`/`document` (use `getEventListeners` via CDP or a monkey-patched `addEventListener` installed with `page.addInitScript`).
- **Latency guard:** the existing pointerdown → `buzz_in` request measurement must not move.
- **Property guard:** `document.getAnimations()` on phone-facing pages only ever animates `transform`, `opacity`, `filter` (brightness only, never blur), `clip-path`, `visibility`.

## 5. Sources

GitHub: barbajs/barba, Jakubantalik/transitions.dev, swup/swup, EmergeTools/Pow, motiondivision/motion, formkit/auto-animate, pmndrs/react-spring, greensock/GSAP, darkroomengineering/lenis, reactjs/react-transition-group, juliangarnier/anime, aholachek/react-flip-toolkit. Docs: motion.dev (reduce-bundle-size, performance, accessibility), auto-animate.formkit.com, react-spring.dev (testing, use-reduced-motion), gsap.com standard licence, reactrouter.com/how-to/view-transitions, MDN `startViewTransition`, `drafts.csswg.org/css-view-transitions-1`, developer.chrome.com same-document view transitions, `mdn/browser-compat-data`, the `web-features` Baseline dataset. Local: `frontend/node_modules/react-router@7.18.1`, `react-dom@19.2.7`, `jsdom@29.1.1`.
