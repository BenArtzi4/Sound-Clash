import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface QrSvgState {
  svg: string | null;
  error: boolean;
}

// Render a URL as an inline QR SVG string. Shared by the display page's join
// QR (QRPanel) and the manager console's backup host link (HostRecoveryLink).
// While `svg` is null and `error` is false the code is still generating.
export function useQrSvg(url: string, size: number): QrSvgState {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    void QRCode.toString(url, {
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
  }, [url, size]);

  return { svg, error };
}
