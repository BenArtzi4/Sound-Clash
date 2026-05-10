import { useEffect, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import styles from "./QRPanel.module.css";

interface Props {
  joinUrl: string;
  gameCode: string;
  size?: number;
}

export function QRPanel({ joinUrl, gameCode, size = 220 }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    void QRCode.toString(joinUrl, {
      type: "svg",
      width: size,
      errorCorrectionLevel: "M",
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl, size]);

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
