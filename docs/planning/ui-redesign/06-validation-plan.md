# UI redesign — validation & regression plan

_Status: draft for maintainer review (2026-09-17). Companion to [README.md](README.md). Nothing here is implemented yet; this is the plan we will follow, PR by PR, so the redesign changes **only** how the app looks and moves — never what it does, how fast it does it, or what a test can rely on._

The redesign is a behaviour-preserving change to a live app that hosts real Saturday-night games. The bar is therefore higher than "tests pass": every PR must prove **(a)** no behaviour changed, **(b)** no latency was added to the buzz path or any per-round host click, **(c)** no console/CSP errors on prod, **(d)** the design was implemented as specified, and **(e)** accessibility did not regress. This document is the checklist for all five.

---

## 0. Ground rules

1. **One visual concern per PR.** Tokens → typography → components → page X → motion → cleanup. A PR that touches `BuzzButton`, `TeamGameplayPage`, `useBuzzer`, or `DisplayPage` gets the `run-e2e` label so the label-gated Playwright suite actually runs (docs-only / CSS-only PRs otherwise run CodeQL alone — see `lessons-learned` 2026-07-10 and 2026-07-11).
2. **Tests are updated in the same PR, with a one-line reason per changed assertion.** A test that breaks because copy or a glyph changed is expected; a test that breaks because a state stopped existing is a regression and blocks the PR.
3. **Nothing on the buzz path.** The pointerdown → `buzz_in` RPC path in `BuzzButton.tsx` / `useBuzzer.ts` is not touched by the redesign. Visual feedback on the button may change only via CSS that animates `transform`, `opacity`, or `filter` (compositor properties). No new React state, no new effects, no layout animation, no JS-driven animation library instance on that component.
4. **No new dependency beyond the one already approved.** `@formkit/auto-animate` was approved by the maintainer on 2026-09-17 for the Display chunk only (README decision 7; repo rule `.claude/rules/dependencies.md` satisfied in-chat). Anything else needs its own flag and approval, with a line in the PR description explaining why CSS was insufficient (see [03-library-evaluation.md](03-library-evaluation.md)).
5. **Binary assets (fonts, images) are confirmed with the maintainer before `git add`** (repo rule: `.claude/rules/binary-assets.md`; planning rule D-9 = small optimized binaries in-repo, each confirmed).
6. **Docs-as-spec.** If a PR changes a documented UI contract (e.g. `docs/game-rules.md` copy, the manager console one-screen constraint from #177, the Display top-5 rule from #179), the doc is updated in the same PR.
7. **CHANGELOG.** Every user-visible step gets a `[Unreleased]` line (repo rule: `.claude/rules/changelog.md`).

---

## 1. Baseline capture (done ONCE, before the first redesign PR merges)

Record these on `main` so every later PR can be compared against a number, not a memory. Store the results in `docs/planning/ui-redesign/baseline/` (text files + a few screenshots; screenshots need the binary-asset confirmation, otherwise keep them in the PR description).

| Baseline | How to capture | Why |
|---|---|---|
| **Bundle sizes** | `cd frontend && npm run build`, copy the `dist/assets` listing (name, bytes, gzip) | A redesign should not grow the eager `index-*.js` + `vendor-*.js` + CSS by more than the budget in §5 |
| **Test counts** | `npm run test:run` (vitest total), `ls tests/e2e/*.spec.ts` (18 specs) | Proves no test was silently deleted |
| **Coverage** | `npm run test:coverage` (thresholds 85/80/85/85 in `vitest.config.ts`) | Thresholds must still be met after new components are added |
| **Route screenshots** | Claude in Chrome (or Playwright): `/`, `/how-to-play`, `/join`, `/manager/create`, `/display` at 1280×800 and 1920×1080; in-game screens via a throwaway prod game (recipe in §8) at 1280×800 (Display, console) and a real phone at 390×844 (team + console) | Visual "before" for the review; also proves the harness works before the redesign lands |
| **Buzz latency** | Grafana Loki/Tempo `sound-clash-web` spans: p50/p95 of the buzz span and `realtime.fanout_ms` over the last 7 days (read-only Grafana MCP) | The after-numbers must be statistically indistinguishable |
| **Lighthouse** | Chrome DevTools Lighthouse, mobile preset, on `/` and `/join`: Performance, Accessibility, Best Practices | Accessibility score must not drop; Performance must not drop more than noise |
| **Console** | Open every route on prod with DevTools; expect zero errors and zero CSP reports | The new fonts/assets must not introduce a single CSP violation |
| **Manager console fit** | Measure `getBoundingClientRect().bottom` of every `[data-testid^="score-"]`, `continue-round`, `start-round`, `end-game` at 390×844 / 375×667 / 360×640 (harness from lessons-learned 2026-07-13 #177) | Constraint: all six action buttons above the fold, page does not scroll |
| **Display TV fit** | At 1920×1080 and 1280×720, `document.documentElement.scrollHeight <= innerHeight` with 5 teams + QR panel | Constraint from #179/`display_fit.spec.ts` |

---

## 2. Per-PR gate ladder

Run in this order; stop at the first red.

### 2.1 Local (before push)

```
cd frontend
npm run format:check          # prettier — CI runs this as a SEPARATE step; lint alone does not catch it
npm run lint                  # eslint (hand-maintained globals allowlist — add e.g. `ViewTransition`, `startViewTransition` if referenced)
npm run typecheck
npm run test:run              # all vitest suites, no skips (it.skip/test.skip are banned in src/)
npm run test:coverage         # thresholds still met
npm run build                 # tsc -b + vite build; compare dist/assets sizes with the baseline (§1)
```

Then, for any PR touching a page under test in e2e:

```
supabase start && ./db/migrate.sh local && psql < db/seed/songs.sql   # local stack
cd tests/e2e && npx playwright test <affected specs> --project=chromium
npx playwright test mobile_team.spec.ts --project=chromium            # this spec configures its own iPhone 12 viewport; the declared "mobile" project is never run in CI
```

Never run the backend db pytest suite against the same local stack you are using for e2e (it truncates the catalog — lessons-learned 2026-07-06); the redesign never needs the backend suite anyway.

### 2.2 CI (on the PR)

- `Frontend / lint + type + test` green (includes the Prettier step and coverage thresholds).
- CodeQL green.
- If labelled `run-e2e`: the **labelled** run's own conclusion is what counts (`gh run view <id> --json status,conclusion`), not `gh pr checks` and not the watch exit code (lessons-learned 2026-07-08). The YouTube `data-ready` flake (#222) is known; rerun up to 3× only when the failures are exclusively `youtube-player`/`data-ready` across unrelated specs.
- **Merge readiness — the step that makes the PR mergeable.** `main` has *required conversation resolution* (and no required checks, no required reviews). GitHub Advanced Security posts CodeQL findings as inline review threads authored by `github-advanced-security` (e.g. `js/http-to-file-access` on anything that fetches and writes, as on Task 0's font-fetch script), and one unresolved thread blocks the merge with "All comments must be resolved" even though `gh pr checks` is all-green; only `gh pr view <n> --json mergeStateStatus` shows the `BLOCKED`. After the **last** push (a new push re-runs CodeQL) and once the checks are complete, list and resolve:

  ```
  gh api graphql -f query='query { repository(owner:"BenArtzi4", name:"Sound-Clash") { pullRequest(number:N) { mergeStateStatus reviewThreads(first:20) { nodes { id isResolved path line comments(first:1) { nodes { author { login } body } } } } } } }'
  gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"PRRT_…"}) { thread { isResolved } } }'
  ```

  Resolve only **bot-authored** threads (`github-advanced-security`, `dependabot`, `github-actions`); a maintainer's thread is answered, never resolved by the session. Re-query until `mergeStateStatus` is `CLEAN` — that is the definition of done for a session. The underlying code-scanning alert stays in the Security tab for the maintainer to dismiss ("used in tests" / "won't fix"); the session never dismisses alerts, and it never merges.

### 2.3 Preview before merge

- Cloudflare Pages only deploys `main`; there is no branch preview in this repo. Preview by running `npm run build && npm run preview -- --host` and opening the LAN URL on a real phone (Android + iPhone) and on the TV browser. Record which devices were used in the PR description.
- Neither the Vite dev server (used by e2e) nor `vite preview` applies `public/_headers`, so the CSP is **only** enforced on prod. The "fonts load under CSP" check therefore happens in the post-merge pass (§2.4 / §8), never earlier — which is one more reason the fonts ship in their own inert PR first.
- Reduced-motion check: DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce" — every page must remain fully usable with no motion.

### 2.4 Post-merge prod verification (within 15 minutes of the deploy)

```
node tests/smoke/ui_prod_pass.mjs all    # sandbox disabled; scripts this section + §8, exit 0 = every hard gate green
```

The script does the following by hand-equivalent steps (kept here so a failure can be reproduced piecewise):

```
curl -s "https://www.soundclash.org/?cb=$(date +%s)"    # cache-bust index.html; confirm NEW chunk hashes
```

- Fetch the new `index-*.js` / `*.css` chunk and grep for a marker of the change (e.g. the new font-family name or a new class) — proves the deploy shipped the merged tree (lessons-learned 2026-07-16).
- `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org` (needs the sandbox disabled).
- Claude in Chrome visual pass (§8) on the touched routes, including console + network checks.
- Sentry: no new issue in the 24 h after the deploy (check the next session).

---

## 3. Regression surface — what must not change

The full inventory is in [02-current-state-audit.md](02-current-state-audit.md) §3–§4. The rules for using it:

| Surface | Rule |
|---|---|
| **`data-testid` values** (46 in `frontend/src`, 32 used by e2e) | Keep every one, on the same semantic element. A redesign may wrap or restyle, never rename. New elements get new ids. |
| **Visible text that tests assert on** (`getByText`, `toHaveTextContent`, role names) | Copy changes are allowed but every changed string is listed in the PR description with the test that was updated. The BUZZ labels (`BUZZ`, `BUZZED!`, `YOU BUZZED`, `SOMEONE ELSE BUZZED`, `WAITING`, `CONNECTING…`, `RECONNECTING…`) and the manager button labels are contract text used by e2e — treat as frozen unless the maintainer approves. |
| **`data-tone` / `data-ready` / `data-team-id` attributes** | Frozen. E2E polls them. |
| **ARIA roles, labels, live regions** | Frozen or improved (adding a label is fine; removing one is a regression). |
| **Load-bearing class names** | With `css: false`, vitest resolves CSS-module names to `_<key>_<hash>`, so substring matchers still bind to the key. Exactly five names are asserted: module keys `bigRowGold` / `bigRowSilver` / `bigRowBronze` (e2e `ten_teams_thirty_rounds`), `songLine` (e2e `manager_cleanup_yt_csp`), `cover` / `coverHidden` (`YouTubePlayer.test.tsx`), and the global class `btn-danger` (`ConfirmDialog.test.tsx`). Keep those keys; restyle their bodies freely; every other class name is free. |
| **Display row markup** | `<ol style="--rows:N">` of `<li data-team-id data-rank>` with exactly three spans (rank, name, score) and `data-density="normal"` on `<main>` — frozen (five tests read spans positionally; `display_fit` reads geometry). |
| **Element counts** (Display top-5, `more-teams` hint, podium top-3) | Frozen. |
| **Route paths and query/hash contracts** (`/join/:code`, `#token=` host recovery, `location-hash`) | Frozen. |
| **localStorage keys** (`game:<code>:team`, `game:<code>:manager-token`, admin password key) | Frozen. |
| **Emoji glyphs** (🎬 🎵 🎤 🔊 🥇🥈🥉 ★ ✓) | Being removed on purpose. Each replacement must (1) keep the `aria-label`/`aria-hidden` semantics, (2) update the tests that assert on the glyph (listed in the audit), (3) keep the `data-testid`. |
| **Display `???` placeholder** | Replaced by masked blocks (decision 8). The six assertions on the literal text (`DisplayPage.test.tsx` ×4, `ten_teams_thirty_rounds.spec.ts:617,626`) are rewritten in the same PR to assert `data-revealed="false"` / the revealed title text; the reveal-row `data-testid`s and the one-row/two-row DOM-presence contract stay. |

---

## 4. Behaviour invariants (verified per page, every PR that touches the page)

Each row is a manual or scripted check; "How" names the fastest reliable way.

### 4.1 Global

| Invariant | How |
|---|---|
| Every route renders with zero console errors and zero CSP violations | Claude in Chrome `read_console_messages` per route; Network tab filtered to `(blocked:csp)` |
| Deep links work cold: `/join/ABCDEF`, `/team/ABCDEF`, `/display/ABCDEF`, `/manager/game/ABCDEF#token=…` | Navigate directly; expect the correct screen, not a redirect home |
| Lazy-route fallback still shows the logo pulse, and a stale-chunk error still auto-reloads | Throttle network in DevTools; simulate by renaming a chunk locally |
| `prefers-reduced-motion: reduce` disables every animation and every route transition | DevTools emulation; `document.getAnimations().length === 0` after settle |
| `pointer: coarse` devices never rely on hover: no hover-only affordance, no sticky-hover flash (#282) | Real phone; computed `-webkit-tap-highlight-color` = `rgba(0,0,0,0)` on buttons |
| Fonts: no FOIT on the BUZZ label; Hebrew titles render in a face with Hebrew coverage or a clean fallback | `document.fonts.check('900 1em <Display face>')` true after load; visual check with a Hebrew round (the throwaway game in §8 draws Israeli genres) |
| PWA still installs; `sw.js` untouched | Chrome "Install app" prompt on prod; `git diff --stat` shows no `public/sw.js` change |
| Theme colour / colour-scheme meta match the new palette | `index.html` review |

### 4.2 Team page (`/team/:code`) — the buzz path

| Invariant | How |
|---|---|
| pointerdown fires `buzz_in` before any visual work; the pressed state appears on the same frame | Playwright: measure `pointerdown` → `data-tone="pending"` (< 16 ms) and → RPC request start (< 5 ms), using `page.evaluate(() => performance.now())` around `dispatchEvent` and `page.waitForRequest(/buzz_in/)` |
| Locked-other / winner / waiting tones all still reachable and correctly coloured | Vitest tone tests + e2e `multi_buzz_round.spec.ts`, `wrong_buzz_recovery.spec.ts` |
| Provisional-lock TTL (#261) and stale-lock backstop (#259) unaffected | `TeamGameplayPage.provisionalStranding.test.tsx`, `TeamGameplayPage.staleLock.test.tsx`, e2e `buzzer_realtime_drops.spec.ts` |
| Point-change pill still appears once per score delta and clears | Vitest + visual |
| Standing chip (`standing-rank`, `standing-score`) shows from join and updates live | e2e `mobile_team.spec.ts` |
| End/expiry: podium renders from the snapshot; expired banner shown | e2e `expiration.spec.ts`, `full_game.spec.ts` |
| 60 fps while the idle pulse runs on a low-end Android | Chrome remote-debug Performance recording on a real phone; no layout/paint per frame from the pulse (only composite) |

### 4.3 Manager console (`/manager/game/:code`)

| Invariant | How |
|---|---|
| All six actions (Song / Artist / Wrong / Bonus / Continue / Next) + End game above the fold at 390×844, 375×667, 360×640, 412×915, 430×932; page does not scroll during a round | The #177 harness: `[data-testid]` bottoms ≤ `innerHeight`; `document.documentElement.scrollHeight <= innerHeight` |
| Optimistic toast fires before the RPC resolves; disabled states while pending | `ManagerConsolePage.test.tsx` (2284 lines — the largest safety net in the repo; must stay green untouched or with listed edits) |
| YouTube player double-buffer (`youtube-player` + `youtube-player-preload`) both stay mounted and visible (never `display:none`) | e2e `manager_cleanup_yt_csp.spec.ts`; DOM check |
| Backup host link + Reconnect a team flows unchanged | e2e `host_recovery.spec.ts`, `team_rejoin.spec.ts` |
| Expiry banner + Keep playing +1h | e2e `expiration.spec.ts`; vitest |

### 4.4 Display (`/display/:code`)

| Invariant | How |
|---|---|
| Top-5 board + "+N more teams" hint; dense rank; no scroll at ≥769px with 5 teams + QR | e2e `display_fit.spec.ts`, `ten_teams_thirty_rounds.spec.ts` (label `run-e2e`) |
| Song/artist reveal rows and token chips reflect claims (`revealRowOpen`, `tokenChipClaimed`) | `DisplayPage.test.tsx` |
| Buzz banner + countdown appear within one Realtime fan-out of the lock; row reorder does not jank | Visual; `document.getAnimations()` shows only transform/opacity keyframes |
| Final podium + confetti replaced/kept per spec, no re-mount across ended → swept | `EndScreen.test.tsx`; e2e `full_game.spec.ts` |

### 4.5 Home / Join / Create / How to play

| Invariant | How |
|---|---|
| Home pre-warms backend + genres on mount | `HomePage.test.tsx` |
| Join: 6-char code + 30-char name limits, counters, same-name reclaim copy, 409 handling, spinner + timeout (#283) | `JoinTeamPage.test.tsx`; e2e `team_rejoin.spec.ts` |
| Create: six presets, genre + decade pills, ≥1 genre required, create spinner, no tap flash on touch | `ManagerCreateGamePage.test.tsx`; real-phone tap check |
| How to play: content unchanged (copy may be restyled); hero image decision per README §Open questions | Visual |

---

## 5. Performance budget

| Metric | Budget | How measured |
|---|---|---|
| Eager JS (`index-*.js` + `vendor-*.js`, gzip) | baseline + ≤ 8 KB (zero-dependency plan) / + ≤ 20 KB if the one-dependency option is approved | `npm run build` listing vs baseline |
| CSS (all chunks, gzip) | baseline + ≤ 10 KB | same |
| Fonts | ≤ 2 self-hosted woff2 faces, ≤ 120 KB total, `font-display: swap`, `<link rel="preload">` for the display face used by the BUZZ label, subset to Latin + Hebrew | file sizes; Network tab; `_headers` gets a `/fonts/*` immutable cache rule |
| Images | no new raster > 200 KB; the 2.3 MB `how-to-play-hero.png` is replaced or converted (open question in README) | file sizes |
| INP (Interaction to Next Paint) on the BUZZ press, mid-range Android | ≤ 100 ms | Chrome DevTools Performance on a real device; Faro web-vitals if enabled |
| Buzz span p95 (Grafana) | no increase beyond weekly noise vs baseline | Loki/Tempo query, 7 days after each buzz-page PR |
| Long tasks during a route transition | none > 50 ms on desktop; none > 100 ms on phone | Performance panel |
| Animated properties | only `transform`, `opacity`, `filter` (brightness only, never blur), `clip-path`, `visibility`; never width/height/top/left/margin/box-shadow-spread on the hot paths | Script: iterate `document.getAnimations()`, read `effect.getKeyframes()`, flag any other property (run in the §8 pass) |
| **Bundle guard** — the approved library lives only in the Display chunk | `auto-animate` appears in `DisplayPage-*.js` and in **no other** chunk (`index-*.js`, `vendor-*.js`, `TeamGameplayPage-*.js`, `ManagerConsolePage-*.js`, `useGameChannel-*.js`); `framer-motion`, `lenis`, `gsap` appear nowhere | A 10-line check after `npm run build` (vitest or a CI step): grep over `dist/assets/` |
| **Listener guard** — no non-passive touch/wheel listeners on the buzz screen | zero non-passive `touchstart`/`touchmove`/`wheel` listeners on `window`/`document` at `/team/:code` | Playwright: `page.addInitScript` wraps `addEventListener` to record `{type, passive}` on window/document; assert after the page settles |
| **View-transition guard** — `startViewTransition` only from the navigation hook | the string `startViewTransition` appears in exactly one source file (`hooks/useViewTransitionNavigate.ts`) | `grep -rl startViewTransition frontend/src --include=*.ts --include=*.tsx \| grep -v test` → one path; also an ESLint `no-restricted-properties` rule if cheap |

---

## 6. Accessibility gate

| Check | Target |
|---|---|
| Text contrast (WCAG AA) | ≥ 4.5:1 body, ≥ 3:1 large text; Display page ≥ 7:1 for scores/names (dim room, distance) |
| Focus visible on every interactive element, in the new palette | keyboard walk of each page |
| Tap targets | ≥ 44×44 CSS px on phones (buzz, pills, score buttons) |
| `aria-live` regions retained (`point-change`, Display banner, toasts) | audit §6 list |
| Reduced motion | §4.1 |
| Lighthouse Accessibility | ≥ baseline (no drop) |
| Screen-reader names | replaced emoji icons carry `aria-hidden` and a text/`aria-label` sibling exactly as today |

---

## 7. Cross-browser / device matrix

| Device | Pages | Notes |
|---|---|---|
| Chrome desktop (Windows) | all | primary dev browser; View Transitions supported |
| Safari iOS 17/18 (iPhone) | join, team, manager console | players' phones; verify `dvh`, tap-highlight, font rendering, View Transitions (Safari 18+) |
| Android Chrome (mid-range) | join, team, manager console | 60 fps buzz pulse; INP |
| Samsung Internet | team | common in Israel; fallback path |
| Firefox desktop | all | no same-document View Transitions → must degrade to an instant swap with no visual glitch |
| TV browser / laptop→HDMI Chrome 1920×1080 | display | font sizes, top-5 fit, QR legibility from 3 m |

---

## 8. The Claude-in-Chrome visual pass (scripted checklist)

Run after each merge on prod (`https://www.soundclash.org`, sandbox disabled for any Node-side calls). **Scripted** since Task 1: `node tests/smoke/ui_prod_pass.mjs all` performs steps 1–13 headlessly (Playwright's chromium from `tests/e2e`), writes the screenshots and `report.json` to `tests/smoke/.prod-pass/`, and prints PASS/FAIL per hard gate; open the screenshots (or `setup` a game and visit it) in Chrome for the eyeball part. Items the checklist wants at zero but that stay non-zero until their task lands are printed as soft findings: the emoji sweep (Task 2), the finished zero-length `fade-in-up` page animations still listed under reduced motion on `/` and `/how-to-play` (Task 4), and the reveal row's missing `dir` attribute (Task 9). Steps:

1. **Spin up a throwaway game** from the browser console (`javascript_tool`): read the Supabase URL + anon key out of `/assets/index-*.js`, `GET /rest/v1/genres`, `POST /games {selected_genres:[uuids]}`, join 4 teams, `POST /bonus` (≤ 50 points each) for distinct scores, `select_next_song`, `buzz_in` for one team; store `game:<code>:manager-token` and `game:<code>:team` in localStorage. Include an Israeli genre so a Hebrew title is drawn.
2. **Screenshots** at 1280×800 and 1920×1080: `/`, `/join`, `/manager/create`, `/how-to-play`, `/display/<code>`, `/manager/game/<code>`, `/team/<code>` (Chrome's minimum window width blocks true 390 px — use DevTools device emulation or a real phone for the phone views).
3. **Console**: `read_console_messages` with pattern `error|CSP|Refused|violat` → must be empty.
4. **Network**: no request blocked by CSP; fonts served from `/fonts/*` with `immutable` caching.
5. **Emoji sweep**: `document.body.innerText` matched against `/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{2605}]/u` → zero matches on every route/state (including the podium and the soundtrack badge).
6. **Font check**: `document.fonts.check('700 1em "<DisplayFace>"')` true; `getComputedStyle(document.body).fontFamily` starts with the new family.
7. **Animation audit**: `document.getAnimations().map(a => a.effect.getKeyframes())` — every animated property in the allowed list (§5).
8. **Reduced motion**: DevTools emulation → `document.getAnimations().length === 0` after 1 s on every route.
9. **Manager console fit** at 390×844 emulation: bottoms of `score-title`, `score-artist`, `score-wrong`, `score-bonus`, `continue-round`/`start-round`, `end-game` ≤ `innerHeight`; `scrollHeight <= innerHeight`.
10. **Display fit** at 1920×1080: `scrollHeight <= innerHeight`; five `li[data-team-id]` rows; `[data-testid=more-teams]` absent with ≤ 5 teams.
11. **Route transition**: click Home → Host a game, Home → Join, Join → Team: no blank frame, no scroll jump (ScrollToTop still works), back button restores the previous page.
12. **Hebrew**: the reveal row shows the Hebrew title/artist right-to-left inside the LTR card without clipping.
13. **Cleanup**: `POST /games/<code>/end` with `X-Manager-Token`; close the tab.

---

## 9. Full-Game Exit Gate (EXECUTION-CONTRACT §5) — end of the redesign

The redesign is "done" only when a complete game plays end-to-end on production with the new UI:

create (a preset + a decade) → join from two real phones (one iPhone, one Android) → start → buzz race (both phones) → Correct Song / Correct Artist / Wrong / Continue → Bonus → Next round × 3 including one soundtrack round → Keep playing +1h → End → Final Results (Display + phones + console) → Export. With: Hebrew titles rendering, zero console errors on all three roles, Loki showing the buzz spans at baseline latency, and Sentry clean the next day.

---

## 10. Rollback

- Every PR is independently revertable (`git revert` of the squash commit); no migration, no backend change, no data.
- Cloudflare Pages keeps prior deployments — an instant rollback of `main` is `git revert` + push (auto-deploy) or the Pages dashboard "Rollback".
- Fonts and tokens ship first and are inert until components consume them, so the earliest PRs carry no user-visible risk.

## 11. Sign-off table (copy into each PR description)

```
- [ ] format:check / lint / typecheck / test:run / test:coverage green locally
- [ ] build size vs baseline: index __ KB (Δ __), vendor __ KB (Δ __), css __ KB (Δ __)
- [ ] regression surface: testids unchanged / text changes listed / class keys kept
- [ ] e2e specs run: __ (label run-e2e if buzz/display/console touched)
- [ ] reduced-motion emulation: usable, zero animations
- [ ] real-phone check: __ (device, OS)
- [ ] prod pass (§8) done post-merge: console clean, emoji sweep 0, fonts ok, fit ok
- [ ] CHANGELOG [Unreleased] line added
- [ ] merge-ready: checks green, bot review threads resolved (§2.2), mergeStateStatus CLEAN
```
