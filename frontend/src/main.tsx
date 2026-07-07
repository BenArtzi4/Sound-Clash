import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installPreloadErrorHandler } from "./lib/preloadError";
import { installErrorBuffer, loadSentry } from "./lib/sentry";
import { initTelemetry } from "./lib/telemetry";
import "./styles.css";

// Capture uncaught errors from the very first tick with cheap native handlers.
// The Sentry SDK itself (~70 KB gz) is lazy-loaded after first paint (below) to
// keep it off the critical render path and the buzzer path; loadSentry() drains
// anything buffered here. No-op when VITE_SENTRY_DSN is unset (dev, tests).
installErrorBuffer();

// Recover from a stale lazy-route chunk after a mid-game deploy: reload so a
// fresh index.html pulls the new content-hashes, instead of a blank screen.
// Cheap (one window listener); the app-level ErrorBoundary is the backstop.
installPreloadErrorHandler();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Run a callback once the tab is idle (bounded by a timeout so error reporting
// still comes up under sustained load). Falls back to a near-immediate timeout
// where requestIdleCallback is unavailable (older Safari).
function whenIdle(cb: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(cb, { timeout: 5000 });
  } else {
    window.setTimeout(cb, 1);
  }
}

// Defer everything non-essential off the first-paint critical path. Sentry and
// the Faro latency SDK are both lazy chunks; we load them once the page has
// loaded and the tab is idle so neither competes with rendering or the buzzer.
// (`initTelemetry` is a no-op when VITE_FARO_URL is unset — which it now is in
// prod — so the Faro chunk isn't fetched at all; the idle-defer is belt-and-
// suspenders and the correct pattern regardless.)
window.addEventListener("load", () => {
  whenIdle(() => {
    void loadSentry();
    void initTelemetry();
  });

  // Register the PWA service worker so the app is installable / launches
  // standalone. Prod-only (dev and tests never register one). The worker caches
  // nothing (see public/sw.js); registration is best-effort and failure is
  // non-fatal.
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installability is a progressive enhancement; ignore failures */
    });
  }
});
