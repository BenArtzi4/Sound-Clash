import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BuzzButton, type BuzzTone } from "../components/BuzzButton";
import { EndScreen } from "../components/EndScreen";
import { PointChange } from "../components/PointChange";
import { useBuzzer } from "../hooks/useBuzzer";
import { isGameExpired, useGameChannel } from "../hooks/useGameChannel";
import { clearStoredTeam, getStoredTeam } from "../lib/teamStorage";
import type { GameState } from "../lib/types";
import styles from "./TeamGameplayPage.module.css";

interface PointEvent {
  id: string;
  delta: number;
}

// The end-of-game view, shared by "the host ended the game" (podium from live
// state) and "the rows are gone / being swept" (podium from the last-known
// snapshot, I-FinalBoard). `expired` — the game never reached "ended"; the
// expiry sweep tore it down mid-play — adds the banner on top so the frozen
// board reads as expired, not as a normal finish. It's an explicit prop rather
// than derived from `board.game.status` so each call site states its intent
// (the ended branch always passes false; the gone branch derives it from the
// snapshot). Module-level so React keeps one component type across the
// live-ended → swept transition (no podium remount, no confetti replay).
function FinalBoard({
  board,
  gameCode,
  expired,
}: {
  board: GameState;
  gameCode: string;
  expired: boolean;
}) {
  return (
    <main className={styles.shell}>
      {expired ? <div className={styles.statusEnded}>This game has ended or expired.</div> : null}
      <EndScreen teams={Array.from(board.teams.values())} gameCode={gameCode} />
    </main>
  );
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

  const { state, status, finalBoard } = useGameChannel(gameCode);
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
      if (state.game.status === "ended" || isGameExpired(state.game)) return;
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
  // still present: paint the end-of-game view now rather than flashing the
  // buzz UI for the beat until the game-row DELETE flips status to "gone".
  // (An ended game keeps rendering the podium below instead.)
  const removedByExpiry =
    state !== null &&
    !state.teams.has(stored.id) &&
    state.game.status !== "ended" &&
    isGameExpired(state.game);

  if (status === "gone" || removedByExpiry) {
    // The final scoreboard survives the delete (I-FinalBoard): render it from
    // the hook's last-known snapshot. No snapshot (this device never saw the
    // live game — e.g. it navigated straight to an already-swept code) falls
    // back to the plain banner.
    if (finalBoard) {
      return (
        <FinalBoard
          board={finalBoard}
          gameCode={gameCode}
          expired={finalBoard.game.status !== "ended"}
        />
      );
    }
    return (
      <main className={styles.shell}>
        <div className={styles.statusEnded}>This game has ended or expired.</div>
      </main>
    );
  }

  // Once the host has ended the game, surface the same celebratory podium the
  // display + manager show. The BUZZ button is gone — there's nothing left to
  // do. Prefer the snapshot over live state: once the post-end sweep starts
  // cascade-deleting team rows, live state shrinks team by team while the
  // snapshot holds the full board.
  if (state?.game.status === "ended") {
    return <FinalBoard board={finalBoard ?? state} gameCode={gameCode} expired={false} />;
  }

  const game = state?.game;

  // Issue #179: with the public board capped at the top 5, give every player a
  // persistent read on where they stand. Rank is ordinal with the same
  // (score desc, earlier joined_at first) tiebreak the Display board uses, so a
  // player's "#N" matches their row on the board exactly. Shown from the moment
  // they join (the waiting screen included) and recomputed on every render, so
  // it updates live whenever any team's score changes. The total-teams count
  // was dropped as noise — just the place is shown (#271).
  const standings = ((): { rank: number; score: number } | null => {
    if (!state) return null;
    const me = state.teams.get(stored.id);
    if (!me) return null;
    const ranked = Array.from(state.teams.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.joined_at.localeCompare(b.joined_at);
    });
    return {
      rank: ranked.findIndex((t) => t.id === stored.id) + 1,
      score: me.score,
    };
  })();

  const lockedByMe = buzzer.lockedByMe;
  // Resolve the locking team from the hook's effective lock (provisional RPC
  // result OR the authoritative Realtime lock), so "SOMEONE ELSE BUZZED"
  // appears the instant buzz_in returns, not a fan-out later.
  const lockedTeamId = buzzer.lockedTeamId;
  const lockedTeam = lockedTeamId != null ? (state?.teams.get(lockedTeamId) ?? null) : null;

  // "reconnecting" deliberately does NOT disable the button (#254): buzz_in is
  // a PostgREST REST call, independent of the Realtime WebSocket, and an
  // outage keeps the channel in "reconnecting" the whole time (supabase-js
  // retries on a backoff that plateaus at 10s, with no cap). Hard-disabling
  // here turned every transient blip into a dead BUZZ button mid-round. Worst
  // case the local view is stale-unlocked and the press loses: buzz_in returns
  // the true winner and the button flips to "SOMEONE ELSE BUZZED" — the same
  // correction as losing a real race.
  const buzzDisabled =
    !state ||
    (status !== "subscribed" && status !== "reconnecting") ||
    game?.status !== "playing" ||
    buzzer.isLocked;

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

      {standings ? (
        <div className={styles.standingsOverlay} aria-label="Your standing" data-testid="standings">
          <span className={styles.standingRank} data-testid="standing-rank">
            #{standings.rank}
          </span>
          <span className={styles.standingScore} data-testid="standing-score">
            {standings.score} {Math.abs(standings.score) === 1 ? "pt" : "pts"}
          </span>
        </div>
      ) : null}

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
