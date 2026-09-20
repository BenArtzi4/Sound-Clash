import type { CSSProperties } from "react";
import { EqualizerMark } from "./icons";
import styles from "./Logo.module.css";

interface Props {
  size?: "small" | "medium" | "large" | "hero";
  animated?: boolean;
}

// The DOM text must stay exactly "Sound Clash" (RouteFallback.test asserts it);
// uppercase is applied in CSS. The root carries view-transition-name so route
// transitions morph the wordmark between its header and hero positions.
export function Logo({ size = "medium", animated = true }: Props) {
  return (
    <div
      className={`${styles.logo} ${styles[size]}`}
      style={{ viewTransitionName: "wordmark" } as CSSProperties}
    >
      <span className={`${styles.mark} ${animated ? styles.animated : ""}`} aria-hidden="true">
        <EqualizerMark />
      </span>
      <span className={styles.text}>Sound Clash</span>
    </div>
  );
}
