import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EndScreen } from "../components/EndScreen";
import { Skeleton } from "../components/Skeleton";
import { YouTubePlayer, type YouTubePlayerHandle } from "../components/YouTubePlayer";
import { useToast } from "../context/useToast";
import { useGameChannel } from "../hooks/useGameChannel";
import { usePlayerReady } from "../hooks/usePlayerReady";
import { ApiError, awardBonus, endGame, endRound, selectSong } from "../lib/api";
import { awardAttemptDirect, releaseBuzzLockDirect, RpcError } from "../hooks/useManagerActions";
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
  // host doesn't have to abandon the round and click Next round. Must stay
  // loadVideoById (not cueVideoById): on the happy path the Realtime INSERT
  // for the new round arrives before selectSong's HTTP response, so this
  // effect races with handleNextRound's loadVideoById. Calling cue while load
  // is in flight (or vice-versa) puts YT.Player into an inconsistent state and
  // surfaces as the "Video unavailable" onError overlay.
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
    if (err instanceof RpcError) {
      // PL/pgSQL RAISE EXCEPTION '<code>' lands as message = '<code>'.
      // 'no_buzz_to_score' / 'title_already_claimed' just mean the click was
      // a no-op (Realtime already cleared the lock or claimed the token);
      // don't spook the host with an error toast.
      if (
        err.message === "no_buzz_to_score" ||
        err.message === "title_already_claimed" ||
        err.message === "artist_already_claimed"
      ) {
        return;
      }
      toast(err.message, { variant: "error" });
      return;
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

  // Apply an attempt via the direct browser -> Supabase RPC. Migration 021
  // moved the manager-token gate into the PL/pgSQL function, so we bypass
  // FastAPI/Render here and cut ~300ms of cross-continent hops off the
  // critical path. The score commit and the Realtime fan-out happen in the
  // same DB transaction; the UI then redraws when game_teams / game_rounds
  // UPDATE events arrive.
  async function applyAttempt(
    roundId: string,
    flags: { title_correct: boolean; artist_correct: boolean; wrong_buzz: boolean },
  ): Promise<void> {
    if (!managerToken) return;
    await awardAttemptDirect(gameCode, managerToken, roundId, flags);
  }

  // Helper for the optimistic toast on the three scoring buttons. Fired
  // before the RPC so the click feels instant; the Realtime UPDATE on
  // game_teams.score is still the source of truth for the displayed score.
  function buzzedTeamName(): string | null {
    if (!state) return null;
    const tid = state.game.buzzed_team_id;
    if (!tid) return null;
    return state.teams.get(tid)?.name ?? null;
  }

  async function handleCorrectTitle() {
    if (!state?.currentRound || busy || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+10 to ${teamName}`, { variant: "success" });
    setBusy(true);
    try {
      await applyAttempt(state.currentRound.id, {
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
      });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleCorrectArtist() {
    if (!state?.currentRound || busy || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+5 to ${teamName}`, { variant: "success" });
    setBusy(true);
    try {
      await applyAttempt(state.currentRound.id, {
        title_correct: false,
        artist_correct: true,
        wrong_buzz: false,
      });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleContinueRound() {
    if (busy || !managerToken) return;
    setBusy(true);
    try {
      await releaseBuzzLockDirect(gameCode, managerToken);
      playerRef.current?.play();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  // Wrong is a one-click verdict: it fires award_attempt with wrong_buzz=true,
  // re-arms the buzzers, and resumes the song (no separate "Continue round"
  // press needed). Per game-rules.md §4, if a correct answer was already
  // scored this round, the SQL function waives the -3 penalty; we skip the
  // toast in that case so we don't lie about the delta. Playback resume is
  // held until the RPC commits so a failed Wrong leaves the song paused with
  // the lock still held -- the manager can simply retry.
  async function handleWrong() {
    if (!state?.currentRound || busy || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    const teamName = buzzedTeamName();
    const freeGuess =
      state.currentRound.title_claimed_by != null || state.currentRound.artist_claimed_by != null;
    if (teamName && !freeGuess) toast(`-3 to ${teamName}`, { variant: "info" });
    setBusy(true);
    try {
      await applyAttempt(state.currentRound.id, {
        title_correct: false,
        artist_correct: false,
        wrong_buzz: true,
      });
      playerRef.current?.play();
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
      await loadSongIntoPlayer(result.song);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleBonus(teamId: string, teamName: string) {
    if (!managerToken) return;
    // Close the picker and toast immediately so the manager's UI feels
    // instant. The team's new score arrives via Realtime once the backend
    // commits; we don't gate the picker or other action buttons on the
    // round-trip. If the API rejects (rare), surface an error toast then.
    setBonusOpen(false);
    toast(`+4 bonus to ${teamName}`, { variant: "success" });
    try {
      await awardBonus(gameCode, managerToken, { team_id: teamId });
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

  const statusClass = game.status === "playing" ? styles.statusPlaying : styles.statusWaiting;

  const titleActionDisabled = busy || !lockedTeam || titleClaimedById != null;
  const artistActionDisabled = busy || !lockedTeam || artistClaimedById != null;
  const wrongActionDisabled = busy || !lockedTeam;
  const continueDisabled = busy || !lockedTeam;
  const nextRoundDisabled = busy || !player.ready;
  // Bonus is independent of buzz state — it stays actionable as long as the
  // page isn't mid-request. (It must NOT be wrapped in an aria-disabled
  // group, or screen readers + Playwright's toBeEnabled() treat it as
  // disabled whenever no team has buzzed.)
  const bonusDisabled = busy;
  const nextRoundLabel = game.status === "waiting" ? "Start game" : "Next round";

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.codeBlock}>
          <span className={styles.codeLabel}>Game code</span>
          <span className={styles.code}>{gameCode}</span>
        </div>
        <span className={`${styles.statusPill} ${statusClass}`}>{game.status}</span>
        <div className={styles.headerMeta}>
          <span className="muted">Round {game.round_number}</span>
        </div>
      </header>

      <div className={styles.column}>
        <YouTubePlayer
          ref={playerRef}
          noCover
          onReady={onPlayerReady}
          onError={() =>
            toast("Video unavailable — click Next round to pick a different song.", {
              variant: "error",
            })
          }
        />

        <section className={styles.card}>
          {currentSong ? (
            <div className={styles.songBlock}>
              <p className={styles.songLine}>{currentSong.title}</p>
              <p className={styles.songMeta}>
                {currentSong.artist}
                {currentSong.source ? ` - ${currentSong.source}` : ""}
              </p>
            </div>
          ) : (
            <p className={styles.songMeta}>No round started yet.</p>
          )}

          {round && game.status === "playing" ? (
            <div className={styles.tokenChips} aria-label="Round token state">
              <span
                className={`${styles.tokenChip} ${titleClaimedById ? styles.tokenChipClaimed : ""}`}
                data-testid="token-chip-title"
              >
                Song {titleClaimedById ? "✓" : "open"}
              </span>
              <span
                className={`${styles.tokenChip} ${
                  artistClaimedById ? styles.tokenChipClaimed : ""
                }`}
                data-testid="token-chip-artist"
              >
                Artist {artistClaimedById ? "✓" : "open"}
              </span>
            </div>
          ) : null}

          {lockedTeam ? (
            <div className={styles.lockedBanner} role="status" aria-live="polite">
              <span className={styles.lockedTeam}>{lockedTeam.name}</span> buzzed in. Score the
              answer:
            </div>
          ) : null}

          <div className={styles.scoreRow}>
            <button
              type="button"
              className={`${styles.scoreBtn} ${styles.scorePositive}`}
              onClick={() => void handleCorrectTitle()}
              disabled={titleActionDisabled}
              data-testid="score-title"
            >
              <span className={styles.scoreLabel}>Correct Song</span>
              <span className={styles.scorePoints}>+10</span>
            </button>
            <button
              type="button"
              className={`${styles.scoreBtn} ${styles.scorePositive}`}
              onClick={() => void handleCorrectArtist()}
              disabled={artistActionDisabled}
              data-testid="score-artist"
            >
              <span className={styles.scoreLabel}>Correct Artist</span>
              <span className={styles.scorePoints}>+5</span>
            </button>
            <button
              type="button"
              className={`${styles.scoreBtn} ${styles.scoreNegative} ${styles.wrongBtn}`}
              onClick={() => void handleWrong()}
              disabled={wrongActionDisabled}
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

      <footer className={styles.endGameFooter}>
        <button
          className="btn btn-danger"
          onClick={() => setEndConfirmOpen(true)}
          disabled={busy}
          data-testid="end-game"
        >
          End game
        </button>
      </footer>

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
