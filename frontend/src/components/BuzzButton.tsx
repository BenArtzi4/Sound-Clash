import { useEffect, useState, type KeyboardEvent } from "react";
import styles from "./BuzzButton.module.css";

export type BuzzTone = "idle" | "locked-other" | "winner";

interface Props {
  disabled: boolean;
  isBuzzing: boolean;
  label?: string;
  subtitle?: string;
  tone?: BuzzTone;
  onBuzz: () => void;
}

export function BuzzButton({
  disabled,
  isBuzzing,
  label = "BUZZ",
  subtitle,
  tone = "idle",
  onBuzz,
}: Props) {
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

  const toneClass =
    tone === "winner" ? styles.toneWinner : tone === "locked-other" ? styles.toneLockedOther : "";

  const className = [styles.button, pressed ? styles.pressed : "", toneClass]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      data-testid="buzz"
      data-tone={tone}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKey}
      className={className}
    >
      <span className={styles.label}>{label}</span>
      {subtitle ? (
        <>
          {" "}
          <span className={styles.subtitle}>{subtitle}</span>
        </>
      ) : null}
    </button>
  );
}
