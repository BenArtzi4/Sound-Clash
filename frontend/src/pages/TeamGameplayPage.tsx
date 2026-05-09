import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BuzzButton } from "../components/BuzzButton";
import { Scoreboard } from "../components/Scoreboard";
import { useBuzzer } from "../hooks/useBuzzer";
import { useGameChannel } from "../hooks/useGameChannel";
import { serverTimeNow } from "../hooks/useServerTime";
import { clearStoredTeam, getStoredTeam } from "../lib/teamStorage";
import styles from "./TeamGameplayPage.module.css";

const ANSWER_DURATION_SEC = 10;

export function TeamGameplayPage() {
  const { gameCode = "" } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();
  const stored = useMemo(() => getStoredTeam(gameCode), [gameCode]);
  const [hydratedOnce, setHydratedOnce] = useState(false);
  const [now, setNow] = useState(() => serverTimeNow().getTime());

  useEffect(() => {
    if (!stored) {
      navigate(`/join/${gameCode}`, { replace: true });
    }
  }, [stored, gameCode, navigate]);

  const { state, status } = useGameChannel(gameCode);
  const buzzer = useBuzzer(gameCode, stored?.id ?? "", state);

  useEffect(() => {
    if (state) setHydratedOnce(true);
  }, [state]);

  // Tick every second so the round timer re-renders.
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverTimeNow().getTime()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // After hydrate, if our team isn't in the room, we've been kicked or the
  // game is gone. Clean up storage and bounce home.
  useEffect(() => {
    if (!hydratedOnce || !stored) return;
    if (status === "gone") {
      clearStoredTeam(gameCode);
      return;
    }
    if (state && !state.teams.has(stored.id)) {
      clearStoredTeam(gameCode);
      navigate("/", { replace: true });
    }
  }, [hydratedOnce, stored, state, status, gameCode, navigate]);

  if (!stored) return null;

  if (status === "gone") {
    return (
      <main className={styles.shell}>
        <div className={`${styles.statusBanner} ${styles.statusEnded}`}>
          This game has ended or expired.
        </div>
      </main>
    );
  }

  const teams = state ? Array.from(state.teams.values()) : [];
  const game = state?.game;
  const lockedByMe = buzzer.lockedByMe;
  const lockedTeam =
    game?.buzzed_team_id != null ? (state?.teams.get(game.buzzed_team_id) ?? null) : null;

  const lockedAt = game?.locked_at ?? null;
  const elapsedSec = lockedAt ? Math.max(0, Math.floor((now - Date.parse(lockedAt)) / 1000)) : 0;
  const remainingSec = Math.max(0, ANSWER_DURATION_SEC - elapsedSec);
  const timerActive = game?.status === "playing" && lockedTeam != null && lockedAt != null;
  const timerPct = Math.max(0, Math.min(100, (remainingSec / ANSWER_DURATION_SEC) * 100));

  let bannerClass = styles.statusBanner;
  let bannerText = "Waiting for the host to start…";
  if (game?.status === "ended") {
    bannerClass = `${styles.statusBanner} ${styles.statusEnded}`;
    bannerText = "Game over.";
  } else if (game?.status === "playing") {
    if (lockedByMe) {
      bannerClass = `${styles.statusBanner} ${styles.statusLocked}`;
      bannerText = "You buzzed in! Wait for the host.";
    } else if (lockedTeam) {
      bannerClass = `${styles.statusBanner} ${styles.statusLocked}`;
      bannerText = `${lockedTeam.name} locked it.`;
    } else {
      bannerClass = `${styles.statusBanner} ${styles.statusPlaying}`;
      bannerText = "Buzz when you know it!";
    }
  }

  const buzzDisabled =
    !state || status !== "subscribed" || game?.status !== "playing" || buzzer.isLocked;

  const buzzTone: "idle" | "locked-other" | "winner" = lockedByMe
    ? "winner"
    : lockedTeam
      ? "locked-other"
      : "idle";
  const buzzSubtitle =
    game?.status === "playing"
      ? lockedByMe
        ? "Wait for the host"
        : lockedTeam
          ? `${lockedTeam.name} buzzed first`
          : "Tap or press space"
      : undefined;

  const connectionLabel = status === "subscribed" ? "Connected" : "Connecting…";
  const connectionStateClass = status === "subscribed" ? styles.connOk : styles.connWait;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.teamName}>{stored.name}</span>
          <span className={styles.identityMeta}>
            <span className={styles.gameCode}>{gameCode}</span>
            {game && game.status !== "waiting" ? (
              <span className={styles.roundPill} data-testid="round-indicator">
                Round {game.round_number}
              </span>
            ) : null}
          </span>
        </div>
        <div
          className={`${styles.connection} ${connectionStateClass}`}
          role="status"
          aria-live="polite"
        >
          <span className={styles.connectionDot} aria-hidden="true" />
          <span>{connectionLabel}</span>
        </div>
      </header>

      <div className={bannerClass} role="status" aria-live="polite">
        {bannerText}
      </div>

      {timerActive ? (
        <div
          className={`${styles.timer} ${remainingSec <= 5 ? styles.timerLow : ""}`}
          style={{ "--timer-pct": `${timerPct}%` } as CSSProperties}
          role="timer"
          aria-label="Time remaining"
        >
          <div className={styles.timerBar}>
            <div className={styles.timerFill} />
          </div>
          <span className={styles.timerValue}>{remainingSec}s</span>
          <span className="visually-hidden" aria-live="polite" role="status">
            {remainingSec <= 5 && remainingSec > 0 ? `${remainingSec} seconds left` : ""}
          </span>
        </div>
      ) : null}

      <div className={styles.buzzZone}>
        <BuzzButton
          disabled={buzzDisabled}
          isBuzzing={buzzer.isBuzzing}
          label={lockedByMe ? "LOCKED" : "BUZZ"}
          subtitle={buzzSubtitle}
          tone={buzzTone}
          onBuzz={() => void buzzer.buzz()}
        />
      </div>

      {buzzer.error ? <p className="error">{buzzer.error.message}</p> : null}

      <section className={styles.scoreCard}>
        <h2 className={styles.scoreCardTitle}>Scoreboard</h2>
        <Scoreboard
          teams={teams}
          buzzedTeamId={game?.buzzed_team_id ?? null}
          myTeamId={stored.id}
        />
      </section>
    </main>
  );
}
