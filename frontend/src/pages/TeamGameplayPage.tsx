import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BuzzButton, type BuzzTone } from "../components/BuzzButton";
import { EndScreen } from "../components/EndScreen";
import { PointChange } from "../components/PointChange";
import { useBuzzer } from "../hooks/useBuzzer";
import { useGameChannel } from "../hooks/useGameChannel";
import { serverTimeNow } from "../hooks/useServerTime";
import { clearStoredTeam, getStoredTeam } from "../lib/teamStorage";
import type { ActiveGame } from "../lib/types";
import styles from "./TeamGameplayPage.module.css";

interface PointEvent {
  id: string;
  delta: number;
}

// The 4h expiry sweep (cleanup_expired_games) cascade-deletes game_teams a
// beat before active_games, so our team's DELETE arrives while the game row is
// still present — indistinguishable from a kick by row absence alone. The
// sweep only touches games whose expires_at has passed, so the clock is the
// discriminator (server-offset clock; falls back to the device clock until the
// first Realtime event is observed).
function isExpired(game: ActiveGame): boolean {
  const expiresAt = Date.parse(game.expires_at);
  return Number.isFinite(expiresAt) && serverTimeNow().getTime() >= expiresAt;
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
  // game is being torn down. Either way the stored identity is dead; only a
  // genuine kick (game still alive) bounces home — expiry/end teardown stays
  // on the page so the banner or podium renders instead of a silent redirect.
  useEffect(() => {
    if (!hydratedOnce || !stored) return;
    if (status === "gone") {
      clearStoredTeam(gameCode);
      return;
    }
    if (state && !state.teams.has(stored.id)) {
      clearStoredTeam(gameCode);
      // Teardown, not a kick: the game-row DELETE lands a beat later and flips
      // status to "gone" (backstopped by the resync hydrate if that event is
      // ever dropped).
      if (state.game.status === "ended" || isExpired(state.game)) return;
      navigate("/", { replace: true });
    }
  }, [hydratedOnce, stored, state, status, gameCode, navigate]);

  // Stable handler so the memoized BuzzButton (I-TeamRender) isn't re-rendered
  // by a new inline arrow on every parent render. buzzer.buzz is itself a
  // useCallback, so this only changes when the buzz identity legitimately does
  // (round number / lock / playing state) — not on unrelated ROUND_CHANGEs.
  // (Hoisted to a local: depending on `buzzer` directly would churn every
  // render — useBuzzer returns a fresh object — and defeat the memo.)
  const buzzAction = buzzer.buzz;
  const handleBuzz = useCallback(() => void buzzAction(), [buzzAction]);

  if (!stored) return null;

  // Our team row was cascade-deleted by the expiry sweep while the game row is
  // still present: paint the banner now rather than flashing the buzz UI for
  // the beat until the game-row DELETE flips status to "gone". (An ended game
  // keeps rendering the podium below instead.)
  const removedByExpiry =
    state !== null &&
    !state.teams.has(stored.id) &&
    state.game.status !== "ended" &&
    isExpired(state.game);

  if (status === "gone" || removedByExpiry) {
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
    // Game not playing yet — distinguish "still connecting" from "connected but
    // the host hasn't started" so the wait reads as progress, not a stall.
    if (status === "reconnecting")
      return { tone: "waiting", label: "RECONNECTING…", subtitle: "hold tight" };
    if (!state || status === "connecting") return { tone: "waiting", label: "CONNECTING…" };
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
          onBuzz={handleBuzz}
        />
      </div>

      {buzzer.error ? <p className="error">{buzzer.error.message}</p> : null}
    </main>
  );
}
