# Touch press and instant screen changes

Amends `04-motion-and-transitions.md` §4 (route transitions) and the moment catalogue's row 3, `05-page-by-page.md` §0 and §1 (route transitions, Home's entrance), and `09-home-colour-and-fill.md` "The hover fill" (the touch half). Decided by the maintainer on 2026-09-25 from a phone-openable A/B lab, after testing the live site on their own phone.

## Why

The maintainer reported three problems on a real phone:

1. **Tap.** Touching a Home card started the diagonal fill, then the app jumped to the next screen before the fill finished.
2. **Back.** Going back from Host to Home "loads the home screen, then flashes, then loads again".
3. **Screen changes.** Moving between screens did not feel smooth.

A frame-by-frame reproduction on prod (Chromium with iPhone 13 emulation, a CDP screencast plus a per-frame sampler of computed styles) found the mechanisms:

- **Tap.** The fill (100 ms on touch) retracted when the finger lifted, and the view transition captured that half-retracted card as the "old" screen, then cross-faded it out. With a 0 ms press no fill was visible at all. Also, while the Host card awaited its page's chunk before navigating, a cold phone saw the card un-fill, a pause, and then the jump.
- **Back (browser back or swipe).** Home re-mounted and replayed its 800 ms staggered `rise` from opacity 0, so the first frame after the back was **completely empty**. The hero reached 0.5 opacity at about 190 ms; the cards and "How to play" finished at about 1.0–1.3 s. On an iPhone, Safari first draws its own snapshot of Home during the swipe, so the viewer sees Home, then blank, then Home fading in. SvelteKit issue #10700 reports the same sequence. With `rise` neutralised, the same back was a clean one-frame swap.
- **Back (Cancel).** The 240 ms view transition ended while Home's 800 ms `rise` was still running. The wordmark, drawn in its own transition layer at full brightness, dropped back into the half-faded hero: its 98th-percentile luminance fell from 228 to 159 in one frame, then kept fading in for most of another second.
- **Morph.** During the 240 ms wordmark morph, two wordmarks were visible at once: the large hero lockup sat over the "Host a game" heading. Under 4× CPU throttling the 100 ms commit cap in the hook expired first, so the transition animated Home into Home and the Host page popped in afterwards.

The research agrees on two points. A tap must answer within 0.1 s, and it must never wait for an animation (Apple HIG, Motion: "don't make people wait for an animation to complete"; NN/g on response times). And a progressive wipe only reads once it has finished, so the first frame of touch feedback has to be a complete state.

## Decisions

| # | Question | Choice | Options tried |
|---|---|---|---|
| 1 | Touch press on a Home card | **Ripple, touch only** | Press (scale + tint), Flood, Ripple, Edge, Finish the sweep, today's sweep |
| 2 | Coming back to Home | **Stay put** | Stay put, today's replay |
| 3 | Screen changes | **Instant** | Instant, a 150 ms quick fade, today's transition + morph |

### 1. Ripple on touch, the sweep stays for the mouse

- **Touch or pen.** `pointerdown` adds a circle of the card's `--hue` at 20% opacity, centred on the touch point and sized to reach the farthest corner. It grows from `scale(0)` over **450 ms** with `cubic-bezier(0.2, 0, 0, 1)`, which is Material's press-grow timing. On `pointerup` / `cancel` / `leave` it fades out over **375 ms**, and a 400 ms timer removes the node.
- **Layering.** The ripple sits under the text: ripple 0, face 1, fill 2. It animates only `transform` and `opacity`.
- **Built outside React.** The ripple node is built on the element, not in React state, so a tap never costs a render.
- **Mouse.** The diagonal hover sweep is unchanged, and a click navigates at once.
- **Keyed on the input, not the screen.** The ripple decision comes from `pointerType`. A touchscreen laptop ripples under a finger and sweeps under the mouse; an iPad ripples.
- **Hover gate.** The hover rule is now gated on `(hover: hover) and (pointer: fine)`, because some Android phones report hover.
- **What was deleted.** The touch-driven sweep (`data-tapped`, the `(hover: none)` 100 ms override).
- **Reduced motion.** The global rule collapses the growth, so the ripple becomes an instant flat tint.

### 2. Home's intro plays once, on landing

- `HomePage` reads `window.location.pathname` once, at module evaluation. Home is an eager import, so that value is the path the page load began on.
- The first mount sets `data-intro="true"` only when that path is `/`. Every later mount renders without it: back swipe, back button, Cancel, and the Back links.
- The `rise` animations are scoped to `.page[data-intro="true"]`.
- How to play loses its `rise` entirely, so no page fades itself up on arrival.

### 3. No route transitions

- **Deleted:** `useViewTransitionNavigate`, `TransitionLink`, the `::view-transition-*` CSS and `--dur-route`, and the wordmark's `view-transition-name`. Links are plain react-router `<Link>`s, and the two programmatic sites use `useNavigate()`.
- **No loading flash.** `<BrowserRouter>` already wraps a location update in `React.startTransition`, so the current screen stays up until a lazy page is ready.
- **Create → Console.** The create page still awaits the console's chunk before navigating, so its "Creating…" state holds until the console can render. Otherwise `finally` would re-enable the button during the wait.
- **Prefetch.** Home fetches the Host, Display and How to play chunks when idle: `requestIdleCallback`, falling back to an 800 ms timeout because Safari has none. That is about 12 kB gzip of JS and 5.7 kB of CSS. It goes through `prefetchQuietly` in `lib/preloadError.ts`, which suspends the stale-chunk auto-reload while a background fetch is in flight. A prefetch failing on flaky wifi must not reload the screen the viewer is looking at; the real navigation imports the chunk again and gets the normal recovery.

## Guards

| Guard | What it catches |
|---|---|
| `HomePage.test.tsx` | Every Home link navigates with zero `startViewTransition` calls. The ripple is created for touch but not for mouse, is sized and centred on the finger, fades on lift and is removed. The intro plays on landing only. |
| `HomePage.prefetch.test.tsx` | Home imports the three lazy pages without a click |
| `preloadError.test.ts` | A background fetch's failure does not reload; the recovery returns afterwards |
| `arrivalMotion.test.ts` | Home's `rise` exists only behind `[data-intro="true"]`; How to play has no animation |
| `styles.test.ts`, `Logo.test.tsx` | No `view-transition` CSS, no `--dur-route`, no wordmark transition name |
| `scripts/check-bundle.mjs` | `startViewTransition` in **any** emitted chunk fails the build (it was two chunks before) |
| `tests/e2e/redesign_guards.spec.ts` | A real browser counts zero view transitions across Home → Host → Cancel → How to play → back → Join → Team |

## Verify on a phone

On the per-PR preview (`https://pr-<N>.sound-clash.pages.dev`), on an iPhone:

- Tap each card: a ripple appears under your finger and the next screen opens at once.
- From Host, swipe back: Home is simply there, with no blink and no second fade-up.
- Tap Cancel: the same.
- On a laptop, hover still sweeps the card, and a click opens the page at once.
