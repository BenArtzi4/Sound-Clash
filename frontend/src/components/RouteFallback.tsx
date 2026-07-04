import { Logo } from "./Logo";
import styles from "./RouteFallback.module.css";

// Shown while a lazily-loaded route chunk is fetching (App's Suspense
// fallback). A centered, gently pulsing Sound Clash logo — its equalizer bars
// already animate — so a slow chunk load reads as "loading" instead of a blank
// flash. No new assets; respects prefers-reduced-motion.
export function RouteFallback() {
  return (
    <div className={styles.fallback} role="status" aria-label="Loading">
      <div className={styles.pulse}>
        <Logo size="large" />
      </div>
    </div>
  );
}
