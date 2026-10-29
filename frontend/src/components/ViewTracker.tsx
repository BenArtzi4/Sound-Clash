import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackRoute } from "../lib/funnel";

// Sends one `view` event per route the visitor reaches (lib/funnel.ts), so the
// funnel can count Home → create page → console. Renders nothing, so the
// prerendered tree stays the same on the server and the client; the effect
// only runs in the browser.
export function ViewTracker() {
  const { pathname } = useLocation();

  useEffect(() => {
    trackRoute(pathname);
  }, [pathname]);

  return null;
}
