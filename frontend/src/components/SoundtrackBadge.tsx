import styles from "./SoundtrackBadge.module.css";

interface Props {
  size?: "default" | "large";
}

// Shown on manager + display screens when the current round's song has a
// `source` set: it tells everyone the round is a soundtrack round, so the
// team is asked to name the work (film / TV / game / musical), and a correct
// call awards 15 points instead of the usual 10/5 title/artist split.
export function SoundtrackBadge({ size = "default" }: Props) {
  return (
    <span
      className={`${styles.badge}${size === "large" ? ` ${styles.large}` : ""}`}
      role="img"
      aria-label="Soundtrack round"
      data-testid="soundtrack-badge"
    >
      <span className={styles.icon} aria-hidden="true">
        🎬
      </span>
      Soundtrack
    </span>
  );
}
