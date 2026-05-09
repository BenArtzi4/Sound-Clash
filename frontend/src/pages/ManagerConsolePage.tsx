import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EndScreen } from "../components/EndScreen";
import { Scoreboard } from "../components/Scoreboard";
import { Skeleton } from "../components/Skeleton";
import { YouTubePlayer, type YouTubePlayerHandle } from "../components/YouTubePlayer";
import { useToast } from "../context/useToast";
import { useGameChannel } from "../hooks/useGameChannel";
import { usePlayerReady } from "../hooks/usePlayerReady";
import { ApiError, awardBonus, awardPoints, endGame, selectSong } from "../lib/api";
import { clearManagerToken, getManagerToken } from "../lib/managerToken";
import { supabase } from "../lib/supabase";
import type { Song } from "../lib/types";
import styles from "./ManagerConsolePage.module.css";

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
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);

  // When we get the buzz lock signal, pause playback.
  useEffect(() => {
    if (state?.game.buzzed_team_id != null) {
      playerRef.current?.pause();
    }
  }, [state?.game.buzzed_team_id]);

  // After a manager-tab refresh mid-round, currentSong is null but the round
  // row still has a song_id. Resolve it and push it into the player so the
  // host doesn't have to abandon the round and click Next round.
  const currentRoundSongId = state?.currentRound?.song_id ?? null;
  const playerReady = player.ready;
  useEffect(() => {
    if (!currentRoundSongId) return;
    if (currentSong && currentSong.id === currentRoundSongId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("songs")
        .select("id,title,artist,youtube_id,start_time,is_soundtrack,source")
        .eq("id", currentRoundSongId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const song = data as Song;
      setCurrentSong(song);
      if (playerReady) {
        playerRef.current?.loadVideoById(song.youtube_id, song.start_time);
      } else {
        player.enqueueSong({ youtube_id: song.youtube_id, start_time: song.start_time });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `player` is a stable hook handle; we only need to re-run when the
    // current round's song changes or the player flips to ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoundSongId, currentSong?.id, playerReady]);

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
            onClick={() => setEndConfirmOpen(true)}
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
        open={endConfirmOpen}
        title="End the game now?"
        message="No more rounds can be played and teams will see the final scoreboard."
        confirmLabel="End game"
        destructive
        onConfirm={() => {
          setEndConfirmOpen(false);
          void performEnd();
        }}
        onCancel={() => setEndConfirmOpen(false)}
      />
    </main>
  );
}
