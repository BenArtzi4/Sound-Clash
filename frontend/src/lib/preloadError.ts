// Deploy-safe chunk loading.
//
// The routes in App.tsx are `React.lazy`, so each one is a separately
// content-hashed chunk under `/assets/`. Cloudflare Pages serves those chunks
// with `immutable` caching and a new hash whenever their bytes change, so a
// deploy replaces the whole set of hashes. A browser that loaded the app
// *before* a deploy still holds references to the OLD chunk URLs; when it later
// navigates to a lazy route (join -> `/team/:code` is the classic trigger) the
// dynamic `import()` requests a hash that no longer exists. Worse than a 404:
// the SPA `_redirects` rule (`/* /index.html 200`) serves `index.html` as
// `200 text/html`, which fails to parse as a module -> the import rejects ->
// React.lazy throws -> blank white screen mid-party.
//
// Vite dispatches a cancelable `vite:preloadError` event on `window` when a
// dynamic/preloaded chunk fails to import. We handle it by reloading: a fresh
// `index.html` (never cached — see public/_headers) carries the new hash set,
// so the retried navigation loads a chunk that exists.
//
// Two rules keep the reload from ever looping (a persistently-failing chunk on
// a lazy route re-triggers its import on every load with no user gesture, so a
// naive "reload on error" WOULD loop):
//   1. A reload BUDGET (count) persisted in `sessionStorage`, capped per
//      incident. After the cap we stop auto-reloading and let the error fall
//      through to the app-level ErrorBoundary, which shows a manual "Reload"
//      CTA. The budget resets after a window comfortably longer than any real
//      reload+boot+import cycle, so a slow phone can't defeat the cap while a
//      *later* deploy still gets a fresh budget. (A bounded count within that
//      window is loop-proof where a pure time cooldown — which a slow enough
//      cycle could outrun — is not.)
//   2. When `sessionStorage` is unavailable (private mode / disabled), the
//      budget can't survive the reload, so we do NOT auto-reload at all and
//      defer to the ErrorBoundary CTA — a user-initiated reload still recovers,
//      without any risk of an automatic loop.
//
// Net: this removes the "never deploy during a live game" operational caveat.

const GUARD_KEY = "sc:chunk-reload-guard";
// Auto-reload at most once per incident: one reload fetches the fresh
// index.html + current hashes, which fixes the ordinary stale-chunk case. If it
// still fails after that, the deploy is genuinely broken (or the user is
// offline) — stop and let the ErrorBoundary offer a manual retry instead of
// hammering reload.
const MAX_AUTO_RELOADS = 1;
// Reset the budget only after a window far longer than any realistic reload
// cycle (seconds), so a slow device can't reset the budget mid-incident and
// re-loop; a genuinely later deploy (minutes apart) still starts fresh and
// auto-recovers. (A bounded count within such a window is loop-proof where a
// pure time cooldown — which a slow enough cycle could outrun — is not.)
const INCIDENT_WINDOW_MS = 5 * 60_000;

type Guard = { n: number; at: number };
let installed = false;

// Returns the persisted reload budget, or `null` when sessionStorage is
// unavailable. `null` is meaningful: without durable cross-reload memory we
// cannot guarantee loop-freedom, so the caller must NOT auto-reload.
function readGuard(): Guard | null {
  try {
    const raw = window.sessionStorage.getItem(GUARD_KEY);
    if (!raw) return { n: 0, at: 0 };
    const parsed = JSON.parse(raw) as Partial<Guard>;
    return { n: Number(parsed.n) || 0, at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

function writeGuard(guard: Guard): boolean {
  try {
    window.sessionStorage.setItem(GUARD_KEY, JSON.stringify(guard));
    return true;
  } catch {
    return false;
  }
}

function handlePreloadError(event: Event): void {
  const guard = readGuard();
  // Storage unavailable -> can't make auto-reload loop-safe -> defer to the CTA.
  if (guard === null) return;
  const now = Date.now();
  // A later deploy (or any incident more than the window after the last
  // auto-reload) starts from a clean budget.
  const count = now - guard.at > INCIDENT_WINDOW_MS ? 0 : guard.n;
  // Already auto-reloaded enough for this incident and it still failed — stop
  // and let the ErrorBoundary offer a manual retry instead of looping.
  if (count >= MAX_AUTO_RELOADS) return;
  // Couldn't persist the spent budget -> don't reload (a reload we can't record
  // could loop).
  if (!writeGuard({ n: count + 1, at: now })) return;
  // We own recovery for this event: preventDefault() so Vite doesn't ALSO
  // rethrow it as an uncaught error while the reload is in flight.
  event.preventDefault();
  window.location.reload();
}

/**
 * Register the `vite:preloadError` -> reload recovery handler. Idempotent: a
 * second call is a no-op (main.tsx calls it once at startup). Cheap — just adds
 * one window listener — so it's installed synchronously before first render.
 */
export function installPreloadErrorHandler(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("vite:preloadError", handlePreloadError);
}

// Test-only: clear the persisted reload budget between tests. Deliberately does
// NOT reset `installed`, so the single window listener registered by
// `installPreloadErrorHandler` is never stacked.
export function _resetChunkReloadGuard(): void {
  try {
    window.sessionStorage.removeItem(GUARD_KEY);
  } catch {
    // ignore
  }
}
