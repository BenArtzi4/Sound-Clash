// Error reporting (Sentry) — loaded lazily so the ~70 KB gz SDK never sits on
// the critical render path or the buzzer path. `main.tsx` installs a cheap
// native error buffer on the very first tick; once the app has painted and the
// tab is idle it calls `loadSentry()`, which swaps in the real SDK and drains
// anything that crashed in between. Everything here is a no-op when
// VITE_SENTRY_DSN is unset (dev, tests, or a build without a DSN).

import { env } from "./env";

// An uncaught error captured before the Sentry SDK was ready.
type Buffered = { kind: "error" | "rejection"; value: unknown };

let buffer: Buffered[] | null = null;
let onError: ((e: ErrorEvent) => void) | null = null;
let onRejection: ((e: PromiseRejectionEvent) => void) | null = null;

function detach(): void {
  if (onError) {
    window.removeEventListener("error", onError);
    onError = null;
  }
  if (onRejection) {
    window.removeEventListener("unhandledrejection", onRejection);
    onRejection = null;
  }
}

/**
 * Start buffering uncaught errors / promise rejections with cheap native
 * handlers, so a crash during first paint — before the Sentry SDK has been
 * fetched — isn't lost. No-op when Sentry is disabled or already buffering.
 * Call once, synchronously, at startup.
 */
export function installErrorBuffer(): void {
  if (!env.VITE_SENTRY_DSN || buffer) return;
  const buf: Buffered[] = [];
  buffer = buf;
  onError = (e) => buf.push({ kind: "error", value: e.error ?? e.message });
  onRejection = (e) => buf.push({ kind: "rejection", value: e.reason });
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
}

/**
 * Dynamically import and initialize Sentry, then replay any buffered errors.
 * Best-effort: a load or init failure is swallowed (error reporting must never
 * break the app). No-op when VITE_SENTRY_DSN is unset.
 */
export async function loadSentry(): Promise<void> {
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn) return;
  const pending = buffer ?? [];
  try {
    const Sentry = await import("@sentry/react");
    // Hand global error handling to Sentry *before* init so the two handler
    // sets never both report the same later error (Sentry.init installs its own
    // window listeners). Draining `pending` after init replays the early ones.
    detach();
    Sentry.init({ dsn, tracesSampleRate: 0 });
    for (const item of pending) Sentry.captureException(item.value);
  } catch {
    // Sentry is best-effort; a load/init failure must not affect gameplay.
    detach();
  } finally {
    buffer = null;
  }
}

// Test-only: reset module state between tests.
export function _resetSentry(): void {
  detach();
  buffer = null;
}
