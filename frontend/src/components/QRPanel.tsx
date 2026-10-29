import { type CSSProperties } from "react";
import { useQrSvg } from "../hooks/useQrSvg";
import styles from "./QRPanel.module.css";

interface Props {
  /** The address printed under the code, for people who type it. */
  joinUrl: string;
  /** What the QR code encodes, when it differs from joinUrl (a tracking tag). */
  qrUrl?: string;
  gameCode: string;
  size?: number;
  // Inside a size container, stack the panel and grow the QR to fill the
  // container (the display's waiting screen). `size` still applies anywhere
  // there is no size container around the panel.
  fill?: boolean;
  // Smaller padding and code, no URL line: the display's phone frames during
  // a game, where every row of the board needs the height.
  compact?: boolean;
}

export function QRPanel({
  joinUrl,
  qrUrl,
  gameCode,
  size = 220,
  fill = false,
  compact = false,
}: Props) {
  const { svg, error } = useQrSvg(qrUrl ?? joinUrl, size);

  return (
    <div
      className={[styles.panel, fill ? styles.fill : "", compact ? styles.compact : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={styles.qrFrame}
        aria-hidden="true"
        style={{ "--qr-frame-size": `${size}px` } as CSSProperties}
      >
        {svg ? (
          <div className={styles.qrSvg} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : error ? (
          <span className={styles.fallback}>QR unavailable</span>
        ) : (
          <span className={styles.fallback}>Generating…</span>
        )}
      </div>
      <div className={styles.body}>
        <p className={styles.hint}>Scan to join</p>
        <p className={styles.code}>{gameCode}</p>
        <p className={styles.url}>{joinUrl}</p>
      </div>
    </div>
  );
}
