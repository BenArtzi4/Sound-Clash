import { useEffect, useState } from "react";
import { serverTimeNow } from "../hooks/useServerTime";
import styles from "./ExpiryCountdown.module.css";

// The manager console's view of the game TTL (T4.8 / I-Expiry). active_games
// rows are swept ~4 hours after creation (docs/game-rules.md §10) and the
// clock starts at creation, so lobby time eats into it. Outside the last
// WARNING_WINDOW_MS this renders nothing (the host asked for no standing
// "Ends at HH:MM" hint); inside it, a warning banner whose "Keep playing +1h"
// action is the only surface for the extend_game RPC — deliberately not a
// persistent button. A game past its expires_at but not yet swept (the sweep
// is hourly) keeps the banner and the action: extend_game grants a full hour
// from now there. The banner leaves the warning state on its own when the
// Realtime UPDATE for the bumped expires_at moves `expiresAt` back out of the
// window.
//
// Owns its own per-second tick, RoundCountdown-style, so re-rendering the
// clock doesn't re-render the page tree. Times are computed on the
// server-offset clock (serverTimeNow) so a skewed host device doesn't warn
// early or late.
export const WARNING_WINDOW_MS = 20 * 60 * 1000;

interface Props {
  expiresAt: string;
  extendPending: boolean;
  onExtend: () => void;
}

export function ExpiryCountdown({ expiresAt, extendPending, onExtend }: Props) {
  const [now, setNow] = useState(() => serverTimeNow().getTime());
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverTimeNow().getTime()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Date.parse(expiresAt) - now;
  const warning = remainingMs <= WARNING_WINDOW_MS;
  const overdue = remainingMs <= 0;

  // The per-second m:ss text must NOT sit in a live region (a polite region
  // re-announces every mutation, so a screen-reader host would hear the
  // countdown once a second for the whole window). Mirror RoundCountdown:
  // the ticking value lives under role="timer" (implicit aria-live off), and
  // a separate always-mounted visually-hidden announcer speaks ONCE when the
  // warning state is entered (its text flips from empty to the sentence).
  return (
    <>
      <span className="visually-hidden" aria-live="polite" role="status">
        {warning ? "The game is ending soon — use Keep playing to extend it." : ""}
      </span>
      {warning ? (
        <div className={styles.warning} data-testid="expiry-banner">
          <span
            className={styles.warningText}
            role="timer"
            aria-label="Time until the game expires"
          >
            {overdue
              ? "Game has passed its play window — it may close at any moment."
              : `Game expires in ${formatRemaining(remainingMs)}`}
          </span>
          <button
            type="button"
            className={`btn ${styles.extendBtn}`}
            onClick={onExtend}
            disabled={extendPending}
            data-testid="extend-game"
          >
            Keep playing +1h
          </button>
        </div>
      ) : null}
    </>
  );
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
