import { useEffect, useRef, useState } from "react";
import type { YouTubePlayerHandle } from "../components/YouTubePlayer";
import { useToast } from "../context/useToast";
import { peekNextSongDirect, type PeekedSong } from "./usePeekNextSong";
import { log, startSongStart, type SongStartHandle } from "../lib/telemetry";
import type { GameState, Song } from "../lib/types";

// Extracted from ManagerConsolePage (T7.2). Owns the double-buffer YouTube
// player machinery: two persistent players overlaid in one box (one live +
// audible, one silent standby that prebuffers the NEXT song), the peek +
// prebuffer flow (`peek_next_song`, mig 029/038), and the song-start telemetry
// span. Behaviour is a pure move — the same peeks, prebuffers, swaps, and
// telemetry as before; nothing about the RPC semantics or ordering changed.
//
// The hook returns both the JSX-facing pieces (player refs, activeKey, the
// player callbacks) AND an imperative surface the "Next round" handler needs to
// commit/roll back a swap. useScoring's handleNextRound composes that surface,
// so the two hooks stay coupled exactly as the single component was.

export interface SongPrebuffer {
  // JSX wiring.
  playerARef: React.RefObject<YouTubePlayerHandle | null>;
  playerBRef: React.RefObject<YouTubePlayerHandle | null>;
  activeKey: "A" | "B";
  onPlayerReady: () => void;
  onPlayerBReady: () => void;
  handlePlayerPlaying: (detection: "statechange" | "poll") => void;
  handlePlayerError: (key: "A" | "B", code: number) => void;

  // Imperative surface for handleNextRound + the mid-round song resolver.
  activePlayer: () => YouTubePlayerHandle | null;
  standbyPlayer: () => YouTubePlayerHandle | null;
  activeKeyRef: React.MutableRefObject<"A" | "B">;
  setActiveKey: React.Dispatch<React.SetStateAction<"A" | "B">>;
  preloadRef: React.MutableRefObject<PeekedSong | null>;
  preloadEpochRef: React.MutableRefObject<number>;
  optimisticSongIdRef: React.MutableRefObject<string | null>;
  songStartRef: React.MutableRefObject<SongStartHandle | null>;
  loadSongIntoPlayer: (song: Song) => Promise<void>;
  armSongStartTimeout: () => void;
  maybePreloadNext: () => void;
  beginSongStart: () => SongStartHandle;
}

interface PlayerReadyHandle {
  ready: boolean;
  setReady: () => void;
  enqueueSong: (song: { youtube_id: string; start_time: number }) => void;
  flushPendingSong: () => { youtube_id: string; start_time: number } | null;
}

export function useSongPrebuffer(
  gameCode: string,
  managerToken: string | null,
  state: GameState | null,
  player: PlayerReadyHandle,
): SongPrebuffer {
  const { toast } = useToast();

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

  // Open the song-start span at the "Next round" click instant, storing the
  // handle in the ref that spans the click → load → playing boundary. Returned
  // so the caller can also drive rpcDone/fail on the same handle.
  function beginSongStart(): SongStartHandle {
    const songStart = startSongStart({ game_code: gameCode });
    songStartRef.current = songStart;
    return songStart;
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

  return {
    playerARef,
    playerBRef,
    activeKey,
    onPlayerReady,
    onPlayerBReady,
    handlePlayerPlaying,
    handlePlayerError,
    activePlayer,
    standbyPlayer,
    activeKeyRef,
    setActiveKey,
    preloadRef,
    preloadEpochRef,
    optimisticSongIdRef,
    songStartRef,
    loadSongIntoPlayer,
    armSongStartTimeout,
    maybePreloadNext,
    beginSongStart,
  };
}
