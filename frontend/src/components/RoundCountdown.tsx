import { useEffect, useState, type CSSProperties } from "react";
import { serverTimeNow } from "../hooks/useServerTime";

// Owns its own per-second `now` tick so re-rendering the timer doesn't
// re-render the surrounding page tree (BuzzButton, YouTubePlayer
// etc.). Each parent (DisplayPage, TeamGameplayPage) passes its own CSS
// module styles so the visual block stays page-specific. The styles map is
// typed as Record<string,string> because Vite's CSSModuleClasses doesn't
// expose literal keys; the page-level class names (.timer, .timerLow, etc.)
// must exist in both modules' .module.css files.
interface Props {
  lockedAt: string;
  durationSec: number;
  styles: Record<string, string>;
  withSrAnnouncer?: boolean;
}

export function RoundCountdown({ lockedAt, durationSec, styles, withSrAnnouncer }: Props) {
  const [now, setNow] = useState(() => serverTimeNow().getTime());
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverTimeNow().getTime()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsedSec = Math.max(0, Math.floor((now - Date.parse(lockedAt)) / 1000));
  const remainingSec = Math.max(0, durationSec - elapsedSec);
  const timerPct = Math.max(0, Math.min(100, (remainingSec / durationSec) * 100));

  return (
    <div
      className={`${styles.timer} ${remainingSec <= 5 ? styles.timerLow : ""}`}
      // `--timer-pct` (percentage) still drives the manager ring's conic-gradient;
      // `--timer-scale` (0-1) drives the display fill via transform: scaleX so the
      // bar animates on the compositor instead of relaying out its `width`.
      style={
        { "--timer-pct": `${timerPct}%`, "--timer-scale": `${timerPct / 100}` } as CSSProperties
      }
      role="timer"
      aria-label="Time remaining"
    >
      <div className={styles.timerBar}>
        <div className={styles.timerFill} />
      </div>
      <span className={styles.timerValue}>{remainingSec}s</span>
      {withSrAnnouncer ? (
        <span className="visually-hidden" aria-live="polite" role="status">
          {remainingSec <= 5 && remainingSec > 0 ? `${remainingSec} seconds left` : ""}
        </span>
      ) : null}
    </div>
  );
}
