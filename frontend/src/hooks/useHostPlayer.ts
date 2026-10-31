import { useEffect, useRef } from "react";
import type { YouTubePlayerHandle } from "../components/YouTubePlayer";
import { useToast } from "../context/useToast";
import { peekNextSongDirect, type PeekedSong } from "./usePeekNextSong";
import { log, startSongStart, type SongStartHandle } from "../lib/telemetry";
import type { GameState, Song } from "../lib/types";

// The host console's one YouTube player: the next-song peek (`peek_next_song`,
// mig 029/038), the song-start telemetry span, and the player's error and
// stall reports. useScoring's handleNextRound composes the imperative surface.
//
// One player, on screen, by YouTube's rules. Until 2026-10-31 the console ran
// two: a hidden standby muted-played the NEXT song so Next round could resume
// it in tens of ms. YouTube's Required Minimum Functionality says "an API
// Client must not initiate an automatic playback until the player is visible
// and more than half of the player is visible", and its Developer Policies
// forbid playing content "from a background player, meaning a player that is
// not displayed in the page". So now the next song is only peeked (its id and
// card), and the Next-round tap loads it on the visible player, still inside
// the tap so mobile browsers allow unmuted playback. A load YouTube fails
// without an onError is issued once more by the player itself (onStartStall).

export interface HostPlayer {
  // JSX wiring.
  playerRef: React.RefObject<YouTubePlayerHandle | null>;
  onPlayerReady: () => void;
  handlePlayerPlaying: (detection: "statechange" | "poll") => void;
  handlePlayerError: (code: number, videoId: string | null, liveSong: Song | null) => void;
  handleStartStall: (info: StartStallInfo, liveSong: Song | null) => void;
  handleEarlyPause: (msAfterStart: number, liveSong: Song | null) => void;

  // Imperative surface for handleNextRound + the mid-round song resolver.
  livePlayer: () => YouTubePlayerHandle | null;
  peekedRef: React.MutableRefObject<PeekedSong | null>;
  peekEpochRef: React.MutableRefObject<number>;
  optimisticSongIdRef: React.MutableRefObject<string | null>;
  songStartRef: React.MutableRefObject<SongStartHandle | null>;
  loadSongIntoPlayer: (song: Song) => Promise<void>;
  armSongStartTimeout: () => void;
  maybePeekNext: () => void;
  beginSongStart: () => SongStartHandle;
  beginRoundCommit: () => void;
  endRoundCommit: (committed: boolean) => void;
}

interface StartStallInfo {
  state: number;
  loadedFraction: number;
  retried: boolean;
  videoId: string | null;
}

// The `code` a silent load failure is logged with in yt_preload_error. YouTube
// gives such a load no error code; the dead-video scan prints the code with
// its meaning ("no_bytes (unknown)").
export const NO_BYTES_CODE = "no_bytes";

interface PlayerReadyHandle {
  ready: boolean;
  setReady: () => void;
  enqueueSong: (song: { youtube_id: string; start_time: number }) => void;
  flushPendingSong: () => { youtube_id: string; start_time: number } | null;
}

interface SongRef {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
}

// Telemetry fields for a song, empty ones omitted.
function songFields(
  song: { id: string; title: string; artist: string; youtube_id: string } | null,
): Record<string, string> {
  if (!song) return {};
  const fields: Record<string, string> = {
    youtube_id: song.youtube_id,
    song_id: song.id,
    title: song.title,
    artist: song.artist,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== ""));
}

// Telemetry context for a video the player refused (yt_player_error, and
// yt_preload_error for a load that loaded nothing): the catalog song and a
// watch URL, so the weekly dead-video scan can list real in-game failures by
// name. `candidates` are the songs the player could have been playing; only
// the one whose youtube_id is the failed video is named, never a guess. Empty
// fields are omitted.
export function failedVideoContext(
  gameCode: string,
  code: number | string,
  videoId: string,
  candidates: Array<SongRef | null>,
): Record<string, string> {
  const song = candidates.find((s) => s !== null && s.youtube_id === videoId) ?? null;
  const context: Record<string, string> = {
    code: String(code),
    game_code: gameCode,
    youtube_id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    song_id: song?.id ?? "",
    title: song?.title ?? "",
    artist: song?.artist ?? "",
  };
  return Object.fromEntries(Object.entries(context).filter(([, v]) => v !== ""));
}

