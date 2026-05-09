import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EndScreen } from "../components/EndScreen";
import { Skeleton } from "../components/Skeleton";
import { YouTubePlayer, type YouTubePlayerHandle } from "../components/YouTubePlayer";
import { useToast } from "../context/useToast";
import { useGameChannel } from "../hooks/useGameChannel";
import { usePlayerReady } from "../hooks/usePlayerReady";
import { ApiError, awardAttempt, awardBonus, endGame, endRound, selectSong } from "../lib/api";
import { clearManagerToken, getManagerToken } from "../lib/managerToken";
import { supabase } from "../lib/supabase";
import type { Song } from "../lib/types";
import styles from "./ManagerConsolePage.module.css";

export function ManagerConsolePage() {
  const { gameCode = "" } = useParams<{ gameCode: string }>();
  const { toast } = useToast();
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

  async function applyAttempt(roundId: string): Promise<boolean> {
    if (!managerToken) return false;
    const result = await awardAttempt(gameCode, managerToken, {
      round_id: roundId,
      title_correct: titleCorrect,
      artist_correct: artistCorrect,
      wrong_buzz: wrongBuzz,
    });
    if (result.points_awarded > 0) {
      toast(`+${result.points_awarded} pts awarded`, { variant: "success" });
    } else if (result.points_awarded < 0) {
      toast(`${result.points_awarded} pts (wrong buzz)`, { variant: "info" });
    }
    return true;
  }

  async function handleContinueRound() {
    if (!state?.currentRound || busy || !managerToken) return;
    const lockedTeamId = state.game.buzzed_team_id;
    if (!lockedTeamId) return;
    if (!titleCorrect && !artistCorrect && !wrongBuzz) {
      toast("Pick a result first (Correct Song, Correct Artist, or Wrong)", {
        variant: "info",
      });
      return;
    }
    setBusy(true);
    try {
      await applyAttempt(state.currentRound.id);
      resetAwardChecks();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleNextRound() {
    if (busy || !managerToken) return;
    setBusy(true);
    try {
      const round = state?.currentRound;
      const lockedTeamId = state?.game.buzzed_team_id ?? null;
      // If a buzz is held with a verdict toggled, score it before advancing.
      if (round && lockedTeamId && (titleCorrect || artistCorrect || wrongBuzz)) {
        try {
          await applyAttempt(round.id);
        } catch (err) {
          reportError(err);
          return;
        }
      }
      // Close the prior round (idempotent; safe even if start_round will close it).
      if (round && state?.game.status === "playing") {
        try {
          await endRound(gameCode, managerToken, round.id);
        } catch (err) {
          // round_already_ended is fine; surface anything else.
          if (!(err instanceof ApiError && err.status === 409)) {
            reportError(err);
            return;
          }
        }
      }
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
  const round = state.currentRound;
  const titleClaimedById = round?.title_claimed_by ?? null;
  const artistClaimedById = round?.artist_claimed_by ?? null;
  const titleClaimedByName = titleClaimedById ? state.teams.get(titleClaimedById)?.name : null;
  const artistClaimedByName = artistClaimedById ? state.teams.get(artistClaimedById)?.name : null;
  const bothClaimed = titleClaimedById != null && artistClaimedById != null;

  const statusClass = game.status === "playing" ? styles.statusPlaying : styles.statusWaiting;

  const titleToggleDisabled = busy || !lockedTeam || titleClaimedById != null;
  const artistToggleDisabled = busy || !lockedTeam || artistClaimedById != null;
  const wrongToggleDisabled = busy || !lockedTeam;
  const scoringDisabled = busy || !lockedTeam;
  const continueDisabled =
    busy ||
    !lockedTeam ||
    bothClaimed ||
    !(titleCorrect || artistCorrect || wrongBuzz);
  const nextRoundDisabled = busy || !player.ready;
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
        </div>
      </header>

      <div className={styles.column}>
        <YouTubePlayer
          ref={playerRef}
          hideOverlay
          coverWhilePaused={lockedTeam != null}
          onReady={onPlayerReady}
        />

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
            {round && game.status === "playing" ? (
              <div className={styles.tokenChips} aria-label="Round token state">
                <span
                  className={`${styles.tokenChip} ${
                    titleClaimedById ? styles.tokenChipClaimed : ""
                  }`}
                  data-testid="token-chip-title"
                >
                  Song {titleClaimedById ? `✓ ${titleClaimedByName ?? "?"}` : "open"}
                </span>
                <span
                  className={`${styles.tokenChip} ${
                    artistClaimedById ? styles.tokenChipClaimed : ""
                  }`}
                  data-testid="token-chip-artist"
                >
                  Artist {artistClaimedById ? `✓ ${artistClaimedByName ?? "?"}` : "open"}
                </span>
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
              disabled={titleToggleDisabled}
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
              disabled={artistToggleDisabled}
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
              disabled={wrongToggleDisabled}
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
              className={`btn ${styles.continueBtn}`}
              onClick={() => void handleContinueRound()}
              disabled={continueDisabled}
              data-testid="continue-round"
            >
              Continue round
            </button>
            <button
              className={`btn btn-primary ${styles.awardBtn}`}
              onClick={() => void handleNextRound()}
              disabled={nextRoundDisabled}
              data-testid="start-round"
            >
              {nextRoundLabel}
            </button>
          </div>
        </section>
      </div>

      <div className={styles.mobileBar} role="toolbar" aria-label="Round actions">
        <button
          className={`btn ${styles.continueBtn}`}
          onClick={() => void handleContinueRound()}
          disabled={continueDisabled}
          data-testid="continue-round-mobile"
        >
          Continue
        </button>
        <button
          className={`btn btn-primary ${styles.awardBtn}`}
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
