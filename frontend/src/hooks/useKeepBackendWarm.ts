import { useEffect } from "react";
import { getHealth } from "../lib/api";

// Render's free-tier API container spins down after ~15 min idle. During an
// active game every hot-path action (buzz, score, next round) goes straight to
// Supabase, so the FastAPI backend sees no traffic and goes cold mid-game --
// and then the host's next REST call (Bonus / End game / Kick) or a late team's
// join stalls 2-30s on cold start. HomePage already pre-warms on entry, but
// that wears off once a long game has been running on direct-RPC traffic alone.
//
// While the manager console is mounted and a game is in progress we ping
// /health on an interval, keeping the container warm for exactly as long as a
// game is being run (no 24/7 always-on cost — it conserves Render's free
// monthly hours, which a cron pinger would burn). Errors are ignored: a failed
// ping just means the next real call hits the same cold start it would have
// hit anyway, so this is never worse than not pinging.
export const KEEP_WARM_INTERVAL_MS = 10 * 60 * 1000; // 10 min, comfortably under Render's ~15 min idle

export function useKeepBackendWarm(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => {
      void getHealth().catch(() => undefined);
    }, KEEP_WARM_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [active]);
}
