import { useEffect, useRef, useState } from "react";
import { useQrSvg } from "../hooks/useQrSvg";
import { managerRecoveryUrl } from "../lib/managerToken";
import styles from "./HostRecoveryLink.module.css";

// Backup host access (T4.10). The manager token lives only in this browser's
// localStorage, so a dead phone or a cleared browser used to mean the game
// was unmanageable forever (runbook §4.4b). This disclosure hands the host a
// recovery link — /manager/game/<CODE>#mt=<token> — to scan or copy onto a
// second device BEFORE anything goes wrong; opening it there adopts the token
// and makes that device a console too. Collapsed by default: the link grants
// full host control, so it renders only on an explicit tap, on the host's own
// screen (never the shared display).

interface Props {
  gameCode: string;
  managerToken: string;
}

export function HostRecoveryLink({ gameCode, managerToken }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="host-recovery-panel"
        data-testid="host-link-toggle"
      >
        {open ? "Hide backup host link" : "Backup host link"}
      </button>
      {open ? <RecoveryPanel gameCode={gameCode} managerToken={managerToken} /> : null}
    </section>
  );
}

// Inner panel so the QR is only generated once the host actually opens the
// disclosure (hooks can't sit behind a conditional in the parent).
function RecoveryPanel({ gameCode, managerToken }: Props) {
  const url = managerRecoveryUrl(gameCode, managerToken);
  const { svg, error } = useQrSvg(url, 180);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the URL
      // text stays visible and selectable, so tell the host to grab it there.
      setCopyState("failed");
    }
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyState("idle"), 2500);
  }

  return (
    <div
      id="host-recovery-panel"
      className={styles.panel}
      data-testid="host-link-panel"
      role="group"
      aria-label="Backup host link"
    >
      <div className={styles.qrFrame} aria-hidden="true">
        {svg ? (
          <div className={styles.qrSvg} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className={styles.fallback}>{error ? "QR unavailable" : "Generating…"}</span>
        )}
      </div>
      <div className={styles.body}>
        <p className={styles.hint}>
          Scan with another device (or copy the link to it) and that device can also run this game —
          your safety net if this one dies or its browser data is cleared.
        </p>
        <p className={styles.url} data-testid="host-link-url">
          {url}
        </p>
        <div className={styles.copyRow}>
          <button
            type="button"
            className={`btn ${styles.copyBtn}`}
            onClick={() => void handleCopy()}
            data-testid="host-link-copy"
          >
            {copyState === "copied" ? "Copied ✓" : "Copy link"}
          </button>
          {copyState === "failed" ? (
            <span className={styles.copyFailed} role="status">
              Copy failed — select the link text above instead.
            </span>
          ) : null}
        </div>
        <p className={styles.caution}>
          Anyone with this link controls the game — share it only with a co-host.
        </p>
      </div>
    </div>
  );
}
