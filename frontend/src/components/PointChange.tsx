import { useEffect } from "react";
import styles from "./PointChange.module.css";

interface Props {
  teamName?: string;
  delta: number;
  onDone: () => void;
  durationMs?: number;
}

export function PointChange({ teamName, delta, onDone, durationMs = 2500 }: Props) {
  useEffect(() => {
    const id = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(id);
  }, [onDone, durationMs]);

  const sign = delta > 0 ? "+" : "";
  const toneClass = delta > 0 ? styles.positive : styles.negative;
  return (
    <div
      className={`${styles.pill} ${toneClass}`}
      role="status"
      aria-live="polite"
      data-testid="point-change"
    >
      {teamName ? <span className={styles.team}>{teamName}</span> : null}
      <span className={styles.delta}>
        {sign}
        {delta}
      </span>
    </div>
  );
}
