import styles from "./Logo.module.css";

interface Props {
  size?: "small" | "medium" | "large";
  animated?: boolean;
}

export function Logo({ size = "medium", animated = true }: Props) {
  return (
    <div className={`${styles.logo} ${styles[size]}`}>
      <div className={`${styles.icon} ${animated ? styles.animated : ""}`}>
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
      </div>
      <span className={styles.text}>Sound Clash</span>
    </div>
  );
}
