import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { applyRouteHead } from "../lib/routeHead";

// Sets the page title, description, canonical and share-card text for the
// current route on every client-side navigation (see lib/routeHead.ts; the
// first load already has them from the per-page HTML the build writes).
// Mounted once inside <BrowserRouter> in App; renders nothing.
export function RouteHead() {
  const { pathname } = useLocation();

  useEffect(() => {
    applyRouteHead(pathname);
  }, [pathname]);

  return null;
}
