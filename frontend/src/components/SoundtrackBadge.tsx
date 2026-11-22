import { FilmIcon } from "./icons";
import styles from "./SoundtrackBadge.module.css";

interface Props {
  // "heading": the TV's answer-card title, sized by its parent.
  size?: "default" | "heading";
}

// Shown on manager + display screens when the current round's song is a
// soundtrack (is_soundtrack=true): it tells everyone to name the work
// (film / TV / game / musical), and a correct call awards 15 points instead
// of the usual 10/5 title/artist split.
export function SoundtrackBadge({ size = "default" }: Props) {
  return (
    <span
      className={`${styles.badge}${size === "heading" ? ` ${styles.heading}` : ""}`}
      role="img"
      aria-label="Soundtrack round"
      data-testid="soundtrack-badge"
    >
      <span className={styles.icon} aria-hidden="true">
        <FilmIcon />
      </span>
      Soundtrack
    </span>
  );
}
