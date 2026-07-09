import { type CSSProperties } from "react";
import { useQrSvg } from "../hooks/useQrSvg";
import styles from "./QRPanel.module.css";

interface Props {
  joinUrl: string;
  gameCode: string;
  size?: number;
}

export function QRPanel({ joinUrl, gameCode, size = 220 }: Props) {
  const { svg, error } = useQrSvg(joinUrl, size);

  return (
    <div className={styles.panel}>
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
