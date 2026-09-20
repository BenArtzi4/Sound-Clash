# Border tokens fall below WCAG 1.4.11 — one real defect, nine false alarms

_Status: found 2026-09-20 while shipping the Home colour pass ([PR #323](https://github.com/BenArtzi4/Sound-Clash/pull/323)). Not fixed there — it is unrelated to that change and deserves its own PR. Every number below was computed, not recalled._

## The finding

WCAG 2.1 **1.4.11 Non-text Contrast** requires **3:1** for any visual boundary a user needs in order to identify a control or its state. Both border tokens are below it.

Measured against the grounds they actually sit on (recomputed after `--bg` moved to `#14120E` in PR #323 — the older numbers against pure black are stale):

| Token | Value | on `--bg` `#14120E` | on `--surface` `#1D1A14` | on `--surface-2` `#26221A` |
|---|---|---|---|---|
| `--border` | `rgba(233,228,217,0.14)` | **1.40:1** | 1.45:1 | 1.47:1 |
| `--border-strong` | `rgba(233,228,217,0.32)` | **2.52:1** | 2.56:1 | 2.53:1 |
| _proposed_ | `rgba(233,228,217,0.42)` | **3.47:1** | 3.47:1 | 3.36:1 |
| `--accent` (for reference) | `#FF7A00` | 7.16:1 | 6.64:1 | 6.06:1 |

The minimum alpha that reaches 3:1 is **0.375** on all three grounds. `0.42` gives a working margin without making hairlines loud.

## What is actually broken — and what is not

I audited all ten `var(--border-strong)` uses rather than assuming. **Nine are decorative and compliant as-is.** One is a real defect.

| # | Location | Role | Verdict |
|---|---|---|---|
| 1 | `ManagerCreateGamePage.module.css:147` | `.genreCheck` — the 20×20 **unchecked** genre checkbox | ❌ **The defect.** Its only visual is this 1px border at 2.52:1. |
| 2 | `styles.css:174` | input `:focus-visible` border | ✅ Compliant — the same rule sets `outline-color: var(--accent)` (7.16:1), which is what carries focus. |
| 3 | `GameCodeField.module.css:30` | `.box:focus-within` border | ✅ Same pattern, same accent outline. |
| 4 | `styles.css:235` | `.btn:hover` | ✅ Decorative hover, inside `@media (hover: hover)`. |
| 5 | `ManagerCreateGamePage.module.css:323` | `.preset/.genre/.decade:hover` | ✅ Decorative hover. |
| 6 | `ManagerConsolePage.module.css:432` | `.scoreBtn:hover` | ✅ Decorative hover. |
| 7 | `ManagerConsolePage.module.css:453` | `.continueBtn:hover` | ✅ Decorative hover. |
| 8 | `ManagerConsolePage.module.css:365` | dashed empty-state panel | ✅ Decorative. |
| 9 | `DisplayPage.module.css:354` | dashed empty-state panel | ✅ Decorative. |
| 10 | `DisplayPage.module.css:181` | `.bannerEnded` border | ✅ Decorative — the banner has its own surface fill and muted text. |

**Correction to an earlier claim.** While investigating this I first reported that `--border-strong` "carries focused and selected states" and therefore broke focus. That is wrong. It does appear on focus, but always alongside `outline-color: var(--accent)`, and the accent outline is 6–7:1. **Focus indication is compliant today.** The genuine problem is narrower and more concrete than the first report suggested.

### Why the genre checkbox matters

It is on the host's primary setup flow — the screen where you choose what music the game plays. Unchecked, the box is a 2.52:1 hairline; checked, it fills with `--accent` (6.64:1) and draws a tick. So the *checked* state is clear and the *unchecked* state is nearly invisible, which is backwards: a user scanning for "what have I not selected yet" is the one who needs the affordance. On a phone in a dim room — the product's actual setting — it is easy to miss that the boxes are controls at all.

The tile also has `.genreSelected { background: var(--accent-soft); border-color: var(--accent) }`, so selection *is* conveyed by more than the checkbox alone. That makes this a real but non-critical defect: **P2, not P1.**

## Recommended fix

**Raise `--border-strong` from `0.32` to `0.42`.** One line in `frontend/src/styles.css`.

```css
--border-strong: rgba(233, 228, 217, 0.42); /* 3.47:1 on --bg — WCAG 1.4.11 */
```

This fixes the checkbox and, as a side effect, makes the nine decorative uses slightly more present — which is an improvement for the four hover states in particular, since a hover affordance at 3.47:1 reads better than one at 2.56:1.

**Alternative, if the louder decorative borders are unwanted:** add a separate `--border-control: rgba(233,228,217,0.42)` and use it only at `ManagerCreateGamePage.module.css:147`. Surgical, but it adds a token for a single consumer, and leaves the trap in place for the next control that reaches for `--border-strong`.

Recommendation is the one-line change. Fall back to the second only if the visual review objects.

**Do not touch `--border` (0.14).** It is used 60 times as a pure hairline and is decorative everywhere; raising it would change the entire visual density of the app for no accessibility gain.

## Risk

Low. No test asserts `--border-strong`'s value — `styles.test.ts` checks `--bg`, `--surface`, `--accent`, `--accent-ink`, `--bone`, `--text-muted`, `--positive`, `--negative`, `--periwinkle` and the `--role-*` aliases, but not this one. `ui_prod_pass.mjs` has no contrast gate at all. So the change is behaviour-neutral to CI and needs a **visual** review, not just a green build.

## Validation

1. `cd frontend && npm run lint && npx prettier --check "src/**/*.{ts,tsx,css}" && npm run typecheck && npm run test:coverage`
2. Build and preview; confirm on the **host create** screen that an unchecked genre box is clearly visible at 390×844 — this is the whole point of the change.
3. Check the four hover states and two dashed empty-state panels do not now read as too heavy: `/manager/create` (preset/genre/decade hover), `/manager/game/<code>` (score + continue buttons, empty bonus panel), `/display/<code>` (empty state).
4. Add a regression assertion to `frontend/src/styles.test.ts` so this cannot silently regress:
   ```ts
   "--border-strong: rgba(233, 228, 217, 0.42)",
   ```
5. After merge: `node tests/smoke/ui_prod_pass.mjs all` (sandbox disabled), expecting 29/29. A lone `compute-pressure` console line on `manager390` is a known flake — re-run once.

## Out of scope

The broader question of whether the app needs a full contrast audit against WCAG 1.4.11 (icons, chips, the display board's rank rings) is not answered here. This document covers the border tokens only.

---

## Prompt for a fresh session

Copy everything below into a new session.

```
Fix the border-token contrast bug described in docs/planning/FIX-2026-09-20-border-token-contrast.md.

Read that file first — it contains the measured contrast numbers, an audit of all ten
`var(--border-strong)` uses classifying which are real defects and which are decorative,
the recommended one-line fix, and the validation steps.

Summary: `--border-strong` is rgba(233,228,217,0.32), which measures 2.52:1 on the app's
`--bg` (#14120E). WCAG 1.4.11 requires 3:1 for a boundary that identifies a control. The
one place this actually breaks is the unchecked genre checkbox on the host create screen
(frontend/src/pages/ManagerCreateGamePage.module.css:147), whose only visual is that
border. The other nine uses are decorative or are backed by an --accent outline and are
already compliant.

Recommended fix: raise `--border-strong` to rgba(233,228,217,0.42) (3.47:1) in
frontend/src/styles.css, and add a matching assertion to frontend/src/styles.test.ts so it
cannot regress.

Please:
1. Make the change on a new branch off main (never work on main — see .claude/rules/git-workflow.md).
2. Run the full frontend gate: lint, prettier --check, typecheck, test:coverage. Note that
   CI runs Prettier as a SEPARATE step from lint, so `npm run lint` alone is not enough.
   Delete frontend/dist-local first if it exists, or eslint walks the bundle.
3. Build and verify VISUALLY on a `vite preview` build, because no test covers this and a
   green build proves nothing here. Confirm an unchecked genre box is clearly visible at
   390x844 on /manager/create, and that the four hover states and two dashed empty-state
   panels listed in the doc have not become too heavy.
4. Open a PR. Check the per-PR preview deploy at https://pr-<N>.sound-clash.pages.dev and
   confirm it there too.
5. Do not merge without asking me.

Two environment notes that will cost you time otherwise: `curl -w "%{http_code}"` returns
000 on this machine, so never build a readiness check on it — probe the response body
instead. And after a route change, `waitForURL` resolves before the DOM commits (the app
navigates inside startViewTransition), so chain a `waitForFunction` on the expected content
rather than reading it straight away.
```
