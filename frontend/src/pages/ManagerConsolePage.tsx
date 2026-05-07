import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EndScreen } from "../components/EndScreen";
import { QRPanel } from "../components/QRPanel";
import { Scoreboard } from "../components/Scoreboard";
import { Skeleton } from "../components/Skeleton";
import { YouTubePlayer, type YouTubePlayerHandle } from "../components/YouTubePlayer";
import { useToast } from "../context/useToast";
import { useGameChannel } from "../hooks/useGameChannel";
import { usePlayerReady } from "../hooks/usePlayerReady";
import { serverTimeNow } from "../hooks/useServerTime";
import { ApiError, awardBonus, awardPoints, endGame, kickTeam, selectSong } from "../lib/api";
import { clearManagerToken, getManagerToken } from "../lib/managerToken";
import type { Song } from "../lib/types";
import styles from "./ManagerConsolePage.module.css";

const ROUND_DURATION_SEC = 20;

type PendingAction = { kind: "kick"; teamId: string; teamName: string } | { kind: "end" };

export function ManagerConsolePage() {
  const { gameCode = "" } = useParams<{ gameCode: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const managerToken = useMemo(() => getManagerToken(gameCode), [gameCode]);
  const { state, status } = useGameChannel(gameCode);
  const player = usePlayerReady();
  const playerRef = useRef<YouTubePlayerHandle | null>(null);

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [titleCorrect, setTitleCorrect] = useState(false);
  const [artistCorrect, setArtistCorrect] = useState(false);
  const [wrongBuzz, setWrongBuzz] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => serverTimeNow().getTime());
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [bonusOpen, setBonusOpen] = useState(false);

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

  function reportError(err: unknown) {
    if (err instanceof ApiError) {
      const reason =
        err.details && typeof err.details === "object" && err.details !== null
          ? (err.details as { reason?: unknown }).reason
          : undefined;
      if (err.status === 409 && reason === "no_more_songs") {
        toast(
          "All songs in your selected genres have been played. End the game or start a new one with more genres.",
          { variant: "error" },
        );
        return;
      }
    }
    toast(err instanceof Error ? err.message : "Request failed", { variant: "error" });
  }

  async function loadSongIntoPlayer(song: Song) {
    if (player.ready) {
      playerRef.current?.loadVideoById(song.youtube_id, song.start_time);
    } else {
      player.enqueueSong({ youtube_id: song.youtube_id, start_time: song.start_time });
    }
  }

  async function handleNextRound() {
    if (busy || !managerToken) return;
    setBusy(true);
    try {
      const result = await selectSong(gameCode, managerToken);
      setCurrentSong(result.song);
      resetAwardChecks();
      await loadSongIntoPlayer(result.song);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestartSong() {
    if (busy || !managerToken || !currentSong) return;
    setBusy(true);
    try {
      const result = await selectSong(gameCode, managerToken, currentSong.id);
      setCurrentSong(result.song);
      resetAwardChecks();
      await loadSongIntoPlayer(result.song);
      toast("Song restarted", { variant: "info" });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  function resetAwardChecks() {
    setTitleCorrect(false);
    setArtistCorrect(false);
    setWrongBuzz(false);
  }

  function toggleTitle() {
    setTitleCorrect((v) => {
      const next = !v;
      if (next) setWrongBuzz(false);
      return next;
    });
  }

  function toggleArtist() {
    setArtistCorrect((v) => {
      const next = !v;
      if (next) setWrongBuzz(false);
      return next;
    });
  }

  function toggleWrong() {
    setWrongBuzz((v) => {
      const next = !v;
      if (next) {
        setTitleCorrect(false);
        setArtistCorrect(false);
      }
      return next;
    });
  }

  async function handleEndRound(timeout: boolean) {
    if (!state?.currentRound || busy || !managerToken) return;
    setBusy(true);
    try {
      const result = await awardPoints(gameCode, managerToken, {
        round_id: state.currentRound.id,
        title_correct: timeout ? false : titleCorrect,
        artist_correct: timeout ? false : artistCorrect,
        wrong_buzz: timeout ? false : wrongBuzz,
        timeout,
      });
      resetAwardChecks();
      playerRef.current?.stop();
      if (timeout) {
        toast("Round skipped", { variant: "info" });
      } else if (result.points_awarded > 0) {
        toast(`+${result.points_awarded} pts awarded`, { variant: "success" });
      } else if (result.points_awarded < 0) {
        toast(`${result.points_awarded} pts (wrong buzz)`, { variant: "info" });
      } else {
        toast("No points awarded", { variant: "info" });
      }
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleBonus(teamId: string, teamName: string) {
    if (busy || !managerToken) return;
    setBusy(true);
    try {
      await awardBonus(gameCode, managerToken, { team_id: teamId });
      toast(`+4 bonus to ${teamName}`, { variant: "success" });
      setBonusOpen(false);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function performKick(teamId: string, teamName: string) {
    if (!managerToken) return;
    try {
      await kickTeam(gameCode, managerToken, teamId);
      toast(`${teamName} removed from the game`, { variant: "info" });
    } catch (err) {
      reportError(err);
    }
  }

  async function performEnd() {
    if (busy || !managerToken) return;
    setBusy(true);
    try {
      await endGame(gameCode, managerToken);
      playerRef.current?.stop();
      clearManagerToken(gameCode);
      toast("Game ended", { variant: "info" });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  function onPlayerReady() {
    player.setReady();
    const queued = player.flushPendingSong();
    if (queued) {
      playerRef.current?.loadVideoById(queued.youtube_id, queued.start_time);
    }
  }

  // Visiting /manager/game/<code> without having created the game (or after
  // having ended it / cleared storage) shouldn't surface the console UI.
  // The check sits ABOVE the gone/skeleton branches because it doesn't
  // depend on a Realtime payload; a non-host should bounce immediately.
  if (!managerToken) {
    return (
      <main className={styles.shell}>
        <p className="error">You're not the host of this game.</p>
        <p className="muted">
          Only the person who created game <strong>{gameCode}</strong> can manage it from this
          browser. If you meant to play, head home and join with the game code.
        </p>
        <p>
          <Link to="/" className="btn btn-ghost">
            Back to home
          </Link>
        </p>
      </main>
    );
  }

  // status="gone" must be checked before the skeleton: an active_games
  // DELETE flips the reducer to null state AND status to "gone" in the
  // same tick, and the user should see the explanation, not a skeleton.
  if (status === "gone" || (state && !state.game)) {
    return (
      <main className={styles.shell}>
        <p className="error">This game no longer exists.</p>
      </main>
    );
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

  const game = state.game;
  const teams = Array.from(state.teams.values());

  if (game.status === "ended") {
    return (
      <main className={styles.shell}>
        <EndScreen teams={teams} gameCode={gameCode} />
        <div className={styles.endActions}>
          <Link to="/" className="btn btn-primary">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  const lockedTeam = game.buzzed_team_id != null ? state.teams.get(game.buzzed_team_id) : null;

  const roundStartedAt = state.currentRound?.started_at;
  const elapsedSec = roundStartedAt
    ? Math.max(0, Math.floor((now - Date.parse(roundStartedAt)) / 1000))
    : 0;
  const remainingSec = roundStartedAt
    ? Math.max(0, ROUND_DURATION_SEC - elapsedSec)
    : ROUND_DURATION_SEC;
  const timerActive = game.status === "playing" && lockedTeam == null && state.currentRound != null;

  // TS narrows game.status to "playing" | "waiting" past the EndScreen early
  // return; the "ended" arm is unreachable here.
  const statusClass = game.status === "playing" ? styles.statusPlaying : styles.statusWaiting;

  const nextRoundDisabled = busy || !player.ready;
  const restartDisabled =
    busy || game.status !== "playing" || !currentSong || !player.ready || lockedTeam != null;
  const scoringDisabled = busy || !lockedTeam;
  const endRoundDisabled = busy || game.status !== "playing";
  const bonusDisabled = busy || teams.length === 0;
  const nextRoundLabel = game.status === "waiting" ? "Start game" : "Next round";

  return (
    <main className={`${styles.shell} ${styles.shellWithFooter}`}>
      <header className={styles.header}>
        <div className={styles.codeBlock}>
          <span className={styles.codeLabel}>Game code</span>
          <span className={styles.code}>{gameCode}</span>
        </div>
        <span className={`${styles.statusPill} ${statusClass}`}>{game.status}</span>
        <div className={styles.headerMeta}>
          <span className="muted">Round {game.round_number}</span>
        </div>
        <div className={styles.headerActions}>
          <button
            className="btn btn-danger"
            onClick={() => setPending({ kind: "end" })}
            disabled={busy}
            data-testid="end-game"
          >
            End game
          </button>
          <button className="btn btn-ghost" onClick={() => navigate("/")}>
            Home
          </button>
        </div>
      </header>

      <div className={styles.grid}>
        <div className={styles.column}>
          <YouTubePlayer ref={playerRef} hideOverlay onReady={onPlayerReady} />

          <section className={styles.card}>
            <div className={styles.roundHeader}>
              <div className={styles.roundHeaderInfo}>
                <span className={styles.cardTitle}>Round controls</span>
                {currentSong ? (
                  <>
                    <p className={styles.songLine}>{currentSong.title}</p>
                    <p className={styles.songMeta}>
                      {currentSong.artist}
                      {currentSong.source ? ` - ${currentSong.source}` : ""}
                    </p>
                  </>
                ) : (
                  <p className={styles.songMeta}>No round started yet.</p>
                )}
              </div>
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
                </div>
              ) : null}
            </div>

            {lockedTeam ? (
              <div className={styles.lockedBanner} role="status" aria-live="polite">
                <span className={styles.lockedTeam}>{lockedTeam.name}</span> buzzed in. Score the
                answer:
              </div>
            ) : null}

            <div className={styles.scoreRow} aria-disabled={scoringDisabled}>
              <button
                type="button"
                className={`${styles.scoreBtn} ${styles.scorePositive} ${titleCorrect ? styles.scoreActive : ""}`}
                onClick={toggleTitle}
                disabled={scoringDisabled}
                aria-pressed={titleCorrect}
                data-testid="score-title"
              >
                <span className={styles.scoreLabel}>Correct Song</span>
                <span className={styles.scorePoints}>+10</span>
              </button>
              <button
                type="button"
                className={`${styles.scoreBtn} ${styles.scorePositive} ${artistCorrect ? styles.scoreActive : ""}`}
                onClick={toggleArtist}
                disabled={scoringDisabled}
                aria-pressed={artistCorrect}
                data-testid="score-artist"
              >
                <span className={styles.scoreLabel}>Correct Artist</span>
                <span className={styles.scorePoints}>+5</span>
              </button>
              <button
                type="button"
                className={`${styles.scoreBtn} ${styles.scoreNegative} ${wrongBuzz ? styles.scoreActiveNeg : ""}`}
                onClick={toggleWrong}
                disabled={scoringDisabled}
                aria-pressed={wrongBuzz}
                data-testid="score-wrong"
              >
                <span className={styles.scoreLabel}>Wrong</span>
                <span className={styles.scorePoints}>-3</span>
              </button>
              <button
                type="button"
                className={`${styles.scoreBtn} ${styles.scoreBonus} ${bonusOpen ? styles.scoreActiveBonus : ""}`}
                onClick={() => setBonusOpen((o) => !o)}
                disabled={bonusDisabled}
                aria-expanded={bonusOpen}
                aria-controls="bonus-team-picker"
                data-testid="score-bonus"
              >
                <span className={styles.scoreLabel}>Bonus</span>
                <span className={styles.scorePoints}>+4</span>
              </button>
            </div>

            {bonusOpen ? (
              <div
                id="bonus-team-picker"
                className={styles.bonusPicker}
                role="group"
                aria-label="Pick a team for the bonus"
              >
                <span className={styles.bonusPickerHint}>Award +4 to:</span>
                <div className={styles.bonusPickerList}>
                  {teams.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void handleBonus(t.id, t.name)}
                      disabled={busy}
                      data-testid={`bonus-team-${t.id}`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.actionsInline}>
              <button
                className="btn btn-ghost"
                onClick={() => void handleRestartSong()}
                disabled={restartDisabled}
                data-testid="restart-song"
              >
                Restart song
              </button>
              <button
                className={`btn btn-primary ${styles.awardBtn}`}
                onClick={() => void handleEndRound(!lockedTeam)}
                disabled={endRoundDisabled}
                data-testid="end-round"
              >
                End round
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void handleNextRound()}
                disabled={nextRoundDisabled}
                data-testid="start-round"
              >
                {nextRoundLabel}
              </button>
            </div>
          </section>
        </div>

        <div className={styles.column}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Invite players</h2>
            <QRPanel gameCode={gameCode} joinUrl={`${window.location.origin}/join/${gameCode}`} />
          </section>

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
                  Share <span className={styles.emptyTeamsCode}>{gameCode}</span> with players -
                  they'll appear here once they join.
                </p>
              </div>
            ) : (
              <div>
                {teams.map((t) => (
                  <div key={t.id} className={styles.teamRow} data-team-id={t.id}>
                    <span className={styles.teamRowName}>{t.name}</span>
                    <span className={styles.teamRowMeta}>
                      <span>{t.score} pts</span>
                      <button
                        className="btn btn-danger"
                        onClick={() => setPending({ kind: "kick", teamId: t.id, teamName: t.name })}
                        disabled={busy}
                        data-testid="kick-team"
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

      <div className={styles.mobileBar} role="toolbar" aria-label="Round actions">
        <button
          className="btn btn-ghost"
          onClick={() => void handleRestartSong()}
          disabled={restartDisabled}
          data-testid="restart-song-mobile"
        >
          Restart
        </button>
        <button
          className={`btn btn-primary ${styles.awardBtn}`}
          onClick={() => void handleEndRound(!lockedTeam)}
          disabled={endRoundDisabled}
          data-testid="end-round-mobile"
        >
          End round
        </button>
        <button
          className="btn btn-primary"
          onClick={() => void handleNextRound()}
          disabled={nextRoundDisabled}
          data-testid="start-round-mobile"
        >
          {game.status === "waiting" ? "Start" : "Next"}
        </button>
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
    </main>
  );
}
