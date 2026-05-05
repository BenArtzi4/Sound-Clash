import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Scoreboard } from "../components/Scoreboard";
import { Skeleton } from "../components/Skeleton";
import { YouTubePlayer, type YouTubePlayerHandle } from "../components/YouTubePlayer";
import { useAuth } from "../context/useAuth";
import { useToast } from "../context/useToast";
import { useGameChannel } from "../hooks/useGameChannel";
import { usePlayerReady } from "../hooks/usePlayerReady";
import { serverTimeNow } from "../hooks/useServerTime";
import { ApiError, awardPoints, endGame, kickTeam, selectSong } from "../lib/api";
import type { Song } from "../lib/types";
import styles from "./ManagerConsolePage.module.css";

const ROUND_DURATION_SEC = 20;

type PendingAction =
  | { kind: "kick"; teamId: string; teamName: string }
  | { kind: "end" }
  | { kind: "signout" };

export function ManagerConsolePage() {
  const { gameCode = "" } = useParams<{ gameCode: string }>();
  const { logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { state, status } = useGameChannel(gameCode);
  const player = usePlayerReady();
  const playerRef = useRef<YouTubePlayerHandle | null>(null);

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [titleCorrect, setTitleCorrect] = useState(false);
  const [artistCorrect, setArtistCorrect] = useState(false);
  const [sourceCorrect, setSourceCorrect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => serverTimeNow().getTime());
  const [pending, setPending] = useState<PendingAction | null>(null);

  // Tick once a second so the timer re-renders.
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverTimeNow().getTime()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // When we get the buzz lock signal, pause playback.
  useEffect(() => {
    if (state?.game.buzzed_team_id != null) {
      playerRef.current?.pause();
    }
  }, [state?.game.buzzed_team_id]);

  // 401 from any admin call → kick to login.
  function handleAdminError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      logout();
      navigate("/manager/login", { replace: true });
      return true;
    }
    toast(err instanceof Error ? err.message : "Request failed", { variant: "error" });
    return false;
  }

  async function handleNextRound() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await selectSong(gameCode);
      setCurrentSong(result.song);
      resetAwardChecks();
      if (player.ready) {
        playerRef.current?.loadVideoById(result.song.youtube_id, result.song.start_time);
      } else {
        player.enqueueSong({
          youtube_id: result.song.youtube_id,
          start_time: result.song.start_time,
        });
      }
    } catch (err) {
      handleAdminError(err);
    } finally {
      setBusy(false);
    }
  }

  function resetAwardChecks() {
    setTitleCorrect(false);
    setArtistCorrect(false);
    setSourceCorrect(false);
  }

  async function handleAward(timeout: boolean) {
    if (!state?.currentRound || busy) return;
    setBusy(true);
    try {
      const result = await awardPoints(gameCode, {
        round_id: state.currentRound.id,
        title_correct: timeout ? false : titleCorrect,
        artist_correct: timeout ? false : artistCorrect,
        source_correct: timeout ? false : sourceCorrect,
        timeout,
      });
      resetAwardChecks();
      playerRef.current?.stop();
      if (timeout) {
        toast("Round skipped", { variant: "info" });
      } else if (result.points_awarded > 0) {
        toast(`+${result.points_awarded} pts awarded`, { variant: "success" });
      } else {
        toast("No points awarded", { variant: "info" });
      }
    } catch (err) {
      handleAdminError(err);
    } finally {
      setBusy(false);
    }
  }

  async function performKick(teamId: string, teamName: string) {
    try {
      await kickTeam(gameCode, teamId);
      toast(`${teamName} removed from the game`, { variant: "info" });
    } catch (err) {
      handleAdminError(err);
    }
  }

  async function performEnd() {
    if (busy) return;
    setBusy(true);
    try {
      await endGame(gameCode);
      playerRef.current?.stop();
      toast("Game ended", { variant: "info" });
    } catch (err) {
      handleAdminError(err);
    } finally {
      setBusy(false);
    }
  }

  function performSignout() {
    logout();
    navigate("/manager/login");
  }

  function onPlayerReady() {
    player.setReady();
    const queued = player.flushPendingSong();
    if (queued) {
      playerRef.current?.loadVideoById(queued.youtube_id, queued.start_time);
    }
  }

  if (!state || status === "connecting") {
    return (
      <main className={styles.shell} aria-busy="true">
        <p className="muted">Connecting to game…</p>
        <div className={styles.skeletonStack}>
          <Skeleton height={72} />
          <Skeleton height={260} />
          <Skeleton height={180} />
        </div>
      </main>
    );
  }

  if (status === "gone" || !state.game) {
    return (
      <main className={styles.shell}>
        <p className="error">This game no longer exists.</p>
      </main>
    );
  }

  const game = state.game;
  const teams = Array.from(state.teams.values());
  const lockedTeam = game.buzzed_team_id != null ? state.teams.get(game.buzzed_team_id) : null;

  const roundStartedAt = state.currentRound?.started_at;
  const elapsedSec = roundStartedAt
    ? Math.max(0, Math.floor((now - Date.parse(roundStartedAt)) / 1000))
    : 0;
  const remainingSec = roundStartedAt
    ? Math.max(0, ROUND_DURATION_SEC - elapsedSec)
    : ROUND_DURATION_SEC;
  const timerActive = game.status === "playing" && lockedTeam == null && state.currentRound != null;

  const statusClass =
    game.status === "playing"
      ? styles.statusPlaying
      : game.status === "ended"
        ? styles.statusEnded
        : styles.statusWaiting;

  const connectionLabel = status === "subscribed" ? "Connected" : "Connecting…";
  const connectionStateClass = status === "subscribed" ? styles.connOk : styles.connWait;

  const onSignOutClick = () => {
    if (game.status === "playing") {
      setPending({ kind: "signout" });
    } else {
      performSignout();
    }
  };

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.codeBlock}>
          <span className={styles.codeLabel}>Game code</span>
          <span className={styles.code}>{gameCode}</span>
        </div>
        <span className={`${styles.statusPill} ${statusClass}`}>{game.status}</span>
        <div className={styles.headerMeta}>
          <span className="muted">
            Round {game.round_number} of {game.total_rounds}
          </span>
          <span
            className={`${styles.connection} ${connectionStateClass}`}
            role="status"
            aria-live="polite"
          >
            <span className={styles.connectionDot} aria-hidden="true" />
            <span>{connectionLabel}</span>
          </span>
        </div>
        <button className="btn btn-ghost" onClick={onSignOutClick}>
          Sign out
        </button>
      </header>

      <div className={styles.grid}>
        <div className={styles.column}>
          <YouTubePlayer ref={playerRef} hideOverlay onReady={onPlayerReady} />

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Round controls</h2>
            <div className="stack">
              {currentSong ? (
                <div>
                  <p className={styles.songLine}>{currentSong.title}</p>
                  <p className={styles.songMeta}>
                    {currentSong.artist}
                    {currentSong.source ? ` — ${currentSong.source}` : ""}
                  </p>
                </div>
              ) : (
                <p className="muted">No round started yet.</p>
              )}

              {timerActive ? (
                <div
                  className={`${styles.timerWrap} ${remainingSec <= 5 ? styles.timerLow : ""}`}
                  style={
                    {
                      "--timer-pct": `${Math.max(0, Math.min(100, (remainingSec / ROUND_DURATION_SEC) * 100))}%`,
                    } as CSSProperties
                  }
                >
                  <div className={styles.timerRing}>
                    <span className={styles.timerValue}>{remainingSec}</span>
                  </div>
                  <span className={styles.timerLabel}>seconds remaining</span>
                </div>
              ) : null}

              {lockedTeam ? (
                <div className={styles.lockedBanner}>{lockedTeam.name} buzzed in.</div>
              ) : null}

              <div className={styles.checkRow}>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={titleCorrect}
                    disabled={!lockedTeam}
                    onChange={(e) => setTitleCorrect(e.target.checked)}
                  />
                  Title
                </label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={artistCorrect}
                    disabled={!lockedTeam}
                    onChange={(e) => setArtistCorrect(e.target.checked)}
                  />
                  Artist
                </label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={sourceCorrect}
                    disabled={!lockedTeam || !currentSong?.is_soundtrack}
                    onChange={(e) => setSourceCorrect(e.target.checked)}
                  />
                  Source
                </label>
              </div>

              <div className={styles.actions}>
                <button
                  className="btn btn-ghost"
                  onClick={() => void handleAward(true)}
                  disabled={busy || game.status !== "playing"}
                >
                  Timeout / skip
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void handleAward(false)}
                  disabled={busy || !lockedTeam}
                >
                  Award points
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void handleNextRound()}
                  disabled={
                    busy ||
                    game.status === "ended" ||
                    !player.ready ||
                    (game.status === "playing" && game.round_number >= game.total_rounds)
                  }
                >
                  {game.status === "waiting" ? "Start game" : "Next round"}
                </button>
              </div>

              <div className={styles.actions}>
                <button
                  className="btn btn-danger"
                  onClick={() => setPending({ kind: "end" })}
                  disabled={busy || game.status === "ended"}
                >
                  End game
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className={styles.column}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Scoreboard</h2>
            <Scoreboard teams={teams} buzzedTeamId={game.buzzed_team_id} />
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Teams</h2>
            {teams.length === 0 ? (
              <div className={styles.emptyTeams}>
                <p className={styles.emptyTeamsTitle}>No teams have joined yet.</p>
                <p className={styles.emptyTeamsHint}>
                  Share <span className={styles.emptyTeamsCode}>{gameCode}</span> with players — they'll appear here once they join.
                </p>
              </div>
            ) : (
              <div>
                {teams.map((t) => (
                  <div key={t.id} className={styles.teamRow}>
                    <span className={styles.teamRowName}>{t.name}</span>
                    <span className={styles.teamRowMeta}>
                      <span>{t.score} pts</span>
                      <button
                        className="btn btn-danger"
                        onClick={() =>
                          setPending({ kind: "kick", teamId: t.id, teamName: t.name })
                        }
                        disabled={busy}
                      >
                        Kick
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={pending?.kind === "kick"}
        title={pending?.kind === "kick" ? `Remove ${pending.teamName}?` : ""}
        message="They'll be disconnected from the game and their score will be lost."
        confirmLabel="Remove team"
        destructive
        onConfirm={() => {
          if (pending?.kind === "kick") {
            const { teamId, teamName } = pending;
            setPending(null);
            void performKick(teamId, teamName);
          }
        }}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === "end"}
        title="End the game now?"
        message="No more rounds can be played and teams will see the final scoreboard."
        confirmLabel="End game"
        destructive
        onConfirm={() => {
          setPending(null);
          void performEnd();
        }}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === "signout"}
        title="Sign out mid-game?"
        message="The game will keep running, but you'll need the host password again to come back."
        confirmLabel="Sign out"
        destructive
        onConfirm={() => {
          setPending(null);
          performSignout();
        }}
        onCancel={() => setPending(null)}
      />
    </main>
  );
}
