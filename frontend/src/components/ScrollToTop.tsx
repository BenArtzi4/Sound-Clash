import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Resets the window scroll to the top on every client-side route change.
// React Router keeps the previous page's scroll offset across a <Link>
// navigation, so a tall page reached from a scrolled-down page renders already
// scrolled past its own header — most visibly How to Play, whose Home link sits
// below the fold, landing the user around the "Roles" section (issue #181).
// Mounted once inside <BrowserRouter> in App; renders nothing.
//
// Keyed on pathname only, and skipped when a hash is present, so it never yanks
// the viewport away from an in-page #anchor or the browser's native hash scroll
// — and so the #rt= / #mt= rejoin/recovery token fragments and the manager
// token-scrub replace() don't trigger a spurious scroll.
export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
}
