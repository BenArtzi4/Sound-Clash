import { useCallback } from "react";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

type VTDocument = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> };
};

// WebKit — Safari and every iOS browser — crashed the page on a transition into a
// lazy route that is taller than the viewport: Playwright's WebKit 26.5, 30/30
// reproductions on Home → Host and Home → How to play (local dev server and prod),
// 0/12 on the plain-navigate path, and no CSS-only mitigation held up under
// repeats (docs/planning/ui-redesign/validation/2026-09-22-final-validation.md,
// F-04). Until WebKit is proven clean on a real device, it gets the instant swap
// the spec already defines for engines without the API. navigator.vendor is
// "Apple Computer, Inc." on WebKit and nothing else (Chromium "Google Inc.",
// Firefox "").
function isWebKit(): boolean {
  return typeof navigator !== "undefined" && navigator.vendor === "Apple Computer, Inc.";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Settles once React has actually committed a DOM change, or after `timeoutMs`.
//
// Why this exists: react-router's declarative <BrowserRouter> pushes location
// updates through `React.startTransition` (react-router 7.18, `Router`:
// `startTransition(() => setStateImpl(newState))`), and `flushSync` cannot
// force a transition update to be synchronous. So `navigate()` inside a
// view-transition update callback returns with the OLD page still in the DOM:
// the browser captures old-as-new, and the real swap ~15 ms later — which drops
// the wordmark's `view-transition-name` — aborts the whole transition. Measured
// on a preview build: 240 ms of animation ended at ~45 ms. Returning a promise
// from the callback makes the browser wait for the real DOM before it captures.
//
// The observer is attached BEFORE navigate() so a synchronous commit can't slip
// past it, and the timeout is a hard cap: a navigation that changes nothing
// would otherwise hold rendering suppressed until the browser's own 4 s limit.
function nextDomCommit(timeoutMs = 100): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(finish);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(finish, timeoutMs);
  });
}

// The ONLY place that may call document.startViewTransition (validation plan
// §5; frontend/scripts/check-bundle.mjs fails the build if the string reaches
// the team or manager chunk). react-router's own `viewTransition` option is a
// no-op under the declarative <BrowserRouter> this app uses
// (docs/planning/ui-redesign/03-library-evaluation.md §2.1), so route
// transitions go through here.
//
// Preloads the lazy route chunk first so the transition never animates to the
// Suspense fallback; skips the transition — and with it the spec's hit-testing
// freeze, which makes the whole page pointer-inert for the transition's
// duration — under reduced motion or where unsupported. Route changes only:
// never a Realtime update, never a scoring click.
export function useViewTransitionNavigate() {
  const navigate = useNavigate();
  return useCallback(
    async (to: To, opts: NavigateOptions & { preload?: () => Promise<unknown> } = {}) => {
      const { preload, ...navOpts } = opts;
      try {
        await preload?.();
      } catch {
        /* a failed preload is handled by lib/preloadError on the real import */
      }
      const doc = document as VTDocument;
      if (typeof doc.startViewTransition !== "function" || prefersReducedMotion() || isWebKit()) {
        navigate(to, navOpts);
        return;
      }
      doc.startViewTransition(() => {
        const committed = nextDomCommit();
        navigate(to, navOpts);
        return committed;
      });
    },
    [navigate],
  );
}
