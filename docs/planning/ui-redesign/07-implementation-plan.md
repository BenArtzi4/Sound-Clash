# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **One task = one PR.** Each task starts from a fresh `main` (after the previous PR merged) on its own `feature/ui-*` branch.

**Goal:** Re-skin Sound Clash into the Rogue-Studio-derived dark design (black + warm cream + orange, Anton/Instrument Sans, no emojis, no gradients) with route transitions and element motion, without changing any behaviour, contract, or buzz-path code.

**Architecture:** Design tokens land first in `styles.css` and are inert until components consume them; fonts are self-hosted under `frontend/public/fonts/`; every emoji becomes an inline SVG from one `icons.tsx`; route transitions use the native View Transitions API through a ~25-line hook (react-router's `viewTransition` prop is a no-op in this app's declarative router); the Display board reorder uses `@formkit/auto-animate` imported only from the Display chunk. Pages are restyled one PR at a time, CSS-first, with tests updated in the same PR for the handful of asserted glyphs/copy.

**Tech Stack:** React 19, react-router-dom 7, Vite 8, TypeScript strict, CSS Modules, vitest + jsdom, Playwright. One new dependency: `@formkit/auto-animate` (approved 2026-09-17).

**Spec:** [README.md](README.md) (decisions) · [01-design-system.md](01-design-system.md) · [04-motion-and-transitions.md](04-motion-and-transitions.md) · [05-page-by-page.md](05-page-by-page.md) · [06-validation-plan.md](06-validation-plan.md) · [02-current-state-audit.md](02-current-state-audit.md) (regression surface).

## Global Constraints

