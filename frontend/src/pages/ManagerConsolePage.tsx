import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EndScreen } from "../components/EndScreen";
import { ExpiryCountdown } from "../components/ExpiryCountdown";
import { HostRecoveryLink } from "../components/HostRecoveryLink";
import { Skeleton } from "../components/Skeleton";
import { SongExport } from "../components/SongExport";
import { SoundtrackBadge } from "../components/SoundtrackBadge";
import { YouTubePlayer } from "../components/YouTubePlayer";
import { useGameChannel } from "../hooks/useGameChannel";
import { useKeepBackendWarm } from "../hooks/useKeepBackendWarm";
import { useManagerToken } from "../hooks/useManagerToken";
import { usePlayerReady } from "../hooks/usePlayerReady";
import { useResumeOnVisible } from "../hooks/useResumeOnVisible";
import { useScoring } from "../hooks/useScoring";
import { useSongPrebuffer } from "../hooks/useSongPrebuffer";
import { parseRecoveryHash } from "../lib/managerToken";
import {
  ARTIST_POINTS,
  BONUS_POINTS,
  SOUNDTRACK_POINTS,
  TITLE_POINTS,
  WRONG_BUZZ_PENALTY,
} from "../lib/scoring";
import styles from "./ManagerConsolePage.module.css";

