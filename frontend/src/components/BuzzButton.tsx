import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./BuzzButton.module.css";

export type BuzzTone = "idle" | "locked-other" | "winner" | "waiting";

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
  // pointerdown fires onBuzz; the synthetic click that follows the same
  // gesture must not double-fire. The ref is cleared on the next click.
  const firedFromPointerRef = useRef(false);

  useEffect(() => {
    if (!isBuzzing) {
      const t = setTimeout(() => setPressed(false), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isBuzzing]);

  const fire = () => {
    if (disabled) return;
    setPressed(true);
    onBuzz();
  };

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.button !== undefined && e.button !== 0) return;
    firedFromPointerRef.current = true;
    fire();
  };

  const handleClick = () => {
    if (firedFromPointerRef.current) {
      firedFromPointerRef.current = false;
      return;
    }
    fire();
  };

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      fire();
    }
  };

  const toneClass =
    tone === "winner"
      ? styles.toneWinner
      : tone === "locked-other"
        ? styles.toneLockedOther
        : tone === "waiting"
          ? styles.toneWaiting
          : "";

  const className = [styles.button, pressed ? styles.pressed : "", toneClass]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      data-testid="buzz"
      data-tone={tone}
      disabled={disabled}
      onPointerDown={handlePointerDown}
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
