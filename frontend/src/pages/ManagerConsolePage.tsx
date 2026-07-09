import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EndScreen } from "../components/EndScreen";
import { ExpiryCountdown } from "../components/ExpiryCountdown";
import { HostRecoveryLink } from "../components/HostRecoveryLink";
import { Skeleton } from "../components/Skeleton";
import { SongExport } from "../components/SongExport";
import { SoundtrackBadge } from "../components/SoundtrackBadge";
import { YouTubePlayer, type YouTubePlayerHandle } from "../components/YouTubePlayer";
import { useToast } from "../context/useToast";
import { useGameChannel } from "../hooks/useGameChannel";
import { useKeepBackendWarm } from "../hooks/useKeepBackendWarm";
import { usePlayerReady } from "../hooks/usePlayerReady";
import { useResumeOnVisible } from "../hooks/useResumeOnVisible";
import { ApiError, awardBonus, endGame } from "../lib/api";
import {
  awardAttemptDirect,
  extendGameDirect,
  releaseBuzzLockDirect,
  RpcError,
} from "../hooks/useManagerActions";
import { selectNextSongDirect } from "../hooks/useSelectNextSong";
import { peekNextSongDirect, type PeekedSong } from "../hooks/usePeekNextSong";
import {
  clearManagerToken,
  getManagerToken,
  parseRecoveryHash,
  setManagerToken,
} from "../lib/managerToken";
import {
  failScore,
  log,
  markScoreStart,
  startSongStart,
  type SongStartHandle,
} from "../lib/telemetry";
import { fetchSongById } from "../lib/songMetadata";
import type { Song } from "../lib/types";
import styles from "./ManagerConsolePage.module.css";

