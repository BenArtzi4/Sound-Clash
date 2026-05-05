import { useEffect, useState, type KeyboardEvent } from "react";
import styles from "./BuzzButton.module.css";

interface Props {
  disabled: boolean;
  isBuzzing: boolean;
  label?: string;
  subtitle?: string;
  onBuzz: () => void;
}

export function BuzzButton({ disabled, isBuzzing, label = "BUZZ", subtitle, onBuzz }: Props) {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!isBuzzing) {
      const t = setTimeout(() => setPressed(false), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isBuzzing]);

  const handleClick = () => {
    if (disabled) return;
    setPressed(true);
    onBuzz();
  };

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <button
      type="button"
      data-testid="buzz"
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKey}
      className={`${styles.button} ${pressed ? styles.pressed : ""}`}
      aria-label={label}
    >
      <span className={styles.label}>{label}</span>
      {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
    </button>
  );
}