export function ManagerConsolePage() {
  const { gameCode = "" } = useParams<{ gameCode: string }>();
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  // Adopt a backup-host-link token (T4.10) — see useManagerToken for the full
  // resolution order (stored wins, else adopt a well-formed #mt= fragment, else
  // the in-mount ref). Isolated into its own hook so the intentional in-render
  // ref access stays contained there rather than tainting this render.
  const managerToken = useManagerToken(gameCode, hash);

  // Scrub the adopted token out of the address bar and this history entry so
  // it doesn't linger in screenshots or a shared device's history. replace
  // keeps Back working (no extra entry for the tokened URL).
  useEffect(() => {
    if (parseRecoveryHash(hash)) {
      navigate(pathname + search, { replace: true });
    }
  }, [hash, pathname, search, navigate]);
  const { state, status, finalBoard } = useGameChannel(gameCode);
  const player = usePlayerReady();

  // Keep the Render-hosted API warm while a game is running so the host's
  // occasional REST calls (Bonus / End game / Kick) and late team joins don't
  // hit a mid-game cold start. See useKeepBackendWarm for the why.
  useKeepBackendWarm(state?.game?.status === "playing" || state?.game?.status === "waiting");

  // The double-buffer player machinery (peek + prebuffer + swap + song-start
  // telemetry) and the scoring/round actions (award_attempt / release_buzz_lock
  // / select_next_song / bonus / end / extend) live in two hooks; the page is
  // layout + wiring. handleNextRound composes the prebuffer surface, so scoring
  // takes prebuffer as an argument.
  const prebuffer = useSongPrebuffer(gameCode, managerToken, state, player);
  const {
    playerARef,
    playerBRef,
    activeKey,
    onPlayerReady,
    onPlayerBReady,
    handlePlayerPlaying,
    handlePlayerError,
    activePlayer,
  } = prebuffer;
  const scoring = useScoring(gameCode, managerToken, state, player, prebuffer);
  const {
    currentSong,
    busy,
    endConfirmOpen,
    setEndConfirmOpen,
    bonusOpen,
    setBonusOpen,
    pendingTitle,
    pendingArtist,
    pendingWrong,
    pendingContinue,
    pendingExtendFor,
    handleCorrectTitle,
    handleCorrectArtist,
    handleCorrectSoundtrack,
    handleContinueRound,
    handleWrong,
    handleNextRound,
    handleExtendGame,
    handleBonus,
    performEnd,
  } = scoring;

  // When we get the buzz lock signal, pause playback on the live player.
  // (Handled inside useScoring so the pause fires alongside the pending-flag
  // resets that key off the same buzzed_team_id transition.)

  // Recover a song the browser paused when the host backgrounded the tab / locked
  // their phone: when the tab becomes visible again, resume the live player — but
  // only while a song should actually be audible (game in progress, no buzz
  // holding the scoring pause). resumeIfPaused is itself a no-op unless the
  // player is genuinely paused, so an ended/idle player is never nudged and a
  // finished clip is never replayed. Best-effort on strict mobile autoplay.
  useResumeOnVisible(
    () => state?.game.status === "playing" && state?.game.buzzed_team_id == null,
    () => activePlayer()?.resumeIfPaused(),
  );

  if (!managerToken) {
    return (
      <main className={styles.shell}>
        <p className="error">You're not the host of this game.</p>
        <p className="muted">
          Only the person who created game <strong>{gameCode}</strong> can manage it from this
          browser. If you meant to play, head home and join with the game code.
        </p>
        <p className="muted">
          Are you the host on a new device? Open the game's backup host link here (scan its QR or
          paste the copied link) and this browser becomes the console.
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
    // The final scoreboard + song export survive the delete (I-FinalBoard):
    // render them from the hook's last-known snapshot so a host whose game was
    // swept mid-view still gets the podium and can still export the songs that
    // played (the songs table is durable, so SongExport's lookup works after
    // the ephemeral rows are gone). No snapshot falls back to the bare message.
    if (finalBoard) {
      const boardTeams = Array.from(finalBoard.teams.values());
      return (
        <main className={styles.shell}>
          <p className="muted">This game has ended or expired.</p>
          <EndScreen teams={boardTeams} gameCode={gameCode} />
          <div className={styles.endActions}>
            <SongExport game={finalBoard.game} rounds={finalBoard.rounds} teams={boardTeams} />
            <Link to="/" className="btn btn-primary">
              Back to home
            </Link>
          </div>
        </main>
      );
    }
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
    // Prefer the snapshot: once the post-end sweep starts cascade-deleting
    // team rows, live `state` shrinks while the snapshot holds the full board
    // and complete round history for the export (I-FinalBoard).
    const board = finalBoard ?? state;
    const boardTeams = Array.from(board.teams.values());
    return (
      <main className={styles.shell}>
        <EndScreen teams={boardTeams} gameCode={gameCode} />
        <div className={styles.endActions}>
          <SongExport game={board.game} rounds={board.rounds} teams={boardTeams} />
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

  // Disabled props deliberately do NOT read `busy`: a shared click-driven busy
  // toggle both created a visible disable->enable->disable flash AND silently
  // dropped a *distinct* second click that landed inside the first action's
  // window (Correct Song then quickly Wrong -- F-P1-8 / F-P2-2). Each per-round
  // action instead uses its own pending-flag handoff (set on click, cleared
  // when the round changes or the lock clears) so it stays disabled across the
  // RPC->Realtime gap without blocking a different action; a same-action
  // double-fire is caught synchronously by that action's inFlightRef. End game
  // and Bonus still gate on `busy` because they fire at most once or twice per
  // game and any flash there is imperceptible.
  const isSoundtrackRound = currentSong?.is_soundtrack === true;
  // Soundtrack rounds ask players to name the film/show, which is stored in
  // `artist`; that's the answer the host judges and the only text the display
  // reveals. The song/clip name in `title` is shown as a smaller hint, and only
  // when it actually differs from the film name (older rows duplicate them).
  let songPrimaryLine: string | null = null;
  let songSecondaryLine: string | null = null;
  if (currentSong) {
    if (isSoundtrackRound) {
      songPrimaryLine = currentSong.artist;
      songSecondaryLine = currentSong.title !== currentSong.artist ? currentSong.title : null;
    } else {
      songPrimaryLine = currentSong.title;
      songSecondaryLine = currentSong.artist;
    }
  }
  const titleActionDisabled = !lockedTeam || titleClaimedById != null || pendingTitle === round?.id;
  const artistActionDisabled =
    !lockedTeam || artistClaimedById != null || pendingArtist === round?.id;
  const soundtrackActionDisabled =
    !lockedTeam ||
    titleClaimedById != null ||
    artistClaimedById != null ||
    pendingTitle === round?.id ||
    pendingArtist === round?.id;
  const wrongActionDisabled = !lockedTeam || pendingWrong === round?.id;
  const continueDisabled = !lockedTeam || pendingContinue === round?.id;
  const nextRoundDisabled = !player.ready;
  // Bonus is independent of buzz state — it stays actionable as long as the
  // page isn't mid-request. (It must NOT be wrapped in an aria-disabled
  // group, or screen readers + Playwright's toBeEnabled() treat it as
  // disabled whenever no team has buzzed.)
  const bonusDisabled = busy;
  // While the YouTube player is still constructing, the Start/Next button is
  // disabled; label it as progress ("Loading player…") rather than leaving it
  // reading "Start game" so it doesn't look like a dead button.
  const nextRoundLabel = !player.ready
    ? "Loading player…"
    : game.status === "waiting"
      ? "Start game"
      : "Next round";

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

      <ExpiryCountdown
        expiresAt={game.expires_at}
        extendPending={pendingExtendFor === game.expires_at}
        onExtend={() => void handleExtendGame()}
      />

      <HostRecoveryLink gameCode={gameCode} managerToken={managerToken} />

      <div className={styles.column}>
        {/* Two overlaid players: the active one (audible, on top) and the
            standby that silently prebuffers the next song. testId follows the
            active player so E2E's strict youtube-player locators stay valid. */}
        <div className={styles.playerStack}>
          <div
            className={`${styles.playerLayer} ${
              activeKey === "A" ? styles.playerActive : styles.playerStandby
            }`}
          >
            <YouTubePlayer
              ref={playerARef}
              noCover
              testId={activeKey === "A" ? "youtube-player" : "youtube-player-preload"}
              onReady={onPlayerReady}
              onPlaying={handlePlayerPlaying}
              onError={(code) => handlePlayerError("A", code)}
            />
          </div>
          <div
            className={`${styles.playerLayer} ${
              activeKey === "B" ? styles.playerActive : styles.playerStandby
            }`}
          >
            <YouTubePlayer
              ref={playerBRef}
              noCover
              testId={activeKey === "B" ? "youtube-player" : "youtube-player-preload"}
              onReady={onPlayerBReady}
              onPlaying={handlePlayerPlaying}
              onError={(code) => handlePlayerError("B", code)}
            />
          </div>
        </div>

        <section className={styles.card}>
          {currentSong ? (
            <div className={styles.songBlock}>
              {isSoundtrackRound ? <SoundtrackBadge /> : null}
              <p className={styles.songLine}>{songPrimaryLine}</p>
              {songSecondaryLine ? <p className={styles.songMeta}>{songSecondaryLine}</p> : null}
            </div>
          ) : (
            <p className={styles.songMeta}>No round started yet.</p>
          )}

          {round && game.status === "playing" && !isSoundtrackRound ? (
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

          {/* Reserved status strip: during play this is always mounted at a
              fixed height, so the scoring buttons never shift when a buzz
              lands (previously a conditionally-mounted banner pushed the row
              down). Locked and idle share the same box metrics; only the
              colour + text change. Keep the "buzzed in" wording so the status
              stays greppable for the e2e/unit assertions. */}
          {game.status === "playing" ? (
            <div
              className={`${styles.statusStrip} ${
                lockedTeam ? styles.statusStripLocked : styles.statusStripWaiting
              }`}
              role="status"
              aria-live="polite"
            >
              {lockedTeam ? (
                <>
                  <span className={styles.lockedTeam}>{lockedTeam.name}</span> buzzed in — score it:
                </>
              ) : (
                "Waiting for a buzz…"
              )}
            </div>
          ) : null}

          <div className={styles.scoreRow}>
            {isSoundtrackRound ? (
              <button
                type="button"
                className={`${styles.scoreBtn} ${styles.scorePositive}`}
                onClick={() => void handleCorrectSoundtrack()}
                disabled={soundtrackActionDisabled}
                data-testid="score-soundtrack"
              >
                <span className={styles.scoreLabel}>Correct</span>
                <span className={styles.scorePoints}>+{SOUNDTRACK_POINTS}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`${styles.scoreBtn} ${styles.scorePositive}`}
                  onClick={() => void handleCorrectTitle()}
                  disabled={titleActionDisabled}
                  data-testid="score-title"
                >
                  <span className={styles.scoreLabel}>Correct Song</span>
                  <span className={styles.scorePoints}>+{TITLE_POINTS}</span>
                </button>
                <button
                  type="button"
                  className={`${styles.scoreBtn} ${styles.scorePositive}`}
                  onClick={() => void handleCorrectArtist()}
                  disabled={artistActionDisabled}
                  data-testid="score-artist"
                >
                  <span className={styles.scoreLabel}>Correct Artist</span>
                  <span className={styles.scorePoints}>+{ARTIST_POINTS}</span>
                </button>
              </>
            )}
            <button
              type="button"
              className={`${styles.scoreBtn} ${styles.scoreNegative} ${styles.wrongBtn}`}
              onClick={() => void handleWrong()}
              disabled={wrongActionDisabled}
              data-testid="score-wrong"
            >
              <span className={styles.scoreLabel}>Wrong</span>
              <span className={styles.scorePoints}>-{WRONG_BUZZ_PENALTY}</span>
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
              <span className={styles.scorePoints}>+{BONUS_POINTS}</span>
            </button>
          </div>

          <div className={styles.bonusPickerSlot}>
            {bonusOpen ? (
              <div
                id="bonus-team-picker"
                className={styles.bonusPicker}
                role="group"
                aria-label="Pick a team for the bonus"
              >
                <span className={styles.bonusPickerHint}>Award +{BONUS_POINTS} to:</span>
                <div className={styles.bonusPickerList}>
                  {teams.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`btn ${styles.bonusTeamBtn}`}
                      onClick={() => void handleBonus(t.id, t.name)}
                      disabled={busy}
                      aria-label={`Award +${BONUS_POINTS} bonus to ${t.name}`}
                      data-testid={`bonus-team-${t.id}`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

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
