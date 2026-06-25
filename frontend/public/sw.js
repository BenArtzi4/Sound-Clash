/*
 * Sound Clash service worker — intentionally minimal.
 *
 * Purpose: satisfy the browser's "installable PWA" criteria so the app can be
 * added to a home screen and launched standalone (no browser chrome). That's
 * the ONLY job.
 *
 * Explicit non-goal: offline / precaching. Sound Clash is a real-time game that
 * is useless without the Supabase WebSocket and the YouTube player, and caching
 * the app shell would risk serving a stale bundle in the middle of a live game.
 * So this worker caches NOTHING and never intercepts a request.
 *
 *  - install:  skipWaiting() so a new deploy's worker activates immediately.
 *  - activate: delete any caches a previous version may have created (acts as a
 *              built-in kill-switch) and take control of open clients.
 *  - fetch:    a listener exists only because some browsers' install heuristics
 *              look for one. It does NOT call respondWith(), so every request
 *              falls through to the normal network path unchanged. Nothing is
 *              cached; a new deploy is always fetched fresh.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", () => {
  // Deliberately empty: no respondWith => browser handles the request normally,
  // so the worker never serves stale content.
});