- Never edit `BuzzButton.tsx`, `useBuzzer.ts`, `useGameChannel.ts`, `useScoring.ts`, `useSongPrebuffer.ts`, anything under `src/lib/`, the backend, or the DB. Buzz-screen changes are CSS-only.
- Frozen contracts (audit §4): every `data-testid`; `data-tone` / `data-ready` / `data-team-id` / `data-rank` / `data-density`; the Display row = `<li data-team-id data-rank>` with exactly three `<span>` children (rank, name, score); class keys `bigRowGold` / `bigRowSilver` / `bigRowBronze` / `songLine` / `cover` / `coverHidden` and global `btn-danger`; the wordmark's DOM text "Sound Clash"; `<label>`↔`<input>` pairs on Join / Create / Admin; the BuzzButton label + subtitle concatenated accessible name; `role="status"` on both buzz banners; `role="timer"` only on Display during a lock, with no digits other than the seconds inside it; the two mounted YouTube players.
- Copy is frozen except: Home headline/subtitle/visible role words (decision 4), and the `???` placeholder (decision 8). BUZZ labels, manager buttons, join/create copy, rules text: verbatim.
- Colour tokens, hex values, contrast rules, fonts, radii, motion tokens: exactly as in `01` §2–§4 and `04` §2. White on orange is forbidden (`--accent-ink` is black).
- Animate only `transform`, `opacity`, `filter` (brightness, never blur), `clip-path`, `visibility`. No `transition: all`. Hover rules only inside `@media (hover: hover)`.
- `document.startViewTransition` may be called from exactly one file: `src/hooks/useViewTransitionNavigate.ts`. Never on Realtime-driven updates.
- `@formkit/auto-animate` is imported only from `src/pages/DisplayPage.tsx`.
- Every PR: `cd frontend && npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run build`. Prettier runs on `.css` too. Commit messages: one line, no attribution. CHANGELOG `[Unreleased]` line for every user-visible PR (all of Tasks 1–10).
- PRs touching the Team, Console, or Display pages get the `run-e2e` label; watch the labelled run's own conclusion.
- **A task is done when its PR is merge-ready, not when it is open.** `main` requires conversation resolution, and GitHub Advanced Security posts CodeQL findings as inline review threads (author `github-advanced-security`) that block the merge with "All comments must be resolved" while `gh pr checks` looks all-green. So after `gh pr create`: wait for the checks to finish (`gh pr checks <n> --watch`), list the review threads and resolve every **bot-authored** one with the GraphQL recipe in `06` §2.2 (a maintainer's thread is answered, never resolved by the session), then confirm `gh pr view <n> --json mergeStateStatus` reports `CLEAN`. Do the resolving after the **last** push (a new push re-runs CodeQL). The code-scanning alert itself stays in the Security tab for the maintainer; the session never dismisses alerts. Report the gate output, the final merge state and the PR link, and stop. Never merge. Stop early only for a question the maintainer must answer: an unapproved binary asset or dependency, a change to `.github/workflows/`, or a red check that is not the known #222 YouTube flake.
- Font files and any raster are binary assets: list them with sizes in the PR description (approval already given for the five woff2 files in decision 3).

---

### Task 0: Fonts (inert) + font cache headers

**Files:**
- Create: `frontend/scripts/fetch-fonts.mjs`
- Create: `frontend/public/fonts/anton-latin.woff2`, `frontend/public/fonts/instrument-sans-latin.woff2`, `frontend/public/fonts/secular-one-hebrew.woff2`, `frontend/public/fonts/heebo-hebrew.woff2` (+ `heebo-hebrew-700.woff2` if Heebo is served as two static files rather than one variable file)
- Create: `frontend/src/fonts.css`
- Modify: `frontend/src/main.tsx:7` (import the font CSS before `styles.css`)
- Modify: `frontend/public/_headers` (add `/fonts/*`)
- Modify: `frontend/index.html` (preload the display face)
- Modify: `frontend/eslint.config.js` (`eslint .` lints `scripts/**/*.mjs`; give that block the Node globals `console`/`fetch`/`process`, mirroring the `public/sw.js` block)
- Test: `frontend/src/fonts.test.ts`

**Interfaces:**
- Produces: `@font-face` families `"Anton"`, `"Instrument Sans"`, `"Secular One"`, `"Heebo"` available to every stylesheet; nothing references them yet.

- [x] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feature/ui-0-fonts
```

- [x] **Step 2: Write the fetch script (dev tooling, not shipped)**

Google Fonts serves per-script woff2 subsets when asked with a modern user agent; the script pulls the four families, keeps only the `latin` (Anton, Instrument Sans) and `hebrew` (Secular One, Heebo) blocks, and writes them under `public/fonts/`. All four are OFL.

```js
// frontend/scripts/fetch-fonts.mjs
// Usage: node scripts/fetch-fonts.mjs   (from frontend/)
import { mkdir, writeFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const FAMILIES = [
  { css: "Anton", subset: "latin", out: "anton-latin.woff2" },
  { css: "Instrument+Sans:wght@400..700", subset: "latin", out: "instrument-sans-latin.woff2" },
  { css: "Secular+One", subset: "hebrew", out: "secular-one-hebrew.woff2" },
  { css: "Heebo:wght@400..900", subset: "hebrew", out: "heebo-hebrew.woff2" },
];

await mkdir("public/fonts", { recursive: true });
for (const f of FAMILIES) {
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${f.css}&display=swap`, {
    headers: { "User-Agent": UA },
  }).then((r) => r.text());
  // Blocks look like: /* hebrew */ @font-face { ... src: url(https://fonts.gstatic.com/...woff2) format('woff2'); unicode-range: U+0590-05FF, ... }
  const block = css.split("/* ").find((b) => b.startsWith(`${f.subset} */`));
  if (!block) throw new Error(`no ${f.subset} block for ${f.css}`);
  const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
  if (!url || !range) throw new Error(`could not parse ${f.css}`);
  const bytes = new Uint8Array(await fetch(url).then((r) => r.arrayBuffer()));
  await writeFile(`public/fonts/${f.out}`, bytes);
  console.log(`${f.out}\t${bytes.length} bytes\tunicode-range: ${range}`);
}
```

- [x] **Step 3: Run it and record the sizes + unicode ranges it prints**

```bash
cd frontend && node scripts/fetch-fonts.mjs && ls -la public/fonts
```

Expected: four files, total ≤ 150 KB. Copy the printed `unicode-range` values into Step 4. If Heebo's variable file exceeds 40 KB, request `Heebo:wght@400;700` instead and write two files (`heebo-hebrew-400.woff2`, `heebo-hebrew-700.woff2`).

- [x] **Step 4: Write the failing test**

```ts
// frontend/src/fonts.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("fonts.css", () => {
  // Resolve via import.meta.dirname rather than `new URL(..., import.meta.url)`:
  // under the jsdom environment the global URL is jsdom's and resolves relative
  // paths against http://localhost/, not the file base (verified 2026-09-17).
  const css = readFileSync(join(import.meta.dirname, "fonts.css"), "utf8");
  it("declares the four self-hosted faces with swap and unicode-range", () => {
    for (const family of ["Anton", "Instrument Sans", "Secular One", "Heebo"]) {
      expect(css).toContain(`font-family: "${family}"`);
    }
    expect(css.match(/font-display: swap/g)?.length).toBeGreaterThanOrEqual(4);
    expect(css.match(/unicode-range:/g)?.length).toBeGreaterThanOrEqual(4);
    expect(css).not.toMatch(/https?:\/\//); // same-origin only (CSP has no font-src)
  });
});
```

- [x] **Step 5: Run it to see it fail**

Run: `cd frontend && npx vitest run src/fonts.test.ts`
Expected: FAIL (`fonts.css` does not exist).

- [x] **Step 6: Write `fonts.css`** (paste the ranges printed in Step 3; the ones below are Google's current latin/hebrew subsets and are correct as of 2026-09)

```css
/* Self-hosted, OFL. Served from /fonts/* (same origin — the CSP has no font-src,
   so default-src 'self' applies). Latin faces carry no Hebrew glyphs on purpose:
   the browser falls through per text run to Secular One / Heebo, so a Hebrew song
   title inside an English UI renders at matching weight. */
@font-face {
  font-family: "Anton";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/anton-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "Instrument Sans";
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
  src: url("/fonts/instrument-sans-latin.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
    U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "Secular One";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("/fonts/secular-one-hebrew.woff2") format("woff2");
  unicode-range: U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F;
}
@font-face {
  font-family: "Heebo";
  font-style: normal;
  font-weight: 400 900;
  font-display: swap;
  src: url("/fonts/heebo-hebrew.woff2") format("woff2");
  unicode-range: U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F;
}
```

- [x] **Step 7: Wire it in**

`frontend/src/main.tsx` — add `import "./fonts.css";` on the line before `import "./styles.css";`.

`frontend/public/_headers` — append after the `/icons/*` block:

```
# Self-hosted fonts: content is versioned by file name, safe to cache forever.
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
```

`frontend/index.html` — inside `<head>`, after the `<link rel="manifest">` line:

```html
    <!-- The display face draws the BUZZ label and every headline; preload it so
         it is resolved before first paint instead of swapping in mid-round. -->
    <link rel="preload" href="/fonts/anton-latin.woff2" as="font" type="font/woff2" crossorigin />
```

- [x] **Step 8: Run the test and the full gate**

```bash
cd frontend && npx vitest run src/fonts.test.ts && npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run build
```

Expected: all green; `dist/` build output unchanged in size except `index-*.css` (+~1 KB).

- [x] **Step 9: Commit and open the PR**

```bash
git add frontend/scripts/fetch-fonts.mjs frontend/public/fonts frontend/src/fonts.css frontend/src/fonts.test.ts frontend/src/main.tsx frontend/public/_headers frontend/index.html
git commit -m "Self-host Anton, Instrument Sans, Secular One and Heebo (inert until the redesign tokens land)"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -u origin feature/ui-0-fonts
gh pr create --title "Self-host the redesign fonts (inert)" --body-file <body listing the four files with byte sizes and licences>
```

No CHANGELOG line (nothing visible yet). After merge: `curl -sI https://www.soundclash.org/fonts/anton-latin.woff2` → 200 with `cache-control: public, max-age=31536000, immutable`.

---

### Task 1: Design tokens + global styles (the big-bang PR)

**Files:**
- Modify: `frontend/src/styles.css` (full rewrite, content below)
- Modify: `frontend/index.html:10-11` (meta), favicon data URI (line ~101)
- Modify: `frontend/public/manifest.webmanifest:11-12`
- Modify: `CHANGELOG.md`
- Test: `frontend/src/styles.test.ts`

**Interfaces:**
- Produces the token names every later task uses: `--bg --surface --surface-2 --border --border-strong --text --text-muted --text-dim --accent --accent-ink --accent-soft --bone --positive --positive-ink --negative --negative-ink --warning --warning-ink --shadow-modal --font-display --font-ui --font-mono --text-display-xl/l/m/s --text-title --text-body --text-caption --space-1..8 --radius-xs/sm/md/lg/pill --dur-instant/micro/state/route/enter/reveal/intro --ease-move/arrive/exit/overshoot --z-overlay/modal/toast`.
- Keeps the legacy aliases (`--color-*`, `--space-xs…2xl`, `--radius-sm/md/lg/pill`, `--shadow-sm/md/lg`, `--easing-spring`, `--font-display`) mapped onto the new palette so untouched page CSS renders in the new colours immediately.

- [ ] **Step 1: Branch** — `git checkout main && git pull && git checkout -b feature/ui-1-tokens`

- [ ] **Step 2: Write the failing test**

```ts
// frontend/src/styles.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

describe("styles.css design tokens", () => {
  it("defines the redesign palette and motion tokens", () => {
    for (const t of [
      "--bg: #000000",
      "--surface: #121111",
      "--accent: #ff7a00",
      "--accent-ink: #000000",
      "--bone: #e9e4d9",
      "--text-muted: #b4a88f",
      "--positive: #4ade80",
      "--negative: #f2352b",
      "--ease-move: cubic-bezier(0.645, 0.045, 0.355, 1)",
      "--ease-arrive: cubic-bezier(0.155, 0.055, 0.14, 1)",
      "--dur-route: 240ms",
    ]) {
      expect(css).toContain(t);
    }
  });
  it("has no gradients, no blur, no transition: all, and no light-mode background", () => {
    expect(css).not.toMatch(/linear-gradient|radial-gradient/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/#f8fafc|#e0e7ff|#dbeafe/);
  });
  it("keeps the legacy aliases so untouched modules still compile", () => {
    for (const alias of ["--color-primary:", "--space-md:", "--radius-md:", "--easing-spring:"]) {
      expect(css).toContain(alias);
    }
  });
  it("silences view-transition pseudo-elements under reduced motion", () => {
    expect(css).toMatch(/::view-transition-group\(\*\)[\s\S]*animation:\s*none/);
  });
});
```

Run: `cd frontend && npx vitest run src/styles.test.ts` → FAIL.

- [ ] **Step 3: Replace `frontend/src/styles.css` with this content**

```css
/* ==========================================================================
   Sound Clash design tokens — dark only, Rogue-Studio-derived.
   Spec: docs/planning/ui-redesign/01-design-system.md
   ========================================================================== */
:root {
  color-scheme: dark;

  /* Colour */
  --bg: #000000;
  --surface: #121111;
  --surface-2: #1c1a17;
  --border: rgba(233, 228, 217, 0.14);
  --border-strong: rgba(233, 228, 217, 0.32);
  --text: #ffffff;
  --text-muted: #b4a88f;
  --text-dim: rgba(255, 255, 255, 0.42);
  --accent: #ff7a00;
  --accent-ink: #000000; /* never white on orange (2.6:1) */
  --accent-soft: rgba(255, 122, 0, 0.14);
  --bone: #e9e4d9;
  --positive: #4ade80;
  --positive-ink: #000000;
  --negative: #f2352b;
  --negative-ink: #ffffff; /* large text only */
  --negative-soft: rgba(242, 53, 43, 0.12);
  --warning: #f6cc00;
  --warning-ink: #000000;
  --shadow-modal: 0 24px 64px rgba(0, 0, 0, 0.6);

  /* Type */
  --font-display: "Anton", "Secular One", Impact, "Arial Narrow Bold", sans-serif;
  --font-ui: "Instrument Sans", "Heebo", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --text-display-xl: clamp(3rem, 14vw, 7rem);
  --text-display-l: clamp(2.5rem, 5vw, 4.5rem);
  --text-display-m: clamp(2rem, 4vw, 3.25rem);
  --text-display-s: clamp(1.5rem, 2.5vw, 2.125rem);
  --text-title: 1.125rem;
  --text-body: 1rem;
  --text-caption: 0.75rem;

  /* Space / radius / z */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;
  --radius-xs: 4px;
  --radius-sm: 8px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-pill: 9999px;
  --z-overlay: 40;
  --z-modal: 9000;
  --z-toast: 9999;

  /* Motion (04-motion-and-transitions.md §2) */
  --dur-instant: 0ms;
  --dur-micro: 150ms;
  --dur-state: 250ms;
  --dur-route: 240ms;
  --dur-enter: 400ms;
  --dur-reveal: 600ms;
  --dur-intro: 800ms;
  --ease-move: cubic-bezier(0.645, 0.045, 0.355, 1);
  --ease-arrive: cubic-bezier(0.155, 0.055, 0.14, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --ease-overshoot: cubic-bezier(0.075, 0.82, 0.17, 1.34);

  /* Legacy aliases — kept for one release so untouched modules render in the
     new palette. Removed in the cleanup task. */
  --color-bg: var(--bg);
  --color-bg-elev: var(--surface);
  --color-card: var(--surface);
  --color-bg-tint: var(--surface-2);
  --color-text: var(--text);
  --color-text-dim: var(--text-muted);
  --color-text-mute: var(--text-dim);
  --color-primary: var(--accent);
  --color-primary-strong: var(--accent);
  --color-primary-soft: var(--accent-soft);
  --color-secondary: var(--positive);
  --color-secondary-strong: var(--positive);
  --color-secondary-soft: rgba(74, 222, 128, 0.12);
  --color-accent: var(--bone);
  --color-accent-strong: var(--bone);
  --color-accent-soft: rgba(233, 228, 217, 0.1);
  --color-warning: var(--warning);
  --color-danger: var(--negative);
  --color-success: var(--positive);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --space-xs: var(--space-1);
  --space-sm: var(--space-2);
  --space-md: var(--space-4);
  --space-lg: var(--space-5);
  --space-xl: var(--space-7);
  --space-2xl: var(--space-8);
  --shadow-sm: none;
  --shadow-md: none;
  --shadow-lg: none;
  --easing-spring: var(--ease-overshoot);
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--text-body);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1,
h2,
h3 {
  font-family: var(--font-display);
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 1;
  margin: 0;
  color: var(--text);
}

h1 {
  font-size: var(--text-display-m);
}
h2 {
  font-size: var(--text-display-s);
}
h3 {
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: var(--text-title);
  line-height: 1.3;
}

p {
  margin: 0;
}

a {
  color: var(--bone);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

button {
  font-family: inherit;
  cursor: pointer;
}

input,
select,
textarea {
  font-family: inherit;
  font-size: var(--text-body);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  min-height: 48px;
  padding: 10px 14px;
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition:
    border-color var(--dur-micro) var(--ease-move),
    outline-color var(--dur-micro) var(--ease-move);
}
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  border-color: var(--border-strong);
  outline-color: var(--accent);
}
input:disabled,
select:disabled,
textarea:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
::placeholder {
  color: var(--text-dim);
}

/* Buttons — same four role classes as before. */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 48px;
  padding: 0 22px;
  font-size: var(--text-title);
  font-weight: 600;
  line-height: 1.2;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color var(--dur-micro) var(--ease-move),
    border-color var(--dur-micro) var(--ease-move),
    color var(--dur-micro) var(--ease-move),
    transform var(--dur-micro) var(--ease-overshoot);
}
.btn:active:not(:disabled) {
  transform: scale(0.98);
  transition-duration: var(--dur-instant);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--accent);
  color: var(--accent-ink);
  border-color: var(--accent);
}
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-muted);
}
.btn-danger {
  background: transparent;
  color: var(--negative);
  border-color: var(--negative);
}
@media (hover: hover) {
  .btn:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--surface-2);
    text-decoration: none;
  }
  .btn-primary:hover:not(:disabled) {
    background: #ff8f2b;
    border-color: #ff8f2b;
    color: var(--accent-ink);
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: transparent;
    color: var(--text);
  }
  .btn-danger:hover:not(:disabled) {
    background: var(--negative-soft);
  }
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-5);
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.muted {
  color: var(--text-muted);
}

.error {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  align-self: flex-start;
  color: var(--negative);
  background: var(--negative-soft);
  border: 1px solid var(--negative);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.3;
}
.error::before {
  content: "!";
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--negative);
  color: var(--negative-ink);
  font-size: 0.75rem;
  font-weight: 800;
  flex-shrink: 0;
}

.code {
  font-family: var(--font-display);
  letter-spacing: 0.12em;
}

/* Section labels ("QUICK START", "GAME CODE") */
.caption {
  font-size: var(--text-caption);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.btn:focus-visible,
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Route transitions (Task 10 adds the hook; the CSS is inert until then). */
::view-transition-old(root) {
  animation: vt-out 100ms var(--ease-exit) both;
}
::view-transition-new(root) {
  animation: vt-in var(--dur-route) var(--ease-arrive) both;
}
::view-transition-group(wordmark) {
  animation-duration: var(--dur-route);
  animation-timing-function: var(--ease-move);
}
@keyframes vt-out {
  to {
    opacity: 0;
  }
}
@keyframes vt-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  /* The universal rule above does not reach the view-transition pseudo tree. */
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none !important;
  }
}
```

- [ ] **Step 4: Meta + manifest + favicon**

`frontend/index.html` lines 10–11 become:

```html
    <meta name="theme-color" content="#000000" />
    <meta name="color-scheme" content="dark" />
```

Replace the favicon `href` (the `data:image/svg+xml,...` value) with the monochrome mark:

```
data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23000'/%3E%3Cg fill='%23e9e4d9'%3E%3Crect x='8' y='24' width='9' height='18' rx='2'/%3E%3Crect x='21' y='14' width='9' height='36' rx='2'/%3E%3Crect x='34' y='6' width='9' height='52' rx='2'/%3E%3Crect x='47' y='20' width='9' height='26' rx='2'/%3E%3C/g%3E%3C/svg%3E
```

`frontend/public/manifest.webmanifest`: `"background_color": "#000000"`, `"theme_color": "#000000"`.

- [ ] **Step 5: Run the gate; review every page in `npm run dev`**

```bash
cd frontend && npx vitest run src/styles.test.ts && npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run build
```

Then `npm run dev`, open `/`, `/join`, `/manager/create`, `/display`, `/how-to-play` at 390 px and 1280 px. Expected: everything dark, Anton headings, Instrument Sans body, no white cards (the `--color-card` alias now maps to `--surface`), no visible regressions in layout. Page-specific hard-coded hexes (white cards on Join/Create, blue gradients on Home) still show — they are removed by Tasks 3–9.

- [ ] **Step 6: CHANGELOG + commit + PR (label none; frontend CI runs)**

`CHANGELOG.md` under `[Unreleased]` → `### Changed`: `- 2026-09-XX: New dark look across the app — black background, cream and orange palette, new typography (Anton / Instrument Sans). (PR #N)`

```bash
git add frontend/src/styles.css frontend/src/styles.test.ts frontend/index.html frontend/public/manifest.webmanifest CHANGELOG.md
git commit -m "Redesign tokens: dark palette, Anton/Instrument Sans type, motion tokens, legacy aliases"
```

Preview on a real phone (`npm run build && npm run preview -- --host`) before merging. Post-merge: §8 prod pass from `06`.

---

### Task 2: Icon set + emoji removal

**Files:**
- Create: `frontend/src/components/icons.tsx`, `frontend/src/components/icons.test.tsx`
- Modify: `frontend/src/components/SoundtrackBadge.tsx:17-22`, `SoundtrackBadge.module.css`
- Modify: `frontend/src/pages/DisplayPage.tsx:284-286, 299-301, 310-312, 328, 334`; `DisplayPage.module.css:729-740` (delete medal `::before` blocks)
- Modify: `frontend/src/components/EndScreen.tsx:91-152 (TrophyIcon), 222-226 (★)`
- Modify: `frontend/src/pages/HowToPlayPage.tsx:190-192`
- Modify: `frontend/src/components/HostRecoveryLink.tsx:97`, `frontend/src/components/TeamRescueModal.tsx:62, 151-153, 203`
- Modify: `frontend/src/pages/ManagerConsolePage.tsx:337-350`
- Modify: `frontend/src/context/ToastContext.tsx:81`
- Test: `frontend/src/pages/ManagerConsolePage.test.tsx:1521`, `tests/e2e/token_claim_constraints.spec.ts:31`

**Interfaces:**
- Produces: `NoteIcon, MicIcon, FilmIcon, SpeakerIcon, CheckIcon, LaurelIcon, ArrowRightIcon, ArrowLeftIcon, PhoneIcon, TvIcon, HostIcon, LinkIcon, RefreshIcon, QrIcon, CloseIcon, EqualizerMark` — each `(props: { className?: string; title?: string }) => JSX`, 24×24, `stroke="currentColor"`, `aria-hidden` unless `title` is given. Token chips gain `data-claimed="true|false"`.

- [ ] **Step 1: Branch** — `feature/ui-2-icons`

- [ ] **Step 2: Failing test**

```tsx
// frontend/src/components/icons.test.tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as icons from "./icons";

describe("icons", () => {
  it("every icon is a 24-grid stroke SVG, hidden from AT unless titled", () => {
    for (const [name, Icon] of Object.entries(icons)) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector("svg");
      expect(svg, name).not.toBeNull();
      expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      expect(svg!.getAttribute("stroke")).toBe("currentColor");
      expect(svg!.getAttribute("fill")).toBe("none");
      unmount();
    }
  });
  it("exposes a title as an accessible name when given", () => {
    const { container } = render(<icons.FilmIcon title="Soundtrack" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.querySelector("title")?.textContent).toBe("Soundtrack");
  });
});
```

Run: `npx vitest run src/components/icons.test.tsx` → FAIL.

- [ ] **Step 3: Write `icons.tsx`**

```tsx
// frontend/src/components/icons.tsx
// One hand-drawn line-icon set (design system §6). 24-unit grid, 1.75 stroke,
// currentColor, sized by the parent's font-size. Decorative by default; pass
// `title` to expose an accessible name (role="img").
import type { ReactNode } from "react";

interface IconProps {
  className?: string;
  title?: string;
}

function Icon({ className, title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(title ? { role: "img" } : { "aria-hidden": "true" })}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const NoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="16" cy="16" r="3" />
  </Icon>
);
export const MicIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </Icon>
);
export const FilmIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M3 15h18M8 4v16M16 4v16" />
  </Icon>
);
export const SpeakerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Icon>
);
export const LaurelIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4l2.2 4.6 5 .7-3.6 3.5.9 5L12 15.4l-4.5 2.4.9-5L4.8 9.3l5-.7L12 4z" />
  </Icon>
);
export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 12h16M13 5l7 7-7 7" />
  </Icon>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12H4M11 5l-7 7 7 7" />
  </Icon>
);
export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2" />
    <path d="M11 18h2" />
  </Icon>
);
export const TvIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="19" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
);
export const HostIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Icon>
);
export const LinkIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  </Icon>
);
export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v5h-5" />
  </Icon>
);
export const QrIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <path d="M14 14h3v3h-3zM20 14v3M17 20h4M14 20h1" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const EqualizerMark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 15v-6M9.5 19V5M14 17V7M18.5 15v-6" strokeWidth="2.5" />
  </Icon>
);
```

- [ ] **Step 4: Replace each glyph**

`SoundtrackBadge.tsx` lines 17–22:
```tsx
      <span className={styles.icon} aria-hidden="true">
        <FilmIcon />
      </span>
```
(import `FilmIcon` from `"./icons"`). `SoundtrackBadge.module.css`: `.badge { background: var(--accent-soft); color: var(--bone); border: 1px solid var(--accent); box-shadow: none; }` and `.icon { display: inline-flex; font-size: 1.1em; }`.

`DisplayPage.tsx`: replace `🎬` / `🎵` / `🎤` spans' content with `<FilmIcon />`, `<NoteIcon />`, `<MicIcon />` (keep the wrapping `<span className={styles.revealIcon} aria-hidden="true">`). Lines 328 and 334: replace the `✓` template with a `CheckIcon`:
```tsx
              Song {titleClaimedById ? <><CheckIcon /> {titleClaimedByName ?? "?"}</> : "open"}
```
(and the same for Artist). Add `data-claimed={titleClaimedById ? "true" : "false"}` / `data-claimed={artistClaimedById ? "true" : "false"}` to both chips.

`DisplayPage.module.css` lines 729–740: delete the three `::before { content: "🥇 " }` blocks. Add `.revealIcon { display: inline-flex; font-size: 1.5rem; color: var(--text-muted); }`.

`EndScreen.tsx`: delete the `TrophyIcon` function (lines 91–152) and its use (line 286 → `<span className={styles.trophy} aria-hidden="true"><LaurelIcon /></span>`); lines 222–226 `★` → `<LaurelIcon />` inside the existing `.crown` span. Keep the `WINNER`/`WINNERS` label untouched.

`HowToPlayPage.tsx:190-192`: `🔊` → `<SpeakerIcon />`.

`HostRecoveryLink.tsx:97` and `TeamRescueModal.tsx:203`: `"Copied ✓"` → `<><CheckIcon /> Copied</>`. `TeamRescueModal.tsx:151-153`: `← Back to teams` → `<><ArrowLeftIcon /> Back to teams</>` (test matches `/back to teams/i` — still passes).

`ToastContext.tsx:81` and `TeamRescueModal.tsx:62`: `×` → `<CloseIcon />` (both buttons already carry `aria-label`).

`ManagerConsolePage.tsx:337-350`:
```tsx
              <span
                className={`${styles.tokenChip} ${titleClaimedById ? styles.tokenChipClaimed : ""}`}
                data-testid="token-chip-title"
                data-claimed={titleClaimedById ? "true" : "false"}
              >
                Song {titleClaimedById ? <CheckIcon /> : "open"}
              </span>
```
(and Artist). `HomePage.tsx:75` `&rsaquo;` → `<ArrowRightIcon />`; `HowToPlayPage.tsx:236` `&lsaquo;` → `<ArrowLeftIcon />`.

- [ ] **Step 5: Update the two test-locked assertions**

`frontend/src/pages/ManagerConsolePage.test.tsx:1521`:
```ts
    expect(screen.getByTestId("token-chip-artist")).toHaveAttribute("data-claimed", "true");
```
`tests/e2e/token_claim_constraints.spec.ts:31`:
```ts
  await expect(manager.page.getByTestId("token-chip-title")).toHaveAttribute("data-claimed", "true");
```

- [ ] **Step 6: Prove no emoji remains**

```bash
cd frontend && PYTHONIOENCODING=utf-8 python -c "import re,pathlib;p=[str(f) for f in pathlib.Path('src').rglob('*') if f.suffix in('.tsx','.ts','.css') and '.test.' not in f.name and re.search('[\U0001F000-\U0001FAFF☀-➿★✓]',f.read_text(encoding='utf-8'))];print(p or 'clean')"
```
Expected: `clean` (the `…`, `—`, `·` typographic characters are allowed and are not matched).

- [ ] **Step 7: Gate, CHANGELOG (`### Changed`: emojis replaced by line icons across Display, results, console, how-to-play), commit, PR with label `run-e2e`**

```bash
git commit -m "Replace every emoji with a monochrome line-icon set; token chips expose data-claimed"
```

---

### Task 3: Wordmark + shell components

**Files:**
- Modify: `frontend/src/components/Logo.tsx`, `Logo.module.css` (full rewrite)
- Modify: `RouteFallback.module.css`, `ErrorBoundary.module.css`, `Skeleton.module.css`, `Toast.module.css`, `ConfirmDialog.module.css`, `TeamRescueModal.module.css` (palette/motion rules), `PointChange.module.css`, `QRPanel.module.css`, `ExpiryCountdown.module.css`, `HostRecoveryLink.module.css`
- Modify: `frontend/src/context/ToastContext.tsx` (exiting phase)
- Test: `frontend/src/components/Logo.test.tsx` (new), `frontend/src/context/ToastContext.test.tsx` (new, fake timers)

**Interfaces:**
- `Logo` keeps `size` and `animated` props and the DOM text "Sound Clash"; adds `viewTransitionName: "wordmark"` inline style on its root (used by Task 10).
- Toasts render `data-exiting="true"` for 160 ms before removal.

- [ ] **Step 1: Branch** — `feature/ui-3-shell`

- [ ] **Step 2: Failing tests**

```tsx
// frontend/src/components/Logo.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("keeps the literal wordmark text and names itself for view transitions", () => {
    render(<Logo size="large" />);
    const text = screen.getByText("Sound Clash");
    expect(text).toBeInTheDocument();
    expect(text.closest("[style]")?.getAttribute("style")).toContain("view-transition-name: wordmark");
  });
  it("renders the equaliser mark as an svg, not gradient bars", () => {
    const { container } = render(<Logo />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
```

```tsx
// frontend/src/context/ToastContext.test.tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./ToastContext";
import { useToast } from "./useToast";

function Trigger() {
  const { toast } = useToast();
  return <button onClick={() => toast("Saved", { durationMs: 1000 })}>go</button>;
}

describe("ToastProvider exit phase", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("marks the toast exiting for 160 ms before removing it", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => screen.getByText("go").click());
    expect(screen.getByRole("status")).not.toHaveAttribute("data-exiting");
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toHaveAttribute("data-exiting", "true");
    act(() => vi.advanceTimersByTime(160));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
```

Run both → FAIL.

- [ ] **Step 3: Logo**

```tsx
// frontend/src/components/Logo.tsx
import type { CSSProperties } from "react";
import { EqualizerMark } from "./icons";
import styles from "./Logo.module.css";

interface Props {
  size?: "small" | "medium" | "large";
  animated?: boolean;
}

// The DOM text must stay exactly "Sound Clash" (RouteFallback.test asserts it);
// uppercase is applied in CSS. The root carries view-transition-name so route
// transitions morph the wordmark between its header and hero positions.
export function Logo({ size = "medium", animated = true }: Props) {
  return (
    <div
      className={`${styles.logo} ${styles[size]}`}
      style={{ viewTransitionName: "wordmark" } as CSSProperties}
    >
      <span className={`${styles.mark} ${animated ? styles.animated : ""}`} aria-hidden="true">
        <EqualizerMark />
      </span>
      <span className={styles.text}>Sound Clash</span>
    </div>
  );
}
```

```css
/* frontend/src/components/Logo.module.css */
.logo {
  display: inline-flex;
  align-items: center;
  gap: 0.45em;
  color: var(--bone);
  user-select: none;
}
.text {
  font-family: var(--font-display);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1;
}
.small .text {
  font-size: 1.25rem;
}
.medium .text {
  font-size: 2rem;
}
.large .text {
  font-size: 2.5rem;
}
.mark {
  display: inline-flex;
  font-size: 1.15em;
}
.mark svg path {
  transform-origin: 50% 50%;
}
.animated svg path {
  animation: bar-bounce 1.2s var(--ease-move) infinite;
}
@keyframes bar-bounce {
  0%,
  100% {
    transform: scaleY(1);
  }
  50% {
    transform: scaleY(0.55);
  }
}
/* A playing round on the team page pauses the mark (04 §5 row 30). */
:global([data-round-live="true"]) .animated svg path {
  animation-play-state: paused;
}
```

(`EqualizerMark` draws the four bars as one `<path>`; the whole path scales — acceptable, or split into four `<path>` elements with `animation-delay` `0/.15/.3/.45s` for the staggered look.)

- [ ] **Step 4: Toast exit phase** — in `ToastContext.tsx`: add `exiting?: boolean` to `ToastItem`; `dismiss` first sets `exiting: true` on the item and schedules the real removal 160 ms later:

```ts
  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const dismiss = useCallback(
    (id: number) => {
      const handle = timersRef.current.get(id);
      if (handle !== undefined) {
        window.clearTimeout(handle);
        timersRef.current.delete(id);
      }
      setItems((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)));
      const exit = window.setTimeout(() => remove(id), 160);
      timersRef.current.set(-id, exit);
    },
    [remove],
  );
```
and render `data-exiting={t.exiting ? "true" : undefined}` on each toast `<div>`. `Toast.module.css`:
```css
.toast { /* replace the old animation line */
  animation: none;
  opacity: 1;
  transform: none;
  transition: opacity 160ms var(--ease-exit), transform 160ms var(--ease-exit);
  background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-modal); color: var(--text);
}
@starting-style { .toast { opacity: 0; transform: translateY(-8px); } }
.toast[data-exiting="true"] { opacity: 0; transform: translateY(-8px); }
.toast::before { background: var(--accent); }
.success::before { background: var(--positive); }
.error::before { background: var(--negative); }
.info::before { background: var(--bone); }
.close { color: var(--text-muted); display: inline-flex; }
```

- [ ] **Step 5: Restyle the other shell modules** (replace colours only; keep every class key):
  - `RouteFallback.module.css`: unchanged except nothing to change (pulse is opacity).
  - `ErrorBoundary.module.css`: `.card` → `background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: none;` `.button` → `background: var(--accent); color: var(--accent-ink); border-radius: var(--radius-sm);` remove `:hover` background change (keep under `@media (hover: hover)` with `#ff8f2b`).
  - `Skeleton.module.css`: `background: var(--surface-2); animation: skeleton-pulse 1.6s var(--ease-move) infinite;` with `@keyframes skeleton-pulse { 50% { opacity: 0.55; } }`; delete the gradient and `background-position` keyframes.
  - `ConfirmDialog.module.css` + `TeamRescueModal.module.css`: `.backdrop { background: rgba(0,0,0,0.7); }` (delete `backdrop-filter`), `.dialog { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-modal); animation: dialog-in var(--dur-state) var(--ease-arrive); }` and `dialog-in` from `opacity:0; transform: scale(0.98)`.
  - `PointChange.module.css`: `.pill { background: var(--surface); border: 2px solid var(--border); box-shadow: var(--shadow-modal); font-family: var(--font-display); }` `.positive { border-color: var(--positive); } .positive .delta { color: var(--positive); } .negative { border-color: var(--negative); } .negative .delta { color: var(--negative); } .team { color: var(--text); font-family: var(--font-ui); }`; delete the gradient backgrounds; keep the keyframes, set `point-in` easing to `var(--ease-overshoot)`.
  - `QRPanel.module.css`: `.panel { background: var(--surface); }` `.qrFrame { background: var(--bone); border: none; }` `.code { font-family: var(--font-display); color: var(--bone); letter-spacing: 0.12em; }` — delete every gradient and `background-clip`.
  - `ExpiryCountdown.module.css`: `.warning { background: var(--warning); border: none; color: var(--warning-ink); } .warningText { color: var(--warning-ink); } .extendBtn { background: var(--bg); color: var(--warning); border-color: var(--bg); }`.
  - `HostRecoveryLink.module.css`: swap hexes for `var(--surface)`, `var(--border)`, `var(--text-muted)`, `var(--bone)`; QR frame on `var(--bone)`.

- [ ] **Step 6: Gate, CHANGELOG (`### Changed`: wordmark, toasts, dialogs, loading states restyled), commit `Restyle the wordmark and shell components; toasts get an exit phase`, PR.**

---

### Task 4: Home + How to play

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`, `HomePage.module.css` (full rewrite)
- Create: `frontend/src/components/SetupSchematic.tsx`
- Modify: `frontend/src/pages/HowToPlayPage.tsx:1-3, 118, 130-136, 142-170`, `HowToPlayPage.module.css`
- Delete: `frontend/public/how-to-play-hero.png`; remove its `_headers` block
- Delete: `frontend/src/components/RoleIcons.tsx` (no remaining importers after this task)
- Test: `frontend/src/App.test.tsx:23`, `frontend/src/pages/HowToPlayPage.test.tsx:82-83`, `frontend/src/pages/HomePage.test.tsx` (unchanged — accessible names preserved via `aria-label`)

- [ ] **Step 1: Branch** — `feature/ui-4-home`

- [ ] **Step 2: Update the two tests first (they fail until Step 3)**

`App.test.tsx:23`: `name: /name the song/i`.
`HowToPlayPage.test.tsx:82-83`:
```ts
    const hero = screen.getByRole("img", { name: /three-screen setup/i });
    expect(hero.tagName.toLowerCase()).toBe("svg");
```

- [ ] **Step 3: HomePage.tsx**

```tsx
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon } from "../components/icons";
import { Logo } from "../components/Logo";
import { getHealth, listGenres } from "../lib/api";
import styles from "./HomePage.module.css";

const ROLES = [
  { to: "/manager/create", index: "01", title: "Host", desc: "Pick genres, run the rounds, score the room.", name: "Host a game" },
  { to: "/join", index: "02", title: "Play", desc: "Join from your phone with the code on the TV.", name: "Join a game" },
  { to: "/display", index: "03", title: "Display", desc: "Put the scoreboard and the QR code on the big screen.", name: "Display screen" },
] as const;

export function HomePage() {
  useEffect(() => {
    void getHealth().catch(() => undefined);
    void listGenres().catch(() => undefined);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Logo size="small" />
      </header>
      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Name the song. Buzz first.</h1>
          <p className={styles.subtitle}>Real-time music trivia for a room full of people and one TV.</p>
        </section>
        <nav className={styles.roles} aria-label="Choose your role">
          {ROLES.map((r, i) => (
            <Link key={r.to} to={r.to} className={styles.role} aria-label={r.name} style={{ "--i": i } as React.CSSProperties}>
              <span className={styles.roleIndex} aria-hidden="true">{r.index}</span>
              <span className={styles.roleBody}>
                <span className={styles.roleTitle}>{r.title}</span>
                <span className={styles.roleDesc}>{r.desc}</span>
              </span>
              <span className={styles.roleArrow} aria-hidden="true"><ArrowRightIcon /></span>
            </Link>
          ))}
        </nav>
        <p className={styles.howTo}>
          <Link to="/how-to-play">How to play <ArrowRightIcon /></Link>
        </p>
      </main>
    </div>
  );
}
```

`aria-label` keeps the accessible names "Host a game / Join a game / Display screen", so `HomePage.test.tsx`, `App.test.tsx:31,37`, `fixtures/manager-context.ts:43` and `manager_cleanup_yt_csp.spec.ts:189` stay untouched. Add `React` is already a global for types; use `import type { CSSProperties } from "react"` instead of `React.CSSProperties` if lint complains.

- [ ] **Step 4: HomePage.module.css** (full replacement)

```css
.page { min-height: 100%; display: flex; flex-direction: column; }
.header { padding: var(--space-5) var(--space-5) 0; }
.main { flex: 1; width: 100%; max-width: 1100px; margin: 0 auto; padding: var(--space-8) var(--space-5) var(--space-8); display: flex; flex-direction: column; gap: var(--space-7); }
.hero { display: flex; flex-direction: column; gap: var(--space-3); animation: rise var(--dur-intro) var(--ease-arrive) both; }
.title { font-size: var(--text-display-m); max-width: 14ch; }
.subtitle { color: var(--text-muted); font-size: var(--text-title); max-width: 40ch; }
.roles { display: flex; flex-direction: column; border-top: 1px solid var(--border); }
.role {
  display: grid; grid-template-columns: 3rem 1fr 2rem; align-items: center; gap: var(--space-4);
  min-height: 88px; padding: var(--space-4) 0; border-bottom: 1px solid var(--border);
  color: inherit; text-decoration: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  animation: rise var(--dur-intro) var(--ease-arrive) both; animation-delay: calc(120ms + var(--i) * 60ms);
  transition: background-color var(--dur-micro) var(--ease-move), transform var(--dur-micro) var(--ease-overshoot);
}
.role:active { transform: scale(0.995); transition-duration: var(--dur-instant); }
.role:hover { text-decoration: none; }
.roleIndex { font-family: var(--font-display); font-size: var(--text-title); color: var(--text-muted); letter-spacing: 0.06em; }
.roleBody { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.roleTitle { font-family: var(--font-display); font-size: var(--text-display-s); text-transform: uppercase; letter-spacing: 0.02em; color: var(--text); }
.roleDesc { color: var(--text-muted); font-size: var(--text-body); }
.roleArrow { display: inline-flex; font-size: 1.5rem; color: var(--bone); transition: transform var(--dur-micro) var(--ease-arrive); }
.howTo { animation: rise var(--dur-intro) var(--ease-arrive) both; animation-delay: 360ms; }
.howTo a { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--text-muted); font-weight: 600; }
@media (hover: hover) {
  .role:hover { background: var(--surface); }
  .role:hover .roleArrow { transform: translateX(4px); }
}
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
@media (max-width: 600px) { .main { padding: var(--space-6) var(--space-4); gap: var(--space-6); } .role { min-height: 72px; grid-template-columns: 2.5rem 1fr 1.5rem; } }
```

- [ ] **Step 5: `SetupSchematic.tsx`** — an inline SVG with `role="img"` and `aria-label="Three-screen setup: host's phone showing the Game Manager console, a TV displaying the scoreboard and join QR code, and team phones with the BUZZ button."`, `viewBox="0 0 960 360"`, three groups drawn with `stroke="currentColor"` `fill="none"` `strokeWidth="2"`: left a phone outline (`rect x=60 y=40 w=160 h=280 rx=18`) with four small rounded rects for the score buttons and the text `ABCDEF` in `var(--font-display)`; centre a TV (`rect x=300 y=60 w=360 h=210 rx=8` + stand) containing a 3-row bar list and a `QrIcon`-style 7×7 grid of squares; right two phone outlines each with a large rounded square labelled `BUZZ` (`fill="var(--accent)"`, text `fill="var(--accent-ink)"`). Wrap it in `<div className={styles.hero}>` in `HowToPlayPage.tsx` replacing the `<img>` (lines 130–136), delete the `heroImage` rule, and delete `public/how-to-play-hero.png` plus its `_headers` block.

- [ ] **Step 6: How-to-play restyle** — replace `RoleIcons` (lines 143–170) with `HostIcon` / `PhoneIcon` / `TvIcon` in the same spans; `HowToPlayPage.module.css`: drop the gradient header, `::after` stripe, `sectionTitle::after`, all `#…` hexes → tokens; `.flowNum` → `background: var(--surface-2); color: var(--bone); font-family: var(--font-display);` (the digits 1–7 stay the only bare digits on the page); `.faqRow`, `.scoringRow` → `background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--bone);`; `.chipGood { color: var(--positive); background: rgba(74,222,128,0.12); } .chipBad { color: var(--negative); background: var(--negative-soft); } .chipBonus { color: var(--bone); background: var(--surface-2); }`.

- [ ] **Step 7: Gate + `git rm frontend/src/components/RoleIcons.tsx frontend/public/how-to-play-hero.png`; CHANGELOG (`### Changed`: new Home page headline and role list; How to play hero replaced by a diagram); commit `Redesign Home and How to play; replace the illustrated hero with an SVG schematic`; PR.**

---

### Task 5: Join + Display code entry

**Files:**
- Modify: `frontend/src/pages/JoinTeamPage.module.css` (full rewrite), `JoinTeamPage.tsx:175-177` (Cancel becomes a ghost link above the primary on phones — markup unchanged, order via CSS)
- Modify: `frontend/src/pages/DisplayPage.module.css:25-83` (entry card rules)
- Tests: none change (`JoinTeamPage.test.tsx` asserts labels/text/spinner only)

- [ ] **Step 1: Branch** — `feature/ui-5-join`
- [ ] **Step 2: JoinTeamPage.module.css**

```css
.shell { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: var(--space-7) var(--space-4); }
.card { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: var(--space-5); }
@media (min-width: 601px) { .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-6); } }
.title { font-size: var(--text-display-m); }
.subtitle { color: var(--text-muted); margin-top: var(--space-2); }
.field { display: flex; flex-direction: column; gap: var(--space-2); }
.label { font-size: var(--text-caption); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); font-weight: 500; }
/* One input, six drawn cells: the cell boxes are a repeating gradient-free
   background image built from a 1px border colour, so the DOM stays a single
   <input maxLength=6> (tests + QR prefill depend on it). */
.codeInput {
  font-family: var(--font-display); font-size: 2rem; letter-spacing: 0.6em; text-indent: 0.6em; text-align: center;
  text-transform: uppercase; color: var(--bone); background-color: var(--surface-2);
  background-image: repeating-linear-gradient(90deg, transparent 0 calc(100% / 6 - 1px), var(--border) calc(100% / 6 - 1px) calc(100% / 6));
  min-height: 64px;
}
.codeInput::placeholder { color: var(--text-dim); letter-spacing: 0.6em; }
.counter { align-self: flex-end; font-size: var(--text-caption); color: var(--text-muted); font-variant-numeric: tabular-nums; }
.hint { font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; }
.spinner { display: inline-block; width: 1em; height: 1em; border: 2px solid rgba(0,0,0,0.25); border-top-color: var(--accent-ink); border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.helper { text-align: center; font-size: 0.9rem; color: var(--text-muted); }
.actions { display: flex; flex-direction: column-reverse; gap: var(--space-3); }
.actions :global(.btn-primary) { width: 100%; }
@media (min-width: 601px) { .actions { flex-direction: row; justify-content: flex-end; } .actions :global(.btn-primary) { width: auto; } }
```

(`repeating-linear-gradient` here draws 1 px cell dividers, not a colour gradient; the styles.test gradient ban applies to `styles.css` only.)

- [ ] **Step 3: Display entry** — mirror the same `.entryCard` / `.entryInput` / `.entryCounter` rules (dark surface, display face, cells), delete the `::before` stripe.
- [ ] **Step 4: Gate; CHANGELOG (`### Changed`: join and display code screens restyled); commit `Redesign the Join and Display code-entry screens`; PR.**

---

### Task 6: Host create

**Files:**
- Modify: `frontend/src/pages/ManagerCreateGamePage.module.css` (full rewrite), `ManagerCreateGamePage.tsx:231-238` (add `<CheckIcon />` inside the genre label after the input), `:268-282` (sticky bar class)
- Tests: unchanged (`getByLabelText` reads label text; an `aria-hidden` svg adds no text)

- [ ] **Step 1: Branch** — `feature/ui-6-create`
- [ ] **Step 2: Markup** — genre label becomes:
```tsx
                  <label key={g.id} className={`${styles.genre} ${isSel ? styles.genreSelected : ""}`}>
                    <input type="checkbox" checked={isSel} onChange={() => toggleGenre(g.id)} />
                    <span className={styles.genreCheck} aria-hidden="true"><CheckIcon /></span>
                    {g.name}
                  </label>
```
- [ ] **Step 3: CSS** — keep every selector name; key rules:
```css
.shell { min-height: 100%; padding: var(--space-6) var(--space-4) calc(var(--space-8) + 64px); max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-6); }
.field { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--space-5); gap: var(--space-3); box-shadow: none; }
.label, .presetsLabel { font-size: var(--text-caption); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); font-weight: 500; }
.presetRow { display: flex; gap: var(--space-2); overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; padding-bottom: 2px; }
.presetRow::-webkit-scrollbar { display: none; }
.preset { scroll-snap-align: start; flex: 0 0 auto; min-height: 44px; padding: 0 16px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--text); font-weight: 600; touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: background-color var(--dur-micro) var(--ease-move), border-color var(--dur-micro) var(--ease-move), color var(--dur-micro) var(--ease-move); }
.presetActive { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.genres { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-2); }
.genre { position: relative; display: flex; align-items: center; gap: var(--space-2); min-height: 56px; padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text); font-weight: 600; cursor: pointer; user-select: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: background-color var(--dur-micro) var(--ease-move), border-color var(--dur-micro) var(--ease-move); }
.genre input { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; opacity: 0; pointer-events: none; }
.genre:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.genreCheck { display: inline-flex; width: 20px; height: 20px; border: 1px solid var(--border-strong); border-radius: var(--radius-xs); color: var(--accent-ink); align-items: center; justify-content: center; font-size: 14px; }
.genreCheck svg path { stroke-dasharray: 24; stroke-dashoffset: 24; transition: stroke-dashoffset var(--dur-micro) var(--ease-arrive); }
.genreSelected { background: var(--accent-soft); border-color: var(--accent); }
.genreSelected .genreCheck { background: var(--accent); border-color: var(--accent); }
.genreSelected .genreCheck svg path { stroke-dashoffset: 0; }
.decades { display: flex; flex-direction: column; gap: var(--space-2); }
.decadeRow { display: flex; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
@media (min-width: 601px) { .decades { flex-direction: row; } .decadeRow { display: contents; } }
.decade { flex: 1 1 0; position: relative; display: flex; align-items: center; justify-content: center; min-height: 44px; background: var(--surface-2); color: var(--text-muted); font-weight: 600; cursor: pointer; user-select: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; border-right: 1px solid var(--border); }
.decade:last-child { border-right: 0; }
@media (min-width: 601px) { .decade { border: 1px solid var(--border); border-radius: var(--radius-sm); } }
.decade input { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; opacity: 0; pointer-events: none; }
.decade:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
.decadeSelected { background: var(--accent); color: var(--accent-ink); }
.actions { position: sticky; bottom: 0; display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); padding: var(--space-3) 0; background: var(--bg); border-top: 1px solid var(--border); }
.actions :global(.btn-primary) { flex: 1; }
@media (min-width: 601px) { .actions { position: static; border-top: 0; } .actions :global(.btn-primary) { flex: 0 0 auto; } }
.spinner { /* as Task 5 */ } .helper { /* as Task 5 */ }
@media (hover: hover) { .preset:hover, .genre:hover, .decade:hover { border-color: var(--border-strong); } .presetActive:hover { background: #ff8f2b; } }
```
Note the `(hover: hover)` gate keeps the #282 fix.

- [ ] **Step 4: Gate; real-phone tap check (no flash: one class change per tap); CHANGELOG; commit `Redesign the host create screen: chip row, toggle tiles, segmented decades, sticky action bar`; PR.**

---

### Task 7: Team / buzz screen (CSS only)

**Files:**
- Modify: `frontend/src/components/BuzzButton.module.css` (full rewrite), `frontend/src/pages/TeamGameplayPage.module.css` (colours + `data-round-live`)
- Modify: `frontend/src/pages/TeamGameplayPage.tsx:220` only to add `data-round-live={game?.status === "playing" ? "true" : "false"}` on the `<main>` (attribute only; no logic)
- Test: `frontend/src/components/BuzzButton.test.tsx` unchanged; add `tests/e2e/redesign_guards.spec.ts` (listener + latency guard)

- [ ] **Step 1: Branch** — `feature/ui-7-buzz`
- [ ] **Step 2: BuzzButton.module.css**

```css
/* Buzz-path CSS. Tone colours live on a ::before layer that crossfades with
   opacity (compositor) instead of transitioning background (paint). The label
   sits above it (z-index 1), the pulse ring on ::after. No JS changes. */
.button {
  --tone: var(--accent);
  --tone-ink: var(--accent-ink);
  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem;
  width: 100%; height: 100%; min-height: 0; border-radius: var(--radius-lg); border: none;
  background: var(--accent); color: var(--tone-ink);
  font-family: var(--font-display); font-size: var(--text-display-xl); font-weight: 400; letter-spacing: 0.02em; text-transform: uppercase; line-height: 0.95; text-align: center; padding: 1.5rem;
  cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; user-select: none;
  transition: color 180ms var(--ease-move), filter var(--dur-micro) var(--ease-move);
}
.button::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit; background: var(--tone); opacity: 0; z-index: 0; pointer-events: none;
  transition: opacity 180ms var(--ease-move);
}
.button::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; border: 3px solid rgba(0, 0, 0, 0.35); opacity: 0; z-index: 0; pointer-events: none;
  animation: buzz-pulse 2s var(--ease-arrive) infinite;
}
.button:active:not(:disabled), .pressed { filter: brightness(0.92); transform: scale(0.985); transition-duration: var(--dur-instant); }
.button:not(:active):not(.pressed) { transition: color 180ms var(--ease-move), filter var(--dur-micro) var(--ease-move), transform var(--dur-micro) var(--ease-overshoot); }
.button:focus-visible { outline: 4px solid var(--bone); outline-offset: -8px; }
.button:disabled { cursor: not-allowed; opacity: 1; }
.button:disabled::after { animation: none; opacity: 0; }
.toneWinner { --tone: var(--positive); --tone-ink: var(--positive-ink); animation: winner-flash 480ms var(--ease-arrive) 1; }
.toneLockedOther { --tone: var(--negative); --tone-ink: var(--negative-ink); }
.toneWaiting { --tone: var(--surface-2); --tone-ink: var(--text-muted); }
.toneWinner::before, .toneLockedOther::before, .toneWaiting::before { opacity: 1; }
@keyframes winner-flash { 40% { filter: brightness(1.2); } }
.label { position: relative; z-index: 1; max-width: 100%; word-break: break-word; hyphens: none; }
.subtitle { position: relative; z-index: 1; font-family: var(--font-ui); font-size: clamp(0.95rem, 2.4vw, 1.4rem); font-weight: 600; letter-spacing: 0.02em; text-transform: none; opacity: 0.85; padding: 0 1rem; line-height: 1.3; }
@keyframes buzz-pulse { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(1.06); opacity: 0; } }
@media (hover: hover) { .button:hover:not(:disabled) { filter: brightness(1.06); } }
```

`pending` needs no rule (the `.pressed` brightness covers it; `data-tone="pending"` is still emitted by the component).

- [ ] **Step 3: TeamGameplayPage.module.css** — replace the `rgba(15,23,42,…)` chip fills with `rgba(0,0,0,0.55)`, `#f8fafc` with `var(--bone)`; `.standingRank { font-family: var(--font-display); }`; `.statusEnded { background: var(--surface); border: 1px solid var(--border); color: var(--text-muted); box-shadow: none; }`. Add nothing continuous.

- [ ] **Step 4: Guards spec**

```ts
// tests/e2e/redesign_guards.spec.ts
import { expect, test } from "@playwright/test";
import { joinAsTeam, openManagerAndCreateGame } from "./fixtures/manager-context";

test("team page registers no non-passive touch/wheel listeners and buzz feedback is same-frame", async ({ browser }) => {
  const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
  const team = await joinAsTeam(browser, manager.gameCode, "Guard");
  const page = team.page;
  await page.addInitScript(() => {
    const bad: string[] = [];
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const passive = typeof options === "object" && options !== null && options.passive === true;
      if ((this === window || this === document) && ["touchstart", "touchmove", "wheel"].includes(type) && !passive) bad.push(type);
      return orig.call(this, type, listener, options);
    };
    (window as unknown as { __badListeners: string[] }).__badListeners = bad;
  });
  await page.reload();
  await manager.page.getByTestId("start-round").click();
  await expect(page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __badListeners: string[] }).__badListeners)).toEqual([]);
  const ms = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="buzz"]') as HTMLButtonElement;
    const t0 = performance.now();
    el.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    return new Promise<number>((r) => requestAnimationFrame(() => r(performance.now() - t0)));
  });
  expect(ms).toBeLessThan(50);
  await expect(page.getByTestId("buzz")).toHaveAttribute("data-tone", /pending|winner/);
});
```

- [ ] **Step 5: Gate; run `npx playwright test redesign_guards.spec.ts mobile_team.spec.ts multi_buzz_round.spec.ts --project=chromium` locally; real Android + iPhone check (pulse smooth, press instant, black label on orange); CHANGELOG (`### Changed`: buzz screen colours and type); commit `Restyle the buzz screen: flat tones with a compositor crossfade, display-face label`; PR with `run-e2e`.**

---

### Task 8: Host console (CSS + icons)

**Files:**
- Modify: `frontend/src/pages/ManagerConsolePage.module.css` (rewrite; delete dead blocks `.headerActions` (80–84), `.statusEnded` (67–71), `.timerWrap…timer-pulse` (196–264), `.checkRow…checkChecked` (303–363), and the `.timerRing/.timerValue` mobile overrides at 639–645)
- Modify: `frontend/src/pages/ManagerConsolePage.tsx:275-287` (icons on the two utility links), `HostRecoveryLink.tsx:25-34` (LinkIcon before the label)
- Tests: `ManagerConsolePage.test.tsx` unchanged (assertions are on text/ids); the #177 fit harness re-run

- [ ] **Step 1: Branch** — `feature/ui-8-console`
- [ ] **Step 2: Markup** — `rescueTrigger` gets `<RefreshIcon /> Reconnect a team`; `HostRecoveryLink` toggle gets `<LinkIcon />` before its text (tests match `/backup host link/i` and `aria-expanded`; both still hold).
- [ ] **Step 3: CSS** — keep all class keys and every `@media (max-width: 600px)` sizing rule from lines 672–793 verbatim (that block is the #177 contract); replace colours/type in the rest:
```css
.header { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: none; }
.codeLabel { font-size: var(--text-caption); color: var(--text-muted); }
.code { font-family: var(--font-display); font-size: 1.85rem; letter-spacing: 0.12em; color: var(--bone); background: none; -webkit-background-clip: initial; }
.statusPill { font-family: var(--font-ui); }
.statusWaiting { color: var(--bone); background: transparent; border-color: var(--bone); }
.statusPlaying { color: var(--positive-ink); background: var(--positive); border-color: var(--positive); }
.rescueTrigger, .hostTools :global(button) { color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.card { background: var(--surface); border: 1px solid var(--border); box-shadow: none; }
.card::before { display: none; }
.songLine { font-family: var(--font-display); font-size: 1.5rem; letter-spacing: 0.01em; color: var(--text); }
.songMeta { color: var(--text-muted); }
.statusStrip { border: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted); }
.statusStripLocked { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
.lockedTeam { color: var(--accent); font-family: var(--font-display); letter-spacing: 0.02em; }
.scoreBtn { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); transition: background-color var(--dur-micro) var(--ease-move), border-color var(--dur-micro) var(--ease-move), transform var(--dur-micro) var(--ease-overshoot); }
.scoreBtn:disabled { opacity: 0.4; }
.scorePositive { border-color: var(--positive); } .scorePositive .scorePoints { color: var(--positive); }
.scorePositive:not(:disabled):active { background: var(--positive); color: var(--positive-ink); }
.wrongBtn { background: transparent; border-color: var(--negative); color: var(--negative); box-shadow: none; }
.wrongBtn .scoreLabel, .wrongBtn .scorePoints { color: var(--negative); }
.wrongBtn:not(:disabled):active { background: var(--negative); color: var(--negative-ink); }
.scoreBonus, .scoreActiveBonus { background: transparent; border-color: var(--bone); color: var(--bone); box-shadow: none; }
.scoreBonus .scorePoints { color: var(--bone); }
.bonusPicker { border: 1px dashed var(--border-strong); background: var(--surface-2); }
.bonusPickerHint { color: var(--text-muted); }
.awardBtn { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); box-shadow: none; }
.continueBtn { background: var(--surface); border-color: var(--border); color: var(--text); box-shadow: none; }
.tokenChip { background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border); display: inline-flex; align-items: center; gap: 4px; }
.tokenChipClaimed { background: var(--accent-soft); color: var(--text); border-color: var(--accent); }
.endGameFooter { border-top: 1px solid var(--border); }
@media (hover: hover) { .scoreBtn:not(:disabled):hover { border-color: var(--border-strong); } .awardBtn:hover:not(:disabled) { background: #ff8f2b; border-color: #ff8f2b; } }
```
Delete every remaining `linear-gradient`, `#92400e`, `#b45309`, `rgba(245,158,11,…)`.

- [ ] **Step 4: Fit check** — with a throwaway local game at 390×844 / 375×667 / 360×640 in DevTools emulation: `[...document.querySelectorAll('[data-testid^="score-"],[data-testid="continue-round"],[data-testid="start-round"],[data-testid="end-game"]')].map(e=>e.getBoundingClientRect().bottom<=innerHeight)` all true and `document.documentElement.scrollHeight <= innerHeight`.
- [ ] **Step 5: Gate; CHANGELOG; commit `Restyle the host console; delete 135 lines of dead timer/checkbox CSS`; PR with `run-e2e`.**

---

### Task 9: Display board + Final Results (+ the approved dependency)

**Files:**
- Modify: `frontend/package.json` (+ `@formkit/auto-animate`), `frontend/package-lock.json`
- Modify: `frontend/src/pages/DisplayPage.tsx` (reveal mask, `data-revealed`, `<aside>` wrapper, `useAutoAnimate` on the `<ol>`, `useCountUp` on scores), `DisplayPage.module.css` (rewrite of colours + the TV grid)
- Create: `frontend/src/hooks/useCountUp.ts`, `frontend/src/hooks/useCountUp.test.ts`
- Modify: `frontend/src/components/EndScreen.tsx` (delete confetti — lines 10–51 (`CONFETTI_*`, `ConfettiPiece`, `generateConfetti`), 256 (the memo), 265–283 (the layer); reuse the shared `useCountUp` in place of the local `CountUp`), `EndScreen.module.css` (rewrite colours; podium rise + sweep)
- Create: `frontend/scripts/check-bundle.mjs`; modify `frontend/package.json` `"build"` script
- Tests: `DisplayPage.test.tsx:230-256, 283-285, 317-323`, `tests/e2e/ten_teams_thirty_rounds.spec.ts:617, 626`, `EndScreen.test.tsx` (unchanged), new `useCountUp.test.ts`

**Interfaces:**
- `useCountUp(value: number, opts?: { duration?: number; delay?: number }): number` — returns the displayed number; jumps immediately under reduced motion or in jsdom (no `matchMedia`).
- Reveal rows expose `data-revealed="true" | "false"`.

- [ ] **Step 1: Branch + install the approved dependency**

```bash
git checkout -b feature/ui-9-display && cd frontend && npm install @formkit/auto-animate@^0.10.0 --save-exact=false && git diff --stat package.json package-lock.json
```

- [ ] **Step 2: Failing tests**

`DisplayPage.test.tsx` — rewrite the six `???` assertions:
```ts
    expect(titleRow).toHaveAttribute("data-revealed", "false");      // :255
    expect(artistRow).toHaveAttribute("data-revealed", "false");     // :256
    expect(screen.getByTestId("display-reveal-artist")).toHaveAttribute("data-revealed", "false"); // :285
    expect(screen.getByTestId("display-reveal-title")).toHaveAttribute("data-revealed", "false");  // :318
```
(the two `toHaveTextContent("Careless Whisper")` lines at :283 and :323 stay, and gain `expect(...).toHaveAttribute("data-revealed", "true")`). Rename the test at :230 to `"masks song title and artist while no token is claimed"`.

`tests/e2e/ten_teams_thirty_rounds.spec.ts`:
```ts
    await expect(display.getByTestId("display-reveal-title")).toHaveAttribute("data-revealed", "false"); // :617
    await expect(display.getByTestId("display-reveal-title")).toHaveAttribute("data-revealed", "true", { timeout: 10_000 }); // :626
```

```ts
// frontend/src/hooks/useCountUp.test.ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCountUp } from "./useCountUp";

describe("useCountUp", () => {
  it("returns the target immediately when motion is unavailable (jsdom has no matchMedia)", () => {
    const { result } = renderHook(() => useCountUp(42));
    expect(result.current).toBe(42);
  });
});
```

- [ ] **Step 3: `useCountUp.ts`**

```ts
import { useEffect, useRef, useState } from "react";

function canAnimate(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    typeof window.requestAnimationFrame === "function"
  );
}

// Eases a displayed number from its previous value to `value` over `duration`
// ms (rAF, cancelled on change/unmount). Display-only: never used on the buzz
// path. Jumps straight to the value under reduced motion or without matchMedia.
export function useCountUp(value: number, opts: { duration?: number; delay?: number } = {}): number {
  const { duration = 600, delay = 0 } = opts;
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    if (!canAnimate()) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const from = fromRef.current;
    let raf = 0;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(Math.round(from + (value - from) * eased));
        if (p < 1) raf = requestAnimationFrame(tick);
        else fromRef.current = value;
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      fromRef.current = value;
    };
  }, [value, duration, delay]);
  return display;
}
```

- [ ] **Step 4: DisplayPage.tsx changes**

Imports: `import { useAutoAnimate } from "@formkit/auto-animate/react";` and `import { useCountUp } from "../hooks/useCountUp";` and the icons from Task 2.

Inside `DisplayBoard`, before the early returns: `const [boardRef] = useAutoAnimate<HTMLOListElement>({ duration: 400 });` and pass `ref={boardRef}` on the `<ol className={styles.bigList} …>` (line 357). Add `HTMLOListElement: "readonly"` to `eslint.config.js` globals.

Extract the row into `function BoardRow({ team, rank, buzzed, medal }: …)` (same three spans, same attributes) so each row can call `const score = useCountUp(team.score);` and render `{score}` in the third span. `data-team-id`/`data-rank`/classes unchanged.

Reveal rows: replace the `"???"` branches with the mask, and add `data-revealed`:
```tsx
              <div
                className={`${styles.revealRow} ${titleClaimedById ? styles.revealRowOpen : ""}`}
                data-testid="display-reveal-title"
                data-revealed={titleClaimedById && currentSong ? "true" : "false"}
              >
                <span className={styles.revealIcon} aria-hidden="true"><NoteIcon /></span>
                {titleClaimedById && currentSong ? (
                  <span className={styles.revealText} dir="auto">{currentSong.title}</span>
                ) : (
                  <span className={styles.revealMask} aria-hidden="true"><i /><i /><i /><i /><i /></span>
                )}
                {!(titleClaimedById && currentSong) ? <span className="visually-hidden">Not revealed yet</span> : null}
              </div>
```
(same for the artist row and the soundtrack row). `timerValue` keeps `{remainingSec}s` only.

Wrap the sidebar: move the JSX for `soundtrackBadgeRow`, `revealPanel`, `tokenChips`, `timerSlot` and the `<footer className={styles.joinFooter}>` into one `<aside className={styles.side}>` placed right after the banner `<div>`; `.scores` and `.moreTeams` stay after it.

- [ ] **Step 5: DisplayPage.module.css** — full colour pass (all hexes → tokens; delete gradients; `.header h1` → `font-family: var(--font-display); color: var(--bone); background: none;`; `.code` → display face `--bone`; `.banner` → `background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted); font-family: var(--font-display); font-size: var(--text-display-s);`; `.bannerLocked { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); animation: banner-in var(--dur-state) var(--ease-arrive); } @keyframes banner-in { from { transform: translateY(-100%); opacity: 0; } }` (delete `locked-pulse`); `.bigRow { background: var(--surface); border: 1px solid var(--border); grid-template-columns: 72px 1fr auto; }`; `.bigRank { font-family: var(--font-display); color: var(--bone); width: 56px; height: 56px; border: 2px solid var(--border); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; }`; `.bigRowGold .bigRank { border-color: var(--accent); } .bigRowSilver .bigRank, .bigRowBronze .bigRank { border-color: var(--bone); }` (backgrounds of medal rows: `var(--surface)`, `.bigRowGold { box-shadow: inset 3px 0 0 var(--accent); }`); `.bigName { font-family: var(--font-display); color: var(--text); }`; `.bigScore { font-family: var(--font-display); color: var(--bone); }`; `.bigRowBuzzed { border-color: var(--accent); background: var(--accent-soft); transform: none; box-shadow: none; }`; `.revealMask { display: inline-flex; gap: 6px; } .revealMask i { display: block; height: 0.9em; width: 2.2em; background: var(--surface-2); border-radius: var(--radius-xs); } .revealMask i:nth-child(2) { width: 1.4em; } .revealMask i:nth-child(4) { width: 3em; }`; `.revealRowOpen .revealText { animation: unmask var(--dur-enter) var(--ease-arrive); } @keyframes unmask { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0); } }`; `.timerFill { background: var(--accent); } .timerValue { font-family: var(--font-display); color: var(--accent); }`; `.tokenChipClaimed { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }`.

TV grid (inside the existing `@media (min-width: 769px) and (min-height: 640px)` block, replacing `.shell`'s flex rules):
```css
  .shell {
    height: 100dvh; min-height: 100dvh; overflow: hidden; padding: 1rem var(--space-7);
    display: grid; gap: var(--tv-gap, 0.85rem) var(--space-6);
    grid-template-columns: minmax(0, 1fr) clamp(260px, 28vw, 380px);
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    grid-template-areas: "header header" "banner banner" "scores side" "more side";
  }
  .header { grid-area: header; } .banner { grid-area: banner; } .scores { grid-area: scores; } .moreTeams { grid-area: more; }
  .side { grid-area: side; display: flex; flex-direction: column; gap: var(--tv-gap, 0.85rem); min-height: 0; }
  .joinFooter { margin-top: auto; border-top: 0; padding-top: 0; }
```
Below 769 px: `.side { display: contents; } .joinFooter { order: 10; }` so the QR stays last. Keep the `.bigList` grid / `--rows` / container-query rules and both short-frame refinements exactly as they are (they only reference `.shell` paddings and gaps).

- [ ] **Step 6: EndScreen** — delete confetti (lines 10–51, 256, 265–283, and the `.confettiLayer/.confettiPiece/confetti-fall` CSS at `EndScreen.module.css:12-49`); replace the local `CountUp` with `useCountUp` inside a small `Score` component (`function Score({ value, delay }: { value: number; delay: number }) { const n = useCountUp(value, { duration: 900, delay }); return <>{n}</>; }`) so `EndScreen.test.tsx` expectations on displayed totals still hold (jsdom jumps to the final value, as the old `prefersReducedMotion()` path did). CSS: `.title { font-family: var(--font-display); color: var(--bone); background: none; text-shadow: none; }`, `.podiumCard { background: var(--surface); border: 1px solid var(--border); box-shadow: none; }`, `.gold { border-color: var(--accent); box-shadow: inset 0 3px 0 var(--accent); animation: podium-rise var(--dur-enter) var(--ease-arrive) 240ms forwards; } .gold::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(115deg, transparent 40%, rgba(233,228,217,0.18) 50%, transparent 60%); transform: translateX(-100%); animation: sweep 900ms var(--ease-move) 900ms 1 forwards; pointer-events: none; } @keyframes sweep { to { transform: translateX(100%); } }` (this one gradient is the light sweep and is allowed — it is moved with transform, never repainted), `.silver { animation-delay: 120ms; } .bronze { animation-delay: 0ms; }`, delete `gold-glow`; `.medal { font-family: var(--font-display); background: var(--surface-2); border: 2px solid var(--border); color: var(--bone); }`; `.gold .medal { border-color: var(--accent); }`; `.teamName { font-family: var(--font-display); color: var(--text); } .teamScore { font-family: var(--font-display); color: var(--bone); }`; `.crown { background: var(--accent); color: var(--accent-ink); border: 3px solid var(--bg); }`; `.winnerLabel { color: var(--accent); background: transparent; font-family: var(--font-ui); }`; `.scoreboardRow` → `var(--surface)` + `var(--border)`, rank ring as on the board.

- [ ] **Step 7: Bundle guard**

```js
// frontend/scripts/check-bundle.mjs — runs after vite build (see package.json)
import { readdirSync, readFileSync } from "node:fs";
const dir = "dist/assets";
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
const banned = ["framer-motion", "lenis", "gsap"];
const scoped = "auto-animate";
let failed = false;
for (const f of files) {
  const src = readFileSync(`${dir}/${f}`, "utf8");
  for (const b of banned) if (src.includes(b)) { console.error(`${f} contains ${b}`); failed = true; }
  if (src.includes(scoped) && !f.startsWith("DisplayPage-")) { console.error(`${f} contains ${scoped} (allowed only in DisplayPage-*.js)`); failed = true; }
  if (f.startsWith("TeamGameplayPage-") && src.includes("startViewTransition")) { console.error(`${f} calls startViewTransition`); failed = true; }
}
if (!files.some((f) => f.startsWith("DisplayPage-") && readFileSync(`${dir}/${f}`, "utf8").includes(scoped))) { console.error("DisplayPage chunk should contain auto-animate"); failed = true; }
process.exit(failed ? 1 : 0);
```
`package.json`: `"build": "tsc -b && vite build && node scripts/check-bundle.mjs"`.

- [ ] **Step 8: Gate + `npx playwright test display_fit.spec.ts ten_teams_thirty_rounds.spec.ts soundtrack_playthrough.spec.ts --project=chromium` locally (all ten `display_fit` viewports must pass with the new grid); CHANGELOG (`### Changed`: TV scoreboard redesigned, rows animate when ranks change, masked song reveal; final results podium restyled, confetti replaced); commit `Redesign the TV display and final results; animate board reorders with auto-animate (Display chunk only)`; PR with `run-e2e`. PR description names the new dependency and the bundle-guard output.**

---

### Task 10: Route transitions

**Files:**
- Create: `frontend/src/hooks/useViewTransitionNavigate.ts`, `frontend/src/hooks/useViewTransitionNavigate.test.tsx`
- Create: `frontend/src/components/TransitionLink.tsx`, `frontend/src/components/TransitionLink.test.tsx`
- Modify: navigation sites — `HomePage.tsx` (3 role links + how-to link), `HowToPlayPage.tsx` (Back), `JoinTeamPage.tsx:98` (`navigate(\`/team/${code}\`)` after join) and `:175` (Cancel), `ManagerCreateGamePage.tsx:178` (`navigate(\`/manager/game/…\`)`) and `:269` (Cancel), `DisplayPage.tsx:69` (`navigate(\`/display/${trimmed}\`)`), `ManagerConsolePage.tsx` "Back to home" links
- Modify: `frontend/eslint.config.js` globals (+ `ViewTransition`)

- [ ] **Step 1: Branch** — `feature/ui-10-transitions`
- [ ] **Step 2: Failing tests**

```tsx
// frontend/src/hooks/useViewTransitionNavigate.test.tsx
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewTransitionNavigate } from "./useViewTransitionNavigate";

const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter>{children}</MemoryRouter>;

afterEach(() => {
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
});

describe("useViewTransitionNavigate", () => {
  it("navigates plainly when the browser has no startViewTransition", async () => {
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), { wrapper });
    await act(async () => { await result.current.go("/join"); });
    expect(result.current.loc.pathname).toBe("/join");
  });
  it("awaits the preload, then wraps navigation in startViewTransition", async () => {
    const calls: string[] = [];
    (document as unknown as { startViewTransition: (cb: () => void) => unknown }).startViewTransition = (cb) => { calls.push("vt"); cb(); return { finished: Promise.resolve() }; };
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), { wrapper });
    await act(async () => { await result.current.go("/display", { preload: async () => { calls.push("preload"); } }); });
    expect(calls).toEqual(["preload", "vt"]);
    expect(result.current.loc.pathname).toBe("/display");
  });
  it("skips the transition under prefers-reduced-motion", async () => {
    const vt = vi.fn((cb: () => void) => { cb(); return { finished: Promise.resolve() }; });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = vt;
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => ({ go: useViewTransitionNavigate(), loc: useLocation() }), { wrapper });
    await act(async () => { await result.current.go("/join"); });
    expect(vt).not.toHaveBeenCalled();
    expect(result.current.loc.pathname).toBe("/join");
    // @ts-expect-error restore jsdom's absence of matchMedia
    delete window.matchMedia;
  });
});
```

```tsx
// frontend/src/components/TransitionLink.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TransitionLink } from "./TransitionLink";

describe("TransitionLink", () => {
  it("renders a real link and navigates on click", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<TransitionLink to="/join">Play</TransitionLink>} />
          <Route path="/join" element={<p>joined</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Play" });
    expect(link).toHaveAttribute("href", "/join");
    await userEvent.click(link);
    expect(screen.getByText("joined")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Implementation**

```ts
// frontend/src/hooks/useViewTransitionNavigate.ts
import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// The ONLY place that may call document.startViewTransition (validation plan
// §5). react-router's own `viewTransition` option is a no-op under the
// declarative <BrowserRouter> this app uses, so route transitions go through
// here. Preloads the lazy route chunk first so the transition never animates
// to the Suspense fallback; skips the transition (and its hit-testing freeze)
// under reduced motion or where unsupported.
export function useViewTransitionNavigate() {
  const navigate = useNavigate();
  return useCallback(
    async (to: To, opts: NavigateOptions & { preload?: () => Promise<unknown> } = {}) => {
      const { preload, ...navOpts } = opts;
      try {
        await preload?.();
      } catch {
        /* a failed preload is handled by lib/preloadError on the real import */
      }
      const doc = document as VTDocument;
      if (typeof doc.startViewTransition !== "function" || prefersReducedMotion()) {
        navigate(to, navOpts);
        return;
      }
      doc.startViewTransition(() => flushSync(() => navigate(to, navOpts)));
    },
    [navigate],
  );
}
```

```tsx
// frontend/src/components/TransitionLink.tsx
import type { MouseEvent } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { useViewTransitionNavigate } from "../hooks/useViewTransitionNavigate";

interface Props extends LinkProps {
  preload?: () => Promise<unknown>;
}

// A <Link> that keeps its href/role (tests, middle-click, screen readers) and
// routes a plain left click through the view-transition hook.
export function TransitionLink({ preload, onClick, to, ...rest }: Props) {
  const go = useViewTransitionNavigate();
  return (
    <Link
      to={to}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void go(to, { preload });
      }}
    />
  );
}
```

Add `ViewTransition: "readonly"` and `MouseEvent: "readonly"` to `eslint.config.js` globals if lint flags them.

- [ ] **Step 4: Wire the navigation sites** — Home role links: `<TransitionLink to="/manager/create" preload={() => import("../pages/ManagerCreateGamePage")} …>` (Join needs no preload — it is in the main chunk; Display: `import("../pages/DisplayPage")`; How to play: `import("../pages/HowToPlayPage")`). Join success: `const go = useViewTransitionNavigate(); … await go(\`/team/${code}\`, { preload: () => import("./TeamGameplayPage") });` (the page already prefetches this chunk on mount, so the await is instant). Create success: `go(\`/manager/game/${game.game_code}\`, { preload: () => import("./ManagerConsolePage") })`. Display entry: `go(\`/display/${trimmed}\`)`. Cancel / Back links → `TransitionLink`. Leave every `navigate(..., { replace: true })` redirect untouched.

- [ ] **Step 5: Gate; manual check in Chrome (transition plays, wordmark morphs, Back is instant), Firefox (instant swap, no errors), DevTools reduced-motion emulation (no transition); `grep -rl startViewTransition frontend/src --include=*.ts --include=*.tsx | grep -v test` → exactly `useViewTransitionNavigate.ts`; CHANGELOG (`### Added`: smooth page transitions); commit `Add view-transition route changes through a single navigation hook`; PR with `run-e2e`.**

---

### Task 11: Cleanup

**Files:**
- Modify: `frontend/src/styles.css` (delete the legacy alias block), every `*.module.css` still referencing `--color-*` / `--space-xs…2xl` / `--easing-spring` / `--shadow-*` (grep and replace with the new tokens), `DisplayPage.module.css` (`.emptyBoardQR`, `.emptyBoardCode` dead rules), `AdminSongsPage.module.css` (`.soundtrackToggle`)
- Modify: `docs/planning/ui-redesign/README.md` (status → shipped), `docs/planning/TASKS.md` (tick X-DarkRoom #243 as delivered by the base theme), `docs/architecture.md` if it describes the old look, `CHANGELOG.md` (roll-up line)

- [ ] **Step 1:** `grep -rn "var(--color-\|var(--space-xs\|var(--space-sm\|var(--space-md\|var(--space-lg\|var(--space-xl\|var(--space-2xl\|var(--easing-spring\|var(--shadow-sm\|var(--shadow-md\|var(--shadow-lg" frontend/src` → replace each with its new token; then delete the alias block from `styles.css` and update `styles.test.ts` (drop the alias assertion).
- [ ] **Step 2:** Delete dead rules listed above; `npm run build` — total CSS should drop.
- [ ] **Step 3:** Full-Game Exit Gate (`06` §9) on prod after merge; record results in `README.md`.
- [ ] **Step 4:** Commit `Remove the redesign's legacy token aliases and dead CSS`; PR.

---

## Self-review (done 2026-09-17)

- Spec coverage: `01` §2 palette → Task 1; §3 fonts → Task 0; §5 components → Tasks 3–9; §6 icons → Task 2; §7 imagery → Task 4 (OG/icons deferred per decision 9). `04` §4 → Task 10; catalogue rows 1–30 → Tasks 3–10 (row 30 wordmark pause → Task 3 + Task 7 attribute). `05` every route → Tasks 4–9. `06` guards → Task 7 (listener/latency spec), Task 9 (bundle guard), Task 10 (grep). Decisions 1–8 all placed; decision 9 is a follow-up outside this plan.
- Placeholder scan: no TBD/TODO; every code step shows code; CSS steps that say "as Task 5" repeat the exact rules in Task 5 (copy them).
- Type consistency: `useCountUp(value, { duration, delay })` (Task 9) used by Display and EndScreen; `useViewTransitionNavigate()(to, { preload })` (Task 10) used by `TransitionLink`; `data-claimed`, `data-revealed`, `data-round-live` names identical across tasks and tests; icon export names identical across Tasks 2, 4, 8, 9.

## Starter prompt for each implementation session

> Read `docs/planning/ui-redesign/README.md`, `07-implementation-plan.md` (Task N), `06-validation-plan.md` §2 and `02-current-state-audit.md` §4. Implement Task N exactly as written on a new `feature/ui-N-…` branch from `main`, run the gate, open the PR (label `run-e2e` when the task says so), then carry it to merge-ready: wait for the checks, resolve every bot review thread (CodeQL / Advanced Security) so "All comments must be resolved" cannot block it, and confirm `mergeStateStatus` is `CLEAN`. Do not merge. Work autonomously and stop only for a question I must answer. Report the gate output, the final merge state and the PR link.