export function useHostPlayer(
  gameCode: string,
  managerToken: string | null,
  state: GameState | null,
  player: PlayerReadyHandle,
): HostPlayer {
  const { toast } = useToast();

  const playerRef = useRef<YouTubePlayerHandle | null>(null);
  const livePlayer = (): YouTubePlayerHandle | null => playerRef.current;

  // The song peek_next_song says comes next (or null). Set after a successful
  // peek; consumed (and cleared) when Next round loads it. `peekInFlightRef`
  // dedupes concurrent peeks; `peekEpochRef` is bumped on every Next round so a
  // peek that resolves after the host has already moved on is discarded.
  const peekedRef = useRef<PeekedSong | null>(null);
  const peekInFlightRef = useRef(false);
  const peekEpochRef = useRef(0);
  // The peek must not run while a Next round is still being recorded. The
  // picker (mig 049) never repeats the genre of the song playing now and spaces
  // artists from the last rounds, so it has to see the new round in
  // game_rounds. The new song can reach PLAYING before the ~150ms
  // select_next_song call returns, which would let the peek judge against the
  // previous song. `roundCommitPendingRef` holds the peek back from the click
  // until the RPC settles; `livePlayingRef` remembers that the new song already
  // started meanwhile, so the peek can run as soon as the round is recorded.
  const roundCommitPendingRef = useRef(false);
  const livePlayingRef = useRef(false);
  // I-NextMeta: on the in-tap path we render the peeked song's metadata BEFORE
  // the round advances server-side. That makes `currentSong.id` briefly lead
  // `currentRound.song_id`; this ref holds the optimistically-committed id so
  // the mid-round song-resolver effect doesn't mistake the lead for staleness
  // and reload the PREVIOUS song over the new one. Cleared when the round
  // catches up or the commit fails.
  const optimisticSongIdRef = useRef<string | null>(null);
  // Song-start measurement: the handle is opened on a "Next round" click and
  // resolved when the player reaches PLAYING (or the timeout fires). It crosses
  // the click handler → loadVideoById → YouTubePlayer.onPlaying boundary, so it
  // lives in a ref rather than state.
  const songStartRef = useRef<SongStartHandle | null>(null);
  const songStartTimeoutRef = useRef<number | null>(null);

  // Peek the FIRST song during the pre-game "waiting" screen, so the "Start
  // game" tap can load it synchronously inside the gesture. Mobile browsers
  // block unmuted playback that begins after an `await`, so if the first video
  // isn't known until select_next_song returns, round 1 stays silent until the
  // host taps something a second time. Best-effort: maybePeekNext is fully
  // guarded and a miss falls back to the post-await load.
  const waitingStatus = state?.game.status;
  useEffect(() => {
    if (waitingStatus === "waiting") maybePeekNext();
    // maybePeekNext is a hoisted closure over the current render; we only need
    // to (re)try when the game enters waiting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingStatus]);

  // Learn the next song ahead of the click. During play it runs once the
  // current round's song is PLAYING (after the round is recorded, see above);
  // during "waiting" an effect runs it. Read-only `peek_next_song` tells us
  // which song select_next_song would pick; on the click we load and commit
  // that exact id. Best-effort throughout: a peek failure must never disturb
  // the round.
  function maybePeekNext() {
    if (!managerToken) return;
    const gameStatus = state?.game.status;
    if (gameStatus !== "playing" && gameStatus !== "waiting") return;
    // During play, only peek once a round is live so peek excludes the current
    // song. During waiting there is no round yet — that's expected.
    if (gameStatus === "playing" && !state?.currentRound?.id) return;
    if (roundCommitPendingRef.current) return;
    if (peekedRef.current !== null || peekInFlightRef.current) return;
    peekInFlightRef.current = true;
    const epoch = peekEpochRef.current;
    void (async () => {
      try {
        const peeked = await peekNextSongDirect(gameCode, managerToken);
        // A Next round happened while we were peeking: this answer is stale.
        if (epoch !== peekEpochRef.current) return;
        if (!peeked) return; // pool exhausted -> Next round picks at the click
        peekedRef.current = peeked;
      } catch (err) {
        log("warn", "preload_peek_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        peekInFlightRef.current = false;
      }
    })();
  }

  // The live song has not started 10 s after its load (the player's own start
  // watch), or paused by itself right after starting. `retried`: the player
  // had loaded nothing, so it issued the load once more.
  //
  // A load that loaded nothing is also logged as yt_preload_error, the event
  // the hidden standby logged until 2026-10-31 and the one the weekly
  // dead-video scan (.github/workflows/dead-video-scan.yml) reads, with the
  // same fields (code, game_code, youtube_id, url, song_id, title, artist) plus
  // `stall`. So a song YouTube silently refuses still lands on the scan's list
  // ("no_bytes (unknown) · next-song preload"). Errors YouTube does report go
  // to yt_player_error, which the scan reads too.
  function handleStartStall(info: StartStallInfo, liveSong: Song | null) {
    log("warn", "yt_live_stall", {
      kind: "no_start",
      game_code: gameCode,
      state: String(info.state),
      loaded_fraction: String(info.loadedFraction),
      retried: String(info.retried),
      ...songFields(liveSong),
    });
    if (info.retried && info.videoId !== null) {
      log("warn", "yt_preload_error", {
        ...failedVideoContext(gameCode, NO_BYTES_CODE, info.videoId, [liveSong]),
        stall: "no_bytes",
      });
    }
  }

  function handleEarlyPause(msAfterStart: number, liveSong: Song | null) {
    log("warn", "yt_live_stall", {
      kind: "early_pause",
      game_code: gameCode,
      ms_after_start: String(Math.round(msAfterStart)),
      ...songFields(liveSong),
    });
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
      livePlayer()?.loadVideoById(song.youtube_id, song.start_time);
    } else {
      // Player not ready yet (first song): the load is deferred to
      // onPlayerReady, which issues loadVideoById and marks loadIssued there.
      player.enqueueSong({ youtube_id: song.youtube_id, start_time: song.start_time });
    }
  }

  // Resolve the open song-start span when the player actually starts playing,
  // then peek the song after it.
  function handlePlayerPlaying(detection: "statechange" | "poll") {
    if (songStartTimeoutRef.current !== null) {
      window.clearTimeout(songStartTimeoutRef.current);
      songStartTimeoutRef.current = null;
    }
    songStartRef.current?.playing(detection);
    songStartRef.current = null;
    livePlayingRef.current = true;
    maybePeekNext();
  }

  // Next round clicked: hold the peek until the new round is recorded.
  function beginRoundCommit() {
    roundCommitPendingRef.current = true;
    livePlayingRef.current = false;
  }

  // select_next_song settled. On success, peek now if the new song is already
  // playing (otherwise handlePlayerPlaying will). On failure the round did not
  // advance, so the song still playing is the right reference and the peek can
  // run at once (a rolled-back Next round has already restored peekedRef,
  // which makes this a no-op).
  function endRoundCommit(committed: boolean) {
    roundCommitPendingRef.current = false;
    if (!committed || livePlayingRef.current) maybePeekNext();
  }

  // A YouTube error on the player: logged with the failing song (title,
  // artist, id, URL) so it can be found and fixed, and toasted so the host
  // knows to move on. An error from a player that was never given a video is
  // neither: YouTube's empty embed sometimes raises its generic "An error
  // occurred" (code 2) on the waiting screen. No song failed and the idle
  // panel hides YouTube's screen, so it is only logged; the first load resets
  // it.
  function handlePlayerError(code: number, videoId: string | null, liveSong: Song | null) {
    if (videoId === null) {
      log("warn", "yt_idle_player_error", { code: String(code), game_code: gameCode });
      return;
    }
    const peeked = peekedRef.current;
    const peekedSong: SongRef | null = peeked
      ? {
          id: peeked.song_id,
          title: peeked.title,
          artist: peeked.artist,
          youtube_id: peeked.youtube_id,
        }
      : null;
    log(
      "warn",
      "yt_player_error",
      failedVideoContext(gameCode, code, videoId, [liveSong, peekedSong]),
    );
    toast("Video unavailable — click Next round to pick a different song.", {
      variant: "error",
    });
  }

  // onReady for the player. Drives the reactive ready gate (Start button) and
  // flushes any deferred first song into it.
  function onPlayerReady() {
    player.setReady();
    const queued = player.flushPendingSong();
    if (queued) {
      // This is the deferred first-song load; mark loadIssued here so the
      // song-start span's load_to_playing child measures from the real load.
      songStartRef.current?.loadIssued();
      armSongStartTimeout();
      livePlayer()?.loadVideoById(queued.youtube_id, queued.start_time);
    }
  }

  return {
    playerRef,
    onPlayerReady,
    handlePlayerPlaying,
    handlePlayerError,
    handleStartStall,
    handleEarlyPause,
    livePlayer,
    peekedRef,
    peekEpochRef,
    optimisticSongIdRef,
    songStartRef,
    loadSongIntoPlayer,
    armSongStartTimeout,
    maybePeekNext,
    beginSongStart,
    beginRoundCommit,
    endRoundCommit,
  };
}
