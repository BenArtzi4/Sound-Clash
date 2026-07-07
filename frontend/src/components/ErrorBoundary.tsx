import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./ErrorBoundary.module.css";

type Props = { children: ReactNode };
type State = { hasError: boolean };

// App-level backstop so a render crash shows a recoverable screen instead of a
// blank white page. Its most important job is the mid-game deploy case: a stale
// `React.lazy` route chunk that fails to import (see lib/preloadError.ts)
// rejects, which React surfaces as a thrown error during render. The
// preloadError handler auto-reloads once for the common stale-chunk case; this
// boundary catches everything else — an auto-reload suppressed by the loop
// guard, or any other unexpected render error — and offers a manual reload.
//
// A hard reload is the recovery (not just resetting boundary state) because
// React.lazy caches a rejected import: re-rendering the same lazy element just
// throws the same error again. A full reload re-fetches index.html with the
// current content-hashes.
//
// Must be a class: React error boundaries have no hook equivalent
// (getDerivedStateFromError / componentDidCatch).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // React's boundary swallows the error before it reaches window.onerror, so
    // Sentry's global handler never sees it — log explicitly for diagnosis.
    // Best-effort; must never itself throw.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  private readonly handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.card}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.body}>
            The app hit a snag — reloading usually fixes it. Your game is still running.
          </p>
          <button type="button" className={styles.button} onClick={this.handleReload}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
