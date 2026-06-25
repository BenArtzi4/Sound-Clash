# PWA plan for Sound Clash

> Status: **IMPLEMENTED 2026-06-25** on branch `feature/pwa` (Option A, zero
> dependencies). Validated: typecheck + lint + build clean, 339/339 tests pass,
> coverage above gate, and a real `vite preview` run confirmed the service
> worker registers/activates/controls the page, the manifest parses as
> `standalone`, all icons + `sw.js` return 200, and **no new console errors**
> were introduced. The canonical note now lives in `docs/architecture.md` §2.
> This file is kept as the design record.

## Goal (and explicit non-goal)

Make Sound Clash **installable to the home screen** and run **full-screen
(standalone, no browser chrome)** so a host who runs games repeatedly gets an
app-like launch — without going near the App Store / Play Store.

**Non-goal: offline.** This is a real-time game that is useless without the
Supabase WebSocket and the YouTube IFrame player. Offline-first / aggressive
precaching would add risk (serving stale JS mid-game) for zero user value. The
service worker here exists only to satisfy install criteria and must stay
network-first / minimal.

## What exists today

| Piece | State |
|---|---|
| `frontend/public/manifest.webmanifest` | **missing** |
| Service worker + registration | **missing** (no refs in `frontend/src`) |
| `theme-color` meta | present (`#06b6d4`), `index.html:10` |
| Favicon | inline SVG data-URI equalizer logo, `index.html:37-41` |
| PNG app icons (192 / 512 / maskable) | **missing** |
| `apple-touch-icon` (iOS) | **missing** |
| Vite PWA tooling | none in `package.json` |
| Host | static (Netlify/Cloudflare Pages — `_headers` + `_redirects` style); no deploy config in repo |
| CSP | `default-src 'self'` in `public/_headers` — manifest + same-origin SW already allowed (no CSP change needed) |

Net: **not a PWA at all.** Everything below is greenfield.

## Two ways to build it

### Option A — hand-rolled, zero dependencies (recommended)

A static `manifest.webmanifest`, a ~20-line network-first `sw.js`, register it
from `main.tsx`, add `<link>` tags, add icons. No new npm package — fits the
repo's "keep it lean / flag any dependency" rule.

### Option B — `vite-plugin-pwa` + Workbox

Auto-generates manifest, SW, and precache manifest; gives "new version
available" auto-update. **Costs a dependency** (vite-plugin-pwa + workbox-*, ~several
transitive pkgs) and its defaults precache the whole build — exactly the
stale-asset risk we want to avoid for a live game, so it'd need tuning down.

**Recommendation: Option A.** The payoff we want (installable + standalone) is
fully covered by static files; Workbox's value is offline/precache, which we
explicitly don't want here.

## Implementation steps (Option A)

1. **Icons** (`frontend/public/icons/`) — generate from the existing SVG logo:
   - `icon-192.png`, `icon-512.png` (standard)
   - `icon-maskable-512.png` (Android adaptive — needs safe-zone padding)
   - `apple-touch-icon.png` (180×180, iOS home screen)
   - ⚠️ These are **binary assets** → per `.claude/rules/binary-assets.md` I'll
     confirm before `git add`. They're small (~a few KB each, flat-color logo)
     so committing to the repo is reasonable, but it's your call.

2. **`frontend/public/manifest.webmanifest`**
   ```json
   {
     "name": "Sound Clash",
     "short_name": "Sound Clash",
     "description": "Real-time multiplayer music trivia.",
     "start_url": "/",
     "scope": "/",
     "display": "standalone",
     "orientation": "any",
     "background_color": "#0f172a",
     "theme_color": "#06b6d4",
     "icons": [
       { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
       { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
       { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
     ]
   }
   ```

3. **`frontend/public/sw.js`** — minimal, network-first, no precache. A
   fetch handler exists only to meet install criteria; it never serves stale
   app code. Include a no-op/skipWaiting path so a future deploy can't get
   wedged. (Could even ship a "kill-switch" SW that just unregisters itself if
   we ever want to back out.)

4. **`frontend/index.html`** — add inside `<head>`:
   ```html
   <link rel="manifest" href="/manifest.webmanifest" />
   <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
   ```

5. **`frontend/src/main.tsx`** — register the SW after load, prod-only, guarded:
   ```ts
   if ("serviceWorker" in navigator && import.meta.env.PROD) {
     window.addEventListener("load", () => {
       void navigator.serviceWorker.register("/sw.js");
     });
   }
   ```

## Risks / gotchas to watch

- **Stale-asset trap.** A misconfigured SW is the classic PWA footgun — it can
  pin an old bundle and break a live game. Mitigation: network-first, no
  precache, plus a tested unregister path. This is the one thing to get right.
- **Coverage gate.** The SW-registration branch in `main.tsx` is prod-guarded,
  so vitest (dev/test env) won't exercise it; may need an `istanbul ignore`-free
  small test or a `// reason` to keep the frontend coverage gate happy.
- **Playwright e2e.** SW + browser caching can interfere across runs; tests run
  against dev (`import.meta.env.PROD` false ⇒ SW never registers), so low risk,
  but worth a smoke check.
- **iOS limits.** iOS gives home-screen + standalone from manifest +
  `apple-touch-icon` alone (no SW needed there); push/background are still
  restricted — fine, we don't use them.
- **Docs.** Per CLAUDE.md, if this ships it should get a line in
  `docs/architecture.md` and a `CHANGELOG.md` entry (user-visible: "installable").

## Effort

~1–2 hrs: icons (the fiddliest bit — maskable safe-zone), 4 small files, one
3-line edit, manual install smoke test on Android Chrome + iOS Safari + desktop
Chrome. No backend, DB, or architecture impact. Fully reversible (delete files;
shipped SWs self-unregister via the kill-switch).
