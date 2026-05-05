import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BuzzButton } from "../components/BuzzButton";
import { Scoreboard } from "../components/Scoreboard";
import { useBuzzer } from "../hooks/useBuzzer";
import { useGameChannel } from "../hooks/useGameChannel";
import styles from "./TeamGameplayPage.module.css";

interface StoredTeam {
  id: string;
  name: string;
}

function readStoredTeam(gameCode: string): StoredTeam | null {
  try {
    const raw = window.localStorage.getItem(`game:${gameCode}:team`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTeam>;
    if (!parsed.id || !parsed.name) return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

function clearStoredTeam(gameCode: string): void {
  window.localStorage.removeItem(`game:${gameCode}:team`);
}

export function TeamGameplayPage() {
  const { gameCode = "" } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();
  const stored = useMemo(() => readStoredTeam(gameCode), [gameCode]);
  const [hydratedOnce, setHydratedOnce] = useState(false);

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
    game?.buzzed_team_id != null
      ? state?.teams.get(game.buzzed_team_id) ?? null
      : null;

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
      bannerText = `Round ${game.round_number} — buzz when you know it!`;
    }
  }

  const buzzDisabled =
    !state ||
    status !== "subscribed" ||
    game?.status !== "playing" ||
    buzzer.isLocked;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.teamName}>{stored.name}</span>
          <span className={styles.gameCode}>{gameCode}</span>
        </div>
        <div className="muted">
          {status === "subscribed" ? "Connected" : "Connecting…"}
        </div>
      </header>

      <div className={bannerClass}>{bannerText}</div>

      <div className={styles.buzzZone}>
        <BuzzButton
          disabled={buzzDisabled}
          isBuzzing={buzzer.isBuzzing}
          label={lockedByMe ? "LOCKED" : "BUZZ"}
          subtitle={
            game?.status === "playing" && !buzzer.isLocked
              ? "Tap or press space"
              : undefined
          }
          onBuzz={() => void buzzer.buzz()}
        />
      </div>

      {buzzer.error ? <p className="error">{buzzer.error.message}</p> : null}

      <section className={styles.scoreCard}>
        <h2 className={styles.scoreCardTitle}>Scoreboard</h2>
        <Scoreboard teams={teams} buzzedTeamId={game?.buzzed_team_id ?? null} />
      </section>
    </main>
  );
}