export function ManagerConsolePage() {
  const { gameCode = "" } = useParams<{ gameCode: string }>();
  const { toast } = useToast();
  const { hash, pathname, search } = useLocation();
  const navigate = useNavigate();
  // Adopt a backup-host-link token (T4.10): /manager/game/<code>#mt=<token>
  // re-authenticates a host whose localStorage is gone (new device, cleared
  // browser). Read synchronously so the very first render already holds the
  // credential — no "not the host" flash. Persisting inside the memo is an
  // idempotent write, safe under StrictMode's double-invoke; once the hash is
  // scrubbed below, the memo re-runs and reads the same token back from
  // storage.
  const managerToken = useMemo(() => {
    const adopted = parseRecoveryHash(hash);
    if (adopted) {
      setManagerToken(gameCode, adopted);
      return adopted;
    }
    return getManagerToken(gameCode);
  }, [gameCode, hash]);

  // Scrub the adopted token out of the address bar and this history entry so
  // it doesn't linger in screenshots or a shared device's history. replace
  // keeps Back working (no extra entry for the tokened URL).
  useEffect(() => {
    if (parseRecoveryHash(hash)) {
      navigate(pathname + search, { replace: true });
    }
  }, [hash, pathname, search, navigate]);
  const { state, status } = useGameChannel(gameCode);
  const player = usePlayerReady();

  // Double-buffer: two persistent YouTube players overlaid in one box. One is
  // the live "active" player (audible, on top); the other is the "standby" that
  // silently prebuffers the NEXT song during the current round so that clicking
  // Next round resumes an already-downloaded video (~tens of ms) instead of a
  // cold YouTube load (~1.2s). They swap roles on commit. See
  // db/migrations/029_peek_next_song.sql for the read-only picker that tells us
  // which song to prebuffer. `activeKey` (state) drives opacity/testId; a
  // mirror ref lets the click handlers and player callbacks read it
  // synchronously without going stale.
  const playerARef = useRef<YouTubePlayerHandle | null>(null);
  const playerBRef = useRef<YouTubePlayerHandle | null>(null);
  const [activeKey, setActiveKey] = useState<"A" | "B">("A");
  const activeKeyRef = useRef<"A" | "B">("A");
  const playersReadyRef = useRef<{ A: boolean; B: boolean }>({ A: false, B: false });
  // State mirror of the standby player's readiness. playersReadyRef is a ref
  // (read synchronously by the click handlers), but the waiting-screen preload
  // effect needs a re-render trigger when the standby finishes constructing, so
  // we also track it as state. Flipped in onPlayerBReady.
  const [standbyConstructed, setStandbyConstructed] = useState(false);
  const activePlayer = (): YouTubePlayerHandle | null =>
    activeKeyRef.current === "A" ? playerARef.current : playerBRef.current;
  const standbyPlayer = (): YouTubePlayerHandle | null =>
    activeKeyRef.current === "A" ? playerBRef.current : playerARef.current;
  const standbyReady = (): boolean =>
    activeKeyRef.current === "A" ? playersReadyRef.current.B : playersReadyRef.current.A;

  // The song currently prebuffered into the standby player (or null). Set after
  // a successful peek+prebuffer; consumed (and cleared) when Next round commits
  // it. `preloadInFlightRef` dedupes concurrent peeks; `preloadEpochRef` is
  // bumped on every Next round / swap so a peek that resolves after the host has
  // already moved on is discarded instead of buffering into the wrong player.
  const preloadRef = useRef<PeekedSong | null>(null);
  const preloadInFlightRef = useRef(false);
  const preloadEpochRef = useRef(0);
  // I-NextMeta: on the Next-round fast path we optimistically render the peeked
  // song's metadata BEFORE the round advances server-side. That makes
  // `currentSong.id` briefly lead `currentRound.song_id`; this ref holds the
  // optimistically-committed id so the mid-round song-resolver effect below
  // doesn't mistake the lead for staleness and refetch (and reload) the PREVIOUS
  // song over the freshly-promoted player. Cleared when the round catches up or
  // the commit fails.
  const optimisticSongIdRef = useRef<string | null>(null);
  // Song-start measurement: the handle is opened on a "Next round" click and
  // resolved when the player reaches PLAYING (or the timeout fires). It crosses
  // the click handler → loadVideoById → YouTubePlayer.onPlaying boundary, so it
  // lives in a ref rather than state.
  const songStartRef = useRef<SongStartHandle | null>(null);
  const songStartTimeoutRef = useRef<number | null>(null);

  // Keep the Render-hosted API warm while a game is running so the host's
  // occasional REST calls (Bonus / End game / Kick) and late team joins don't
  // hit a mid-game cold start. See useKeepBackendWarm for the why.
  useKeepBackendWarm(state?.game?.status === "playing" || state?.game?.status === "waiting");

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [busy, setBusy] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);

  // Optimistic "we just clicked this" markers for the per-round action buttons,
  // each holding the round id the click happened on. They bridge the ~50-
  // 100ms gap between the RPC returning and the Realtime UPDATE on game_rounds
  // (title_claimed_by / artist_claimed_by) or active_games (buzzed_team_id)
  // arriving -- keeping the button disabled across that gap so it doesn't flash
  // enabled in the window. The flag is naturally self-clearing on round change
  // (stale id won't equal the new round.id) and gets reset by the effects
  // below for tidiness. Cleared in each handler's catch on failure so a
  // transient RPC error doesn't leave the button permanently disabled.
  // pendingContinue mirrors pendingWrong: Continue releases the buzz lock, so
  // it stays disabled until the Realtime UPDATE clears buzzed_team_id.
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [pendingArtist, setPendingArtist] = useState<string | null>(null);
  const [pendingWrong, setPendingWrong] = useState<string | null>(null);
  const [pendingContinue, setPendingContinue] = useState<string | null>(null);
  // Extend-game handoff, same shape as the flags above but keyed on the
  // expires_at value the click happened on: the banner's button stays disabled
  // until the Realtime UPDATE lands with the bumped value (at which point the
  // flag is stale and inert). Cleared on failure so the host can retry.
  const [pendingExtendFor, setPendingExtendFor] = useState<string | null>(null);

  // Synchronous in-flight locks, one PER ACTION. These are the sole guard
  // against a same-action double-fire now that the shared `busy` gate is off
  // the hot handlers (removing it is what stops a *distinct* second click --
  // e.g. Correct Song then quickly Wrong -- from being silently dropped inside
  // the first action's window; see F-P1-8 / F-P2-2). useState can't do this
  // job: `busy` is captured in the closure at render time, so two clicks in
  // one React tick both read the stale value; useRef.current mutates
  // synchronously, so the second same-action click sees `true` and bails.
  // Matters most for handleNextRound, where a duplicate fire would insert an
  // orphan game_rounds row (the other actions are idempotent via the SQL
  // function's already-claimed / no-buzz-to-score branches).
  const titleInFlightRef = useRef(false);
  const artistInFlightRef = useRef(false);
  const wrongInFlightRef = useRef(false);
  const continueInFlightRef = useRef(false);
  const nextRoundInFlightRef = useRef(false);
  const extendInFlightRef = useRef(false);

  // When we get the buzz lock signal, pause playback on the live player.
  useEffect(() => {
    if (state?.game.buzzed_team_id != null) {
      // activePlayer() reads activeKeyRef synchronously, so it always pauses
      // whichever player is live regardless of swaps.
      activePlayer()?.pause();
    }
  }, [state?.game.buzzed_team_id]);

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

  // Warm up the FIRST song during the pre-game "waiting" screen. Mobile
  // browsers block unmuted playback that resumes after an `await`, so if the
  // first video isn't loaded until after select_next_song returns, round 1
  // stays silent until the host taps something a second time. Prebuffering the
  // first song here lets the "Start game" tap commit an already-buffered
  // (muted-then-unmuted) video synchronously inside the gesture — the same
  // in-gesture path every later round already uses. Best-effort: maybePreloadNext
  // is fully guarded and a miss just falls back to the post-await cold load.
  const waitingStatus = state?.game.status;
  useEffect(() => {
    if (waitingStatus === "waiting") maybePreloadNext();
    // maybePreloadNext is a hoisted closure over the current render; we only
    // need to (re)try when the game enters waiting or the standby player
    // finishes constructing (standbyConstructed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingStatus, standbyConstructed]);

  // Reset the per-click pending flags whenever the round changes. The
  // disabled checks already compare against `round?.id` so stale flags
  // are inert, but clearing them keeps state tidy and avoids confusion
  // when debugging.
  const currentRoundId = state?.currentRound?.id ?? null;
  useEffect(() => {
    setPendingTitle(null);
    setPendingArtist(null);
    setPendingWrong(null);
    setPendingContinue(null);
    // The round advanced (or reset): any optimistic Next-round prediction has
    // now either landed or is moot, so drop the suppression id.
    optimisticSongIdRef.current = null;
  }, [currentRoundId]);

  // Wrong and Continue both release the buzz lock, so a follow-up buzz in the
  // same round must re-enable their buttons. `pendingWrong` / `pendingContinue`
  // only bridge the gap between the RPC returning and the Realtime UPDATE on
  // buzzed_team_id; once that UPDATE has landed (lock cleared) the flags have
  // done their job and must drop or the next buzz's click stays blocked.
  useEffect(() => {
    if (state?.game.buzzed_team_id == null) {
      setPendingWrong(null);
      setPendingContinue(null);
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
    // I-NextMeta: currentSong is the optimistically-committed next song, ahead of
    // the round that hasn't advanced yet — NOT a stale leftover. Don't refetch
    // the old round's song (which would also reload it over the promoted player);
    // the round will catch up momentarily and the RPC reconciles the metadata.
    if (currentSong && currentSong.id === optimisticSongIdRef.current) return;
    let cancelled = false;
    // fetchSongById retries transient failures with bounded backoff (F-P1-7)
    // so one blip doesn't leave the post-refresh player empty for the round.
    void fetchSongById(currentRoundSongId, () => cancelled).then((song) => {
      if (cancelled || !song) return;
      setCurrentSong(song);
      if (playerReady) {
        activePlayer()?.loadVideoById(song.youtube_id, song.start_time);
      } else {
        player.enqueueSong({ youtube_id: song.youtube_id, start_time: song.start_time });
      }
    });
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
      // 'no_more_songs' is the friendly user-facing error from select_next_song
      // when the selected-genres pool is exhausted. Mirror the ApiError text
      // above so the manager sees the same wording regardless of which path
      // surfaced it.
      if (err.message === "no_more_songs") {
        toast(
          "All songs in your selected genres have been played. End the game or start a new one with more genres.",
          { variant: "error" },
        );
        return;
      }
      log("error", "manager_rpc_failed", { message: err.message });
      toast(err.message, { variant: "error" });
      return;
    }
    log("error", "manager_action_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    toast(err instanceof Error ? err.message : "Request failed", { variant: "error" });
  }

  async function loadSongIntoPlayer(song: Song) {
    if (player.ready) {
      songStartRef.current?.loadIssued();
      armSongStartTimeout();
      activePlayer()?.loadVideoById(song.youtube_id, song.start_time);
    } else {
      // Player not ready yet (first song): the load is deferred to
      // onPlayerReady, which issues loadVideoById and marks loadIssued there.
      player.enqueueSong({ youtube_id: song.youtube_id, start_time: song.start_time });
    }
  }

  // Prebuffer the next song into the standby player so the upcoming Next round
  // resumes an already-downloaded video. During play it's triggered once the
  // current round's song is actually PLAYING (so it never contends with the
  // current song's critical first-play); during the pre-game "waiting" screen
  // it's triggered by an effect once the standby player is ready, so the very
  // first "Start game" also commits an already-buffered video in-gesture (see
  // the waiting-prebuffer effect + handleNextRound for why that matters on
  // mobile). Read-only `peek_next_song` tells us which song select_next_song
  // would pick; on the click we commit that exact id. Best-effort throughout:
  // a peek/prebuffer failure must never disturb the round.
  function maybePreloadNext() {
    if (!managerToken) return;
    const gameStatus = state?.game.status;
    if (gameStatus !== "playing" && gameStatus !== "waiting") return;
    // During play, only prebuffer once a round is live so peek excludes the
    // current song. During waiting there is no round yet — that's expected, and
    // the first song is the thing we want to warm up.
    if (gameStatus === "playing" && !state?.currentRound?.id) return;
    if (preloadRef.current !== null || preloadInFlightRef.current) return;
    if (!standbyReady()) return;
    preloadInFlightRef.current = true;
    const epoch = preloadEpochRef.current;
    void (async () => {
      try {
        const peeked = await peekNextSongDirect(gameCode, managerToken);
        // A Next round / swap happened while we were peeking: discard so we
        // don't mute or overwrite what is now the live player.
        if (epoch !== preloadEpochRef.current) return;
        if (!peeked) return; // pool exhausted -> nothing to prebuffer
        preloadRef.current = peeked;
        standbyPlayer()?.prebuffer(peeked.youtube_id, peeked.start_time);
      } catch (err) {
        log("warn", "preload_peek_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        preloadInFlightRef.current = false;
      }
    })();
  }

  // Bound the song-start span so a video that never reaches PLAYING (autoplay
  // blocked, dead embed) is recorded as a timeout outlier rather than left open.
  function armSongStartTimeout() {
    if (songStartTimeoutRef.current !== null) window.clearTimeout(songStartTimeoutRef.current);
    songStartTimeoutRef.current = window.setTimeout(() => {
      songStartRef.current?.playing("timeout");
      songStartRef.current = null;
      songStartTimeoutRef.current = null;
    }, 8000);
  }

  // Resolve the open song-start span when the live player actually starts
  // playing, then prebuffer the next song into the standby (now that the
  // current song is up, there's idle time and no contention with its start).
  function handlePlayerPlaying(detection: "statechange" | "poll") {
    if (songStartTimeoutRef.current !== null) {
      window.clearTimeout(songStartTimeoutRef.current);
      songStartTimeoutRef.current = null;
    }
    songStartRef.current?.playing(detection);
    songStartRef.current = null;
    maybePreloadNext();
  }

  // A YouTube error on the standby/preload buffer must not alarm the host (the
  // live song is fine); just abandon the preload so Next round falls back to a
  // fresh random pick. An error on the live player surfaces as before.
  function handlePlayerError(key: "A" | "B", code: number) {
    if (key === activeKeyRef.current) {
      log("warn", "yt_player_error", { code: String(code) });
      toast("Video unavailable — click Next round to pick a different song.", {
        variant: "error",
      });
    } else {
      log("warn", "yt_preload_error", { code: String(code) });
      preloadRef.current = null;
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
    if (titleInFlightRef.current) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    titleInFlightRef.current = true;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+10 to ${teamName}`, { variant: "success" });
    // Pending flag flips the disabled prop synchronously on click and stays
    // set until the Realtime UPDATE on game_rounds.title_claimed_by lands
    // (after which the semantic gate takes over) -- no enable/disable
    // flicker in the gap.
    setPendingTitle(roundId);
    markScoreStart(gameCode, roundId, "title");
    try {
      await applyAttempt(roundId, {
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "title");
      setPendingTitle(null);
      reportError(err);
    } finally {
      titleInFlightRef.current = false;
    }
  }

  async function handleCorrectArtist() {
    if (artistInFlightRef.current) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    artistInFlightRef.current = true;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+5 to ${teamName}`, { variant: "success" });
    setPendingArtist(roundId);
    markScoreStart(gameCode, roundId, "artist");
    try {
      await applyAttempt(roundId, {
        title_correct: false,
        artist_correct: true,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "artist");
      setPendingArtist(null);
      reportError(err);
    } finally {
      artistInFlightRef.current = false;
    }
  }

  // Soundtrack rounds (current song has is_soundtrack=true) use a single
  // "Correct +15" button instead of the title/artist split. The team's job is
  // to name the work (film / TV / game / musical), not the song title; awarding
  // both flags at once sums to 15 points via the existing award_attempt
  // function -- no SQL change needed. Both tokens claim together; nothing more
  // can be scored on this round, so we let it sit in the fully-scored state
  // (lock held, player paused) and wait for the manager's "Next round" click,
  // mirroring how a regular round behaves once both title + artist are claimed.
  async function handleCorrectSoundtrack() {
    if (titleInFlightRef.current || artistInFlightRef.current) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    titleInFlightRef.current = true;
    artistInFlightRef.current = true;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+15 to ${teamName}`, { variant: "success" });
    setPendingTitle(roundId);
    setPendingArtist(roundId);
    markScoreStart(gameCode, roundId, "soundtrack");
    try {
      await applyAttempt(roundId, {
        title_correct: true,
        artist_correct: true,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "soundtrack");
      setPendingTitle(null);
      setPendingArtist(null);
      reportError(err);
    } finally {
      titleInFlightRef.current = false;
      artistInFlightRef.current = false;
    }
  }

  async function handleContinueRound() {
    if (continueInFlightRef.current) return;
    if (!managerToken) return;
    continueInFlightRef.current = true;
    // Optimistic toast fires before the RPC so the click feels instant; the
    // Realtime UPDATE on active_games.buzzed_team_id is still the source of
    // truth for re-arming the buzzers.
    toast("Round continued", { variant: "info" });
    // Keep Continue disabled until the lock actually clears via Realtime, the
    // same handoff pendingWrong uses -- no enable/disable flash in the gap.
    setPendingContinue(state?.currentRound?.id ?? null);
    try {
      await releaseBuzzLockDirect(gameCode, managerToken);
      activePlayer()?.play();
    } catch (err) {
      setPendingContinue(null);
      reportError(err);
    } finally {
      continueInFlightRef.current = false;
    }
  }

  // Wrong is a one-click verdict: it fires award_attempt with wrong_buzz=true,
  // re-arms the buzzers, and resumes the song (no separate "Continue round"
  // press needed). Per game-rules.md §4 the -3 is waived only when the round's
  // one-shot free-guess flag is armed (`free_guess_active`), which the SQL
  // arms after a correct attempt and consumes on the very next attempt. We
  // mirror that exact flag here so the optimistic toast matches the score the
  // server will commit -- reading "any token claimed" instead would wrongly
  // suppress the -3 toast for every later wrong in a round that had a correct.
  // Playback resume is held until the RPC commits so a failed Wrong leaves the
  // song paused with the lock still held -- the manager can simply retry.
  async function handleWrong() {
    if (wrongInFlightRef.current) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    wrongInFlightRef.current = true;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    const freeGuess = state.currentRound.free_guess_active;
    if (teamName && !freeGuess) toast(`-3 to ${teamName}`, { variant: "info" });
    setPendingWrong(roundId);
    try {
      await applyAttempt(roundId, {
        title_correct: false,
        artist_correct: false,
        wrong_buzz: true,
      });
      activePlayer()?.play();
    } catch (err) {
      setPendingWrong(null);
      reportError(err);
    } finally {
      wrongInFlightRef.current = false;
    }
  }

  async function handleNextRound() {
    if (nextRoundInFlightRef.current) return;
    if (!managerToken) return;
    nextRoundInFlightRef.current = true;
    // Bump the preload epoch so any in-flight peek is discarded rather than
    // buffering into a player we're about to repurpose.
    preloadEpochRef.current += 1;
    // Open the song-start span at the click instant (before the toast) so it
    // captures click → RPC → load → audio actually playing.
    const songStart = startSongStart({ game_code: gameCode });
    songStartRef.current = songStart;
    // Optimistic toast confirms the click immediately.
    toast("Loading next round...", { variant: "info" });
    // Snapshot + clear the prebuffered song now so a late preload can't reuse it.
    const preloaded = preloadRef.current;
    preloadRef.current = null;
    // Pre-swap snapshot for the rollback in the catch below: which player was
    // live and which song card was up before the optimistic in-gesture swap.
    const prevKey = activeKeyRef.current;
    const prevSong = currentSong;

    // FAST PATH — start the prebuffered song *synchronously inside this tap*,
    // BEFORE awaiting the RPC. Mobile browsers only allow unmuted playback that
    // begins within a user gesture; resuming after `await select_next_song`
    // counts as blocked autoplay, which is exactly the reported bug (round 1 /
    // Next round stayed silent until a stray buzz + Continue finally unlocked
    // it). We pass preloaded.song_id to the RPC below, so the video we begin
    // playing here is guaranteed to be the one the round records — it's safe to
    // start it before the round is committed server-side. commitPrebuffered
    // resumes an already-downloaded (muted) buffer, so the unmute+play lands in
    // the gesture and the room hears it immediately.
    let committedPreloaded = false;
    if (preloaded) {
      songStart.loadIssued();
      armSongStartTimeout();
      const promoted = standbyPlayer();
      const demoted = activePlayer();
      promoted?.commitPrebuffered(preloaded.start_time);
      demoted?.stop();
      const nextKey = activeKeyRef.current === "A" ? "B" : "A";
      activeKeyRef.current = nextKey;
      setActiveKey(nextKey);
      committedPreloaded = true;
      // I-NextMeta: the prebuffered audio is already playing, so render the new
      // song's card in-gesture from the peeked metadata (mig 038) instead of
      // leaving the PREVIOUS title up until select_next_song resolves ~150ms
      // later. Record the id first so the song-resolver effect treats this as an
      // optimistic lead (not staleness) and doesn't reload the old song. The
      // RPC's authoritative row reconciles the card below (same values).
      optimisticSongIdRef.current = preloaded.song_id;
      setCurrentSong({
        id: preloaded.song_id,
        title: preloaded.title,
        artist: preloaded.artist,
        youtube_id: preloaded.youtube_id,
        start_time: preloaded.start_time,
        is_soundtrack: preloaded.is_soundtrack,
      });
    }

    try {
      if (committedPreloaded && preloaded) {
        // Confirm/record the round for the exact song we already started.
        const result = await selectNextSongDirect(gameCode, managerToken, preloaded.song_id);
        songStart.rpcDone({
          roundNumber: result.round_number,
          songId: result.song.id,
          youtubeId: result.song.youtube_id,
          preloaded: true,
        });
        setCurrentSong(result.song);
        if (result.song.id !== preloaded.song_id) {
          // Defensive: the RPC picked something other than what we prebuffered
          // and already began playing (should not happen with an explicit
          // song_id). Cold-load the real song onto the now-live player.
          await loadSongIntoPlayer(result.song);
        }
      } else {
        // Slow path (first round without a warmed buffer, preload missed, or
        // pool was empty at peek time): random pick + cold load on the live
        // player. On mobile this load lands after the await, so it can't reliably
        // autoplay — but the waiting-screen prebuffer normally routes round 1
        // through the fast path above, leaving this as a rare fallback.
        const result = await selectNextSongDirect(gameCode, managerToken);
        songStart.rpcDone({
          roundNumber: result.round_number,
          songId: result.song.id,
          youtubeId: result.song.youtube_id,
          preloaded: false,
        });
        setCurrentSong(result.song);
        await loadSongIntoPlayer(result.song);
      }
    } catch (err) {
      songStart.fail("select_next_song_failed");
      songStartRef.current = null;
      optimisticSongIdRef.current = null;
      // The round failed to advance server-side, so the optimistic in-gesture
      // swap (which has to happen before the await for mobile autoplay) must
      // not stand. Roll all of it back: silence the promoted player, restore
      // the pre-click active player + song card, and reload the still-current
      // round's song so the room isn't left in silence (best-effort on strict
      // mobile autoplay — this load lands outside the gesture). The peeked
      // song goes back into the standby buffer: the round never advanced, so
      // it is still exactly what select_next_song would record, and a retry
      // click keeps the in-gesture fast path.
      if (committedPreloaded && preloaded) {
        activePlayer()?.stop();
        activeKeyRef.current = prevKey;
        setActiveKey(prevKey);
        setCurrentSong(prevSong);
        if (prevSong) activePlayer()?.loadVideoById(prevSong.youtube_id, prevSong.start_time);
        preloadRef.current = preloaded;
        standbyPlayer()?.prebuffer(preloaded.youtube_id, preloaded.start_time);
      }
      reportError(err);
    } finally {
      nextRoundInFlightRef.current = false;
    }
  }

  // The expiry banner's "Keep playing +1h" -> extend_game direct RPC (mig
  // 039), pushing active_games.expires_at out an hour. The Realtime UPDATE on
  // expires_at is what moves the banner back to the subtle hint for everyone;
  // the toast just confirms the commit to the host who clicked.
  async function handleExtendGame() {
    if (extendInFlightRef.current) return;
    if (!state || !managerToken) return;
    extendInFlightRef.current = true;
    setPendingExtendFor(state.game.expires_at);
    try {
      const newExpiresAt = await extendGameDirect(gameCode, managerToken);
      const endsAt = new Date(newExpiresAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      toast(`Game extended — now ends at ${endsAt}`, { variant: "success" });
    } catch (err) {
      setPendingExtendFor(null);
      reportError(err);
    } finally {
      extendInFlightRef.current = false;
    }
  }

  async function handleBonus(teamId: string, teamName: string) {
    if (busy || !managerToken) return;
    // Close the picker and acknowledge the click immediately, but do NOT
    // claim success yet: the bonus is the one Render-routed scoring call, so
    // on a cold start it can hang for many seconds or fail outright, and an
    // optimistic "+4" here let the host believe a bonus landed that the room
    // never saw (F-P1-5). The success toast waits for the call to resolve;
    // `busy` keeps Bonus + End game gated while it's in flight (the per-round
    // scoring buttons stay deliberately independent of it).
    setBonusOpen(false);
    toast(`Sending +4 to ${teamName}...`, { variant: "info" });
    setBusy(true);
    try {
      await awardBonus(gameCode, managerToken, { team_id: teamId });
      toast(`+4 bonus to ${teamName}`, { variant: "success" });
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function performEnd() {
    if (busy || !managerToken) return;
    // Toast fires before the network call so the manager gets immediate
    // feedback the click registered; if endGame() fails reportError() will
    // surface the failure on top.
    toast("Ending game...", { variant: "info" });
    setBusy(true);
    try {
      await endGame(gameCode, managerToken);
      playerARef.current?.stop();
      playerBRef.current?.stop();
      clearManagerToken(gameCode);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  // onReady for the initially-active player (A). Drives the reactive ready gate
  // (Start button) and flushes any deferred first song into the live player.
  function onPlayerReady() {
    playersReadyRef.current.A = true;
    player.setReady();
    const queued = player.flushPendingSong();
    if (queued) {
      // This is the deferred first-song load; mark loadIssued here so the
      // song-start span's load_to_playing child measures from the real load.
      songStartRef.current?.loadIssued();
      armSongStartTimeout();
      activePlayer()?.loadVideoById(queued.youtube_id, queued.start_time);
    }
  }

  // onReady for the standby player (B). It only ever plays after a swap, so it
  // doesn't gate the Start button or flush the first song — it just records
  // readiness so we don't prebuffer into a player that hasn't constructed yet.
  // The state flip wakes the waiting-prebuffer effect so the first song warms
  // up as soon as both the standby is ready and the game is in "waiting".
  function onPlayerBReady() {
    playersReadyRef.current.B = true;
    setStandbyConstructed(true);
  }

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
          <SongExport game={game} rounds={state.rounds} teams={teams} />
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
                <span className={styles.scorePoints}>+15</span>
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

          <div className={styles.bonusPickerSlot}>
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
                      className={`btn ${styles.bonusTeamBtn}`}
                      onClick={() => void handleBonus(t.id, t.name)}
                      disabled={busy}
                      aria-label={`Award +4 bonus to ${t.name}`}
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
