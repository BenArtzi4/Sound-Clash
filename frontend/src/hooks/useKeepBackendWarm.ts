import { useEffect } from "react";
import { getHealth } from "../lib/api";

// Render's free-tier API container spins down after ~15 min idle. During an
// active game every hot-path action (buzz, score, next round) goes straight to
// Supabase, so the FastAPI backend sees no traffic and goes cold mid-game --
// and then the host's next REST call (Bonus / End game / Kick) or a late team's
// join stalls 2-30s on cold start.
//
// While the manager console is mounted and a game is in progress we ping
// /health: immediately on mount, again whenever the tab returns to the
// foreground, and on a 10-min interval. Errors are ignored: a failed ping just
// means the next real call hits the same cold start it would have hit anyway,
// so this is never worse than not pinging.
//
// T-KeepWarm decision (Phase 3): an external cron (cron-job.org, every 14 min --
// see docs/free-tier-budget.md §2.7) already pings /health 24/7, so this hook is
// *redundant* for the plain cold-start-after-idle case. We deliberately KEEP it,
// as a cheap, visibility-aware belt-and-suspenders fallback:
//   * the immediate mount ping warms Render for a host who deep-linked straight
//     to /manager/game/<code> without passing through HomePage's prewarm;
//   * the visibilitychange ping is the one the 24/7 cron cannot substitute for --
//     mobile browsers FREEZE background timers, so a host whose phone slept for a
//     few minutes returns to a possibly-cold dyno right when they reach for
//     Bonus/End; re-warming inside the "tab visible again" gesture hides that.
// Cost is a handful of extra /health GETs per game (unlimited + unauthenticated;
// budget §6). If the cron is ever paused/misconfigured this is the safety net.
export const KEEP_WARM_INTERVAL_MS = 10 * 60 * 1000; // 10 min, comfortably under Render's ~15 min idle

export function useKeepBackendWarm(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const ping = (): void => {
      void getHealth().catch(() => undefined);
    };
    // Warm immediately when the game becomes active rather than waiting up to
    // 10 min for the first interval tick.
    ping();
    // Re-warm the moment the tab returns to the foreground (mobile freezes
    // background intervals, so the tick that should have fired never did).
    const onVisible = (): void => {
      if (!document.hidden) ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(ping, KEEP_WARM_INTERVAL_MS);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);
}
