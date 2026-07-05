import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BuzzButton, type BuzzTone } from "../components/BuzzButton";
import { EndScreen } from "../components/EndScreen";
import { PointChange } from "../components/PointChange";
import { useBuzzer } from "../hooks/useBuzzer";
import { useGameChannel } from "../hooks/useGameChannel";
import { clearStoredTeam, getStoredTeam } from "../lib/teamStorage";
import styles from "./TeamGameplayPage.module.css";

interface PointEvent {
  id: string;
  delta: number;
}

export function TeamGameplayPage() {
  const { gameCode = "" } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();
  const stored = useMemo(() => getStoredTeam(gameCode), [gameCode]);
  const [hydratedOnce, setHydratedOnce] = useState(false);

  useEffect(() => {
    if (!stored) {
      navigate(`/join/${gameCode}`, { replace: true });
    }
  }, [stored, gameCode, navigate]);

  const { state, status } = useGameChannel(gameCode);
  const buzzer = useBuzzer(gameCode, stored?.id ?? "", state);
  const [pointEvents, setPointEvents] = useState<PointEvent[]>([]);
  const prevScoreRef = useRef<number | null>(null);
  const eventSeqRef = useRef(0);

  useEffect(() => {
    if (state) setHydratedOnce(true);
  }, [state]);

  // Diff our team's score across renders. First hydrate just snapshots the
  // baseline; subsequent changes emit a single "+N / -N" pill.
  useEffect(() => {
    if (!state || !stored) return;
    const me = state.teams.get(stored.id);
    if (!me) return;
    const prev = prevScoreRef.current;
    if (prev !== null && me.score !== prev) {
      eventSeqRef.current += 1;
      const id = `${stored.id}-${eventSeqRef.current}`;
      setPointEvents((current) => [...current, { id, delta: me.score - prev }]);
    }
    prevScoreRef.current = me.score;
  }, [state, stored]);

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
        <div className={styles.statusEnded}>This game has ended or expired.</div>
      </main>
    );
  }

  // Once the host has ended the game, surface the same celebratory podium the
  // display + manager show. The BUZZ button is gone — there's nothing left to do.
  if (state?.game.status === "ended") {
    const finalTeams = Array.from(state.teams.values());
    return (
      <main className={styles.shell}>
        <EndScreen teams={finalTeams} gameCode={gameCode} />
      </main>
    );
  }

  const game = state?.game;
  const lockedByMe = buzzer.lockedByMe;
  // Resolve the locking team from the hook's effective lock (provisional RPC
  // result OR the authoritative Realtime lock), so "SOMEONE ELSE BUZZED"
  // appears the instant buzz_in returns, not a fan-out later.
  const lockedTeamId = buzzer.lockedTeamId;
  const lockedTeam = lockedTeamId != null ? (state?.teams.get(lockedTeamId) ?? null) : null;

  const buzzDisabled =
    !state || status !== "subscribed" || game?.status !== "playing" || buzzer.isLocked;

  const buzz = ((): { tone: BuzzTone; label: string; subtitle?: string } => {
    if (game?.status === "playing") {
      if (lockedByMe) return { tone: "winner", label: "YOU BUZZED" };
      if (lockedTeam)
        return {
          tone: "locked-other",
          label: "SOMEONE ELSE BUZZED",
          subtitle: `${lockedTeam.name} got it first`,
        };
      // Transient acknowledgment between the press and the RPC resolving: the
      // press already fired buzz_in, so confirm it immediately rather than
      // leaving the button reading "BUZZ" for the round-trip.
      if (buzzer.isBuzzing) return { tone: "pending", label: "BUZZED!" };
      return { tone: "idle", label: "BUZZ" };
    }
    return { tone: "waiting", label: "WAITING", subtitle: "for the game to start" };
  })();

  return (
    <main className={styles.shell}>
      <div className={styles.pointStack} aria-live="polite">
        {pointEvents.map((ev) => (
          <PointChange
            key={ev.id}
            delta={ev.delta}
            onDone={() =>
              setPointEvents((current) => current.filter((existing) => existing.id !== ev.id))
            }
          />
        ))}
      </div>

      <div className={styles.identityOverlay} aria-label="Team identity">
        <span className={styles.teamName}>{stored.name}</span>
        {game && game.status !== "waiting" ? (
          <span className={styles.roundPill} data-testid="round-indicator">
            R{game.round_number}
          </span>
        ) : null}
      </div>

      <div className={styles.buzzZone}>
        <BuzzButton
          disabled={buzzDisabled}
          isBuzzing={buzzer.isBuzzing}
          label={buzz.label}
          subtitle={buzz.subtitle}
          tone={buzz.tone}
          onBuzz={() => void buzzer.buzz()}
        />
      </div>

      {buzzer.error ? <p className="error">{buzzer.error.message}</p> : null}
    </main>
  );
}
