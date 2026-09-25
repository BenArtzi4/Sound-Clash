import { EqualizerMark } from "./icons";
import styles from "./Logo.module.css";

interface Props {
  size?: "small" | "medium" | "large" | "hero";
  animated?: boolean;
}

// The DOM text must stay exactly "Sound Clash" (RouteFallback.test asserts it);
// uppercase is applied in CSS. It used to morph between pages; screen changes
// are instant now (ui-redesign 10-touch-and-route-motion.md).
export function Logo({ size = "medium", animated = true }: Props) {
  return (
    <div className={`${styles.logo} ${styles[size]}`}>
      <span className={`${styles.mark} ${animated ? styles.animated : ""}`} aria-hidden="true">
        <EqualizerMark />
      </span>
      <span className={styles.text}>Sound Clash</span>
    </div>
  );
}
