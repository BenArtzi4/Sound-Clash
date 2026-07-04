import { useEffect, useState } from "react";
import { getHealth } from "../lib/api";

// Two small helpers for pages that make a one-off REST call to Render (join a
// game, create a game). Render's free-tier container spins down after ~15 min
// idle, so that call can stall the user 2-30s on a cold start.

/**
 * Fire a single best-effort `/health` ping on mount to wake the Render
 * container ahead of the user's real POST. Errors are ignored — a failed
 * pre-warm just means the real call hits the cold start it would have hit
 * anyway (never worse). HomePage does the same on landing; this covers pages
 * reached by a direct link that skips the home page (a QR'd `/join/:code`, a
 * bookmarked `/manager/create`).
 */
export function usePrewarmBackend(): void {
  useEffect(() => {
    void getHealth().catch(() => undefined);
  }, []);
}

/**
 * True once `pending` has stayed continuously true for `delayMs`. Lets a submit
 * button swap to a "waking the server…" hint only when a request is slow enough
 * to be a cold start, without flashing it on every fast request. Resets the
 * moment `pending` goes false.
 */
export function useSlowPending(pending: boolean, delayMs = 2500): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return undefined;
    }
    const id = window.setTimeout(() => setSlow(true), delayMs);
    return () => window.clearTimeout(id);
  }, [pending, delayMs]);
  return slow;
}
