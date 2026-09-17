# UI redesign — plan index

_Created 2026-09-17. Status: **planning only — nothing implemented.** The maintainer asked for a professional, emoji-free look with smooth transitions that does not read as a generic AI-generated app, anchored on one site from the Barba.js showcase, plus a plan to prove nothing breaks. This folder is that plan. Implementation starts only after the open questions below are answered and the maintainer approves._

## The decision in one paragraph

**Reference: Rogue Studio (https://rogue.studio).** Pure-black ground, a warm cream neutral, one orange accent, poster typography (a fat condensed display face for the few words that matter, a small tracked grotesk for everything else), and a disciplined transform/opacity-only motion language with two easings and four duration tiers. It was chosen over 65 other live showcase sites because it is a complete, transferable *system* rather than one pretty screen, because its colours measure ≥ 8:1 on black (legible on a phone in one hand and on a TV across a dim room), and because its motion needs no library. We depart from it in one place: two type faces instead of four. Fonts are self-hosted, OFL-licensed, with Hebrew fallbacks (Anton → Secular One; Instrument Sans → Heebo). **One small, scoped dependency**: `@formkit/auto-animate` (3.2 kB) for the TV scoreboard reorder, loaded only by the Display chunk; route transitions use the native View Transitions API through a small hook; everything else is CSS. The four repositories the maintainer found were evaluated honestly: barba and swup are multi-page-app tools that cannot work with this SPA's routing, Pow is an iOS SwiftUI package, and transitions.dev is a CSS snippet gallery worth borrowing three ideas from.

## Files

| File | What it holds | Read it when |
|---|---|---|
| [01-design-system.md](01-design-system.md) | Why Rogue Studio; colour tokens with measured contrast; type faces, scale, Hebrew handling, font loading under the CSP; spacing/radius; every component's spec; the icon set replacing the emojis; the banned list | Before any CSS is written |
| [02-current-state-audit.md](02-current-state-audit.md) | What exists today: every screen state, every current animation, every emoji, and — the safety net — every test id, text assertion, class assertion and ARIA contract the redesign must keep | Before touching any page, and when a test fails |
| [03-library-evaluation.md](03-library-evaluation.md) | barba / transitions.dev / swup / Pow verdicts; View Transitions, `@starting-style`, `motion`, auto-animate, react-spring, GSAP, lenis with numbers; the react-router declarative-mode trap; the hit-testing freeze; jsdom facts | When someone proposes a dependency |
| [04-motion-and-transitions.md](04-motion-and-transitions.md) | Five motion principles, timing/easing tokens, the technique map, route-transition design, the 30-moment catalogue, hot-path guarantees, testability | Before any animation is written |
| [05-page-by-page.md](05-page-by-page.md) | Shell + each of the nine routes: today vs new, what is kept as a contract, proposed copy | When implementing a page |
| [06-validation-plan.md](06-validation-plan.md) | Baseline capture, the per-PR gate ladder, the regression surface rules, behaviour invariants per page, performance budget, accessibility gate, device matrix, the scripted Claude-in-Chrome prod pass, the full-game exit gate, rollback | Every PR, and after every merge |
| [07-implementation-plan.md](07-implementation-plan.md) | **The build plan**: twelve tasks (one PR each) with the exact files, code, tests, commands and commit lines; a starter prompt for each implementation session | When implementing — one task per fresh session |
| [08-final-validation.md](08-final-validation.md) | **The end-of-redesign run**: a starter prompt for one fresh session that runs every gate, the full local e2e suite on three engines, the prod API/RPC negative-path matrix and a 30-team load check, a 13-team real-browser game on prod exercising every button and combination, the machine + looked-at-it design conformance pass, and the triage/fix/report loop with a GO / NO-GO verdict | After Task 11 merges (full mode), or after Task 8 for a drift check (partial mode) |
| [baseline/2026-09-17-baseline.md](baseline/2026-09-17-baseline.md) | Test counts (521 vitest / 18 e2e), bundle sizes, fonts, emoji inventory as of `main` today | When comparing after-numbers |

## Scope

**In:** all six user-facing routes (Home, How to play, Join, Team/buzz, Host create, Host console, Display + Final Results), the shared components (buttons, inputs, chips, cards, toasts, modals, skeletons, wordmark), design tokens, self-hosted fonts, the icon set, route transitions, element-level motion, the Display board reorder/count-up, copy tweaks on Home, the `how-to-play` hero replacement, `index.html` meta (theme colour, colour scheme, font preload), `_headers` (font caching).

**Out (not changing):** anything below the component layer — hooks, RPC calls, Realtime reducer, `BuzzButton.tsx`/`useBuzzer.ts` logic, routes/paths, localStorage keys, backend, DB. Also out: a light theme (dark only), an RTL interface (vetoed D-6; only text runs become bidi-aware), the admin songs page beyond inherited tokens, regenerating the OG image and PWA icons (follow-up PR, binary assets), sound effects (X-SFX, separate feature).

## Proposed PR sequence (each independently revertable; details go into the implementation plan after approval)

| # | PR | Touches | Risk |
|---|---|---|---|
| 0 | Baseline + fonts | `public/fonts/*` (5 woff2 — **binary, needs your OK**), `@font-face` in `styles.css`, `_headers`, `index.html` preload | none visible yet (fonts declared, not used) |
| 1 | Tokens + global styles | `styles.css` (palette, type scale, spacing, radius, motion tokens, `.btn`/inputs/`.card`/`.error`), `index.html` meta (`color-scheme`, `theme-color`, favicon), `manifest.webmanifest` (`theme_color`, `background_color`) | every page shifts to dark + new type at once — the "big bang" PR; reviewed on a preview build on real phones first |
| 2 | Icons + emoji removal | `components/icons.tsx`, `SoundtrackBadge`, `DisplayPage` reveal rows + rank badges (delete the `::before` medal content, keep the `bigRow*` keys), `EndScreen` crown, `HowToPlayPage`, `HostRecoveryLink`/`TeamRescueModal` "Copied", `ManagerConsolePage` token chips | exactly two test edits: `ManagerConsolePage.test.tsx:1521` and `tests/e2e/token_claim_constraints.spec.ts:31` (the `✓` chips) |
| 3 | Wordmark + shell components | `Logo`, `RouteFallback`, `ErrorBoundary`, `Toast`, `ConfirmDialog`, `Skeleton`, `PointChange` | low |
| 4 | Home + How to play | `HomePage`, `HowToPlayPage` (+ hero SVG, delete the PNG) | copy assertions |
| 5 | Join + Display code entry | `JoinTeamPage`, `DisplayPage` entry state | form contracts |
| 6 | Host create | `ManagerCreateGamePage` | tap-flash regression check on a real phone |
| 7 | Team / buzz screen (CSS only) | `BuzzButton.module.css`, `TeamGameplayPage.module.css` | **run-e2e**; latency guard; real-phone 60 fps check |
| 8 | Host console (CSS only) | `ManagerConsolePage.module.css` (+ chip icons from PR 2) | **run-e2e**; #177 fit measurements |
| 9 | Display board + Final Results | `DisplayPage` (adds `@formkit/auto-animate`, imported here only; masked reveal blocks + the six `???` test updates), `EndScreen`, `useCountUp`; `package.json` + lockfile | **run-e2e**; `display_fit` + `ten_teams` specs; bundle guard proves the dependency is absent from `index-*.js` / `TeamGameplayPage-*.js` / `ManagerConsolePage-*.js` |
| 10 | Route transitions | `useViewTransitionNavigate`, `TransitionLink`, `::view-transition-*` CSS, navigation sites | reduced-motion + Firefox fallback checks |
| 11 | Cleanup | remove token aliases (`--space-xs…`, `--easing-spring`), the old `bg-drift`, dead CSS; docs + CHANGELOG roll-up | none |

Order rationale: tokens first so every later PR is small; the two hot-path pages (7, 8) are CSS-only and isolated; route transitions last because they are the only piece with browser-support variance.

## Decisions (answered by the maintainer, 2026-09-17)

| # | Question | Decision |
|---|---|---|
| 1 | Reference site | **Rogue Studio.** |
| 2 | Theme | **Dark only, all pages** (also delivers X-DarkRoom #243 as the base). |
| 3 | Fonts | **Two faces, ~115 KB self-hosted woff2 committed** to `frontend/public/fonts/`: Anton + Instrument Sans, with Secular One + Heebo for Hebrew. No serif. The binary commit is approved here; PR 0 still lists the exact files and sizes. |
| 4 | Home copy | **New headline + short role names.** "Name the song. Buzz first." / "Real-time music trivia for a room full of people and one TV."; links read Host / Play / Display; the five link-name tests and the heading test are updated in PR 4. |
| 5 | How-to-play hero | **Replace the PNG with an SVG schematic**; drop the `src` assertion in the same PR. |
| 6 | Confetti | **Replace with the staggered rise + light sweep.** No particles. |
| 7 | Dependency budget | **`@formkit/auto-animate` is approved now, for the Display chunk only** (3.2 kB gzip, zero transitive deps, WAAPI, inert in jsdom). It handles the TV board reorder in PR 9; it must never be imported by any module reachable from the player or console bundles. No other dependency. |
| 8 | `???` placeholder | **Masked blocks**; the six assertions on the literal `???` are updated in PR 9. |
| 9 | OG image + PWA icons | **Regenerate in a follow-up PR** after the redesign lands (binary assets, confirmed then). |

Implementation is unblocked; the next step is the implementation plan (see the last section).

## Risks and how the plan handles them

- **Contrast on orange.** White on `#FF7A00` fails (2.6:1); every orange surface uses black ink. Checked in the a11y gate.
- **Fonts under CSP.** No `font-src`, so fonts must be same-origin; they are. Verified by the console/network check on every prod pass.
- **Hebrew titles.** Latin faces have no Hebrew glyphs; the stacks fall through to Secular One / Heebo per text run; `dir="auto"` on catalog text. Verified with an Israeli-genre round in the prod pass.
- **View transitions freeze input.** Used only on user-initiated route changes, ≤ 240 ms, never on live updates; guarded in CI by "one file may call `startViewTransition`".
- **Test churn.** The audit found only three test-locked glyphs (`✓` on the manager token chips — two assertions; `—` in admin cells and the slow-loading copy — untouched by the plan), one hero `src` assertion, the Home copy assertions, and the six `???` assertions (decision 8). Everything else in the glyph inventory is free. Each edit is listed in its PR. The five load-bearing class names, the Display row's three-span markup, every test id and `data-*` attribute, and the wordmark's literal "Sound Clash" text are frozen.
- **The big-bang tokens PR.** Reviewed on a local preview on real phones and the TV before merge; revertable in one commit.
- **Buzz latency.** CSS-only changes on the buzz screen; the pointerdown → RPC measurement and the Grafana buzz span are compared before/after.

## How implementation runs (agreed 2026-09-17)

The spec is approved and the implementation plan is written ([07-implementation-plan.md](07-implementation-plan.md)). Implementation happens in **fresh sessions, one task (= one PR) per session**, so each PR gets a clean context and a review point in between. A session ends with the PR **merge-ready** (checks green, every bot review thread resolved, `mergeStateStatus: CLEAN`), never merged — merging stays the maintainer's click. Start a session with the prompt at the end of `07` (replace N):

> Read `docs/planning/ui-redesign/README.md`, `07-implementation-plan.md` (Task N), `06-validation-plan.md` §2 and `02-current-state-audit.md` §4. Implement Task N exactly as written on a new `feature/ui-N-…` branch from `main`, run the gate, open the PR (label `run-e2e` when the task says so), then carry it to merge-ready: wait for the checks, resolve every bot review thread (CodeQL / Advanced Security) so "All comments must be resolved" cannot block it, and confirm `mergeStateStatus` is `CLEAN`. Do not merge. Work autonomously and stop only for a question I must answer. Report the gate output, the final merge state and the PR link.

Order: Task 0 (fonts) → 1 (tokens, reviewed on a real phone before merge) → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Tasks 4–6 are independent of each other once 1–3 are in; the rest are sequential. After Task 11: the final validation run in [08-final-validation.md](08-final-validation.md) (which contains the Full-Game Exit Gate from [06-validation-plan.md](06-validation-plan.md) §9 plus everything around it; paste its starter prompt into a fresh session), then the OG image / PWA icon follow-up (decision 9).

After each merge, the post-merge prod pass (`06` §2.4 + §8) is scripted: `node tests/smoke/ui_prod_pass.mjs all` from the repo root with the Bash sandbox disabled (see `tests/smoke/README.md`). Exit 0 means every hard gate is green; the soft findings it prints are the items that stay non-zero until Tasks 2, 4 and 9 land.
