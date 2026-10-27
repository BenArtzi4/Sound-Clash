import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { startPlayerInit } from "../lib/telemetry";
import { ForwardIcon, PauseIcon, PlayIcon, RewindIcon } from "./icons";
import styles from "./YouTubePlayer.module.css";

export interface YouTubePlayerHandle {
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  // Silently buffer a video in this (standby) player WITHOUT resolving any
  // song-start span: the player is muted, started, and frozen (paused) at the
  // start once it reaches PLAYING. Used by the double-buffer preload so the
  // *next* song is already downloaded by the time the host clicks Next round.
  // `onPlaying` is intentionally NOT fired for a prebuffer.
  prebuffer: (videoId: string, startSeconds?: number) => void;
  // Promote a prebuffered video to live playback: re-arm PLAYING detection,
  // seek to the start, unmute, and play. `onPlaying` fires on the resume, so
  // the measured load_to_playing is just the (near-zero) resume time. Falls
  // back gracefully to a normal play if the prebuffer hadn't finished.
  commitPrebuffered: (startSeconds?: number) => void;
  pause: () => void;
  play: () => void;
  // Resume playback ONLY if the player is currently paused (YT state 2). Used to
  // recover after the host's tab was backgrounded / phone locked, which pauses
  // the video. A no-op while playing/buffering and — crucially — when the clip
  // has ENDED, so a finished song is never silently replayed (a spoiler).
  resumeIfPaused: () => void;
  stop: () => void;
  // How the prebuffer this (standby) player is holding is doing, or null when
  // it holds none (never prebuffered, or since committed, loaded or stopped).
  // YouTube often sends no onError when a load fails: the player just sits
  // there, BUFFERING or UNSTARTED, with nothing loaded. So the console judges
  // a standby by what it has loaded, not by its state.
  prebufferStatus: () => PrebufferStatus | null;
  // Issue the held prebuffer's load again, KEEPING its age: Next round judges a
  // standby by the time since its song's first prebuffer, so a young retry
  // can't make a dead standby look fresh. A no-op unless a prebuffer is held
  // and has not frozen yet.
  retryPrebuffer: () => void;
}

export interface PrebufferStatus {
  // The prebuffer reached PLAYING and was frozen at its start: ready to commit.
  frozen: boolean;
  // YouTube's getVideoLoadedFraction(): 0 until the first media bytes arrive.
  loadedFraction: number;
  // YouTube's player state code, for telemetry only.
  state: number;
  // Visible time since the song's first prebuffer, added up across hidden
  // spells: time while the page is hidden doesn't count, because a hidden page
  // may not load at all.
  ageMs: number;
}

interface Props {
  // Overrides the wrapper's data-testid (default "youtube-player"). The
  // manager console renders two players (active + standby preload buffer); the
  // standby uses a distinct id ("youtube-player-preload") so E2E's strict
  // getByTestId("youtube-player") / "[...] iframe" locators still match exactly
  // one element.
  testId?: string;
  // When true, render only the iframe — no loading / ended / error /
  // buzz-pause overlay. The host loses the anti-spoiler protection of the
  // cover (YouTube's own "more videos" UI may briefly show between songs) in
  // exchange for an always-visible video. Errors surface via `onError` so the
  // parent can react inline (e.g. toast). The one exception is a player that
  // has never been given a video: a panel showing `idleLabel` covers it,
  // because YouTube's empty embed sometimes shows its own "An error occurred"
  // screen (code 2) on the host's waiting screen, where no song has failed.
  noCover?: boolean;
  // Text on the panel over a still-empty player in `noCover` mode.
  idleLabel?: string;
  // `noCover` mode only: the host's buttons over the picture (back 10 s,
  // pause / play, forward 10 s). They stay disabled until the song is playing.
  // Once it has played to its end, back replays its last 10 s, the centre
  // button replays it from its start point and forward is off. Give it only to
  // the live player: the hidden standby's buttons would still take keyboard
  // focus.
  controls?: boolean;
  // A team holds the buzz, so the song is paused for scoring and Play is
  // disabled (Wrong and Continue round restart it). Back / forward still move
  // the paused song, and it stays paused. After the end, back only picks the
  // point Wrong / Continue round start it from.
  holdPlayback?: boolean;
  hideOverlay?: boolean;
  // When true, keep the cover visible even while the video is loaded (used by
  // the manager view during a buzz / scoring pause so YouTube's pause-state
  // "more videos" tiles can't leak song titles to the room). Ignored when
  // `noCover` is true.
  coverWhilePaused?: boolean;
  onReady?: () => void;
  // `videoId` is the id this player was last asked to load or prebuffer (null
  // before the first load), so the parent can log WHICH video failed.
  onError?: (code: number, videoId: string | null) => void;
  // Fired the first time the player reaches PLAYING after a loadVideoById. The
  // YouTube IFrame API has no native "audio started" event, so we derive it
  // from onStateChange (PLAYING) with a bounded getPlayerState poll as a
  // fallback. Used to measure song-start latency; `detection` records which
  // mechanism fired. Fires at most once per load.
  onPlaying?: (detection: "statechange" | "poll") => void;
  // Telemetry for the rare song that stalls on the live player. Fired at most
  // once per load or commit, when the song has not reached PLAYING 10 s
  // later. Not fired when the page was hidden during the wait (a hidden page
  // may legitimately not play), after a newer load, after pause() or stop(),
  // or once this player became the standby.
  onStartStall?: (info: { state: number; loadedFraction: number }) => void;
  // Telemetry: the song paused by itself within 5 s of starting (no pause()
  // or stop() from the app, page visible). At most once per load or commit.
  onEarlyPause?: (msAfterStart: number) => void;
}

interface YTPlayer {
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  stopVideo: () => void;
  mute: () => void;
  unMute: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  getVideoLoadedFraction: () => number;
  destroy: () => void;
}

interface YTErrorEvent {
  data: number;
}

interface YTStateChangeEvent {
  data: number;
}

// YT.PlayerState.ENDED / PLAYING. We don't import the namespace at runtime
// because the IFrame API loads asynchronously; hard-coding the constants keeps
// the import surface flat.
const YT_STATE_ENDED = 0;
const YT_STATE_PLAYING = 1;
const YT_STATE_PAUSED = 2;
const YT_STATE_BUFFERING = 3;
// How far one tap of the host's back / forward buttons moves the song, and how
// long the "−10s" confirmation stays on the picture.
const SEEK_STEP_S = 10;
const SEEK_FLASH_MS = 900;
// getPlayerState poll cadence + cap for the PLAYING fallback (~6s).
const PLAY_POLL_MS = 250;
const PLAY_POLL_MAX_TICKS = 24;
// onStartStall waits this long for PLAYING. Real starts in prod Tempo took up
// to ~8.6 s, so a shorter wait would flag slow-but-fine starts.
const START_STALL_MS = 10_000;
// onEarlyPause only counts a pause this soon after PLAYING; later pauses are
// more likely the host tapping the video.
const EARLY_PAUSE_WINDOW_MS = 5_000;

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    config: {
      width?: string | number;
      height?: string | number;
      host?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onError?: (event: YTErrorEvent) => void;
        onStateChange?: (event: YTStateChangeEvent) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SCRIPT_SRC = "https://www.youtube.com/iframe_api";

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    if (!document.querySelector(`script[src="${SCRIPT_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

// Force English UI strings (hl=en) on the iframe chrome so a host whose
// browser is set to e.g. Hebrew doesn't see "הפעלת הסרטון" / "סרטונים נוספים"
// in the player overlay. `origin` lets the iframe validate inbound messages.
const EMBED_SRC =
  "https://www.youtube-nocookie.com/embed/?" +
  new URLSearchParams({
    enablejsapi: "1",
    origin: window.location.origin,
    modestbranding: "1",
    rel: "0",
    controls: "0",
    disablekb: "1",
    playsinline: "1",
    hl: "en",
  }).toString();

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  {
    testId = "youtube-player",
    noCover,
    hideOverlay,
    coverWhilePaused,
    onReady,
    onError,
    onPlaying,
    onStartStall,
    onEarlyPause,
    idleLabel,
    controls,
    holdPlayback,
  },
  ref,
) {
  const containerRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [errorCode, setErrorCode] = useState<number | null>(null);
  // True when the current video has played to its natural end. We cover the
  // iframe again so YouTube's endscreen tiles (which can include other songs
  // from the same channel even with rel=0) don't spoil future rounds.
  const [ended, setEnded] = useState(false);
  // False until this player is first asked to load or prebuffer a video; in
  // `noCover` mode the empty player is covered until then.
  const [hasVideo, setHasVideo] = useState(false);
  // What the host's buttons act on: "idle" until the current audible load
  // reaches PLAYING (and again once the player is stopped or turned into the
  // standby), then "playing" or "paused", and "ended" once the song has played
  // to its end (back replays its last seconds, the centre button replays it).
  const [transport, setTransport] = useState<"idle" | "playing" | "paused" | "ended">("idle");
  // The "−10s" / "+10s" confirmation on the picture. `n` remounts it so a
  // second tap restarts its fade.
  const [seekFlash, setSeekFlash] = useState<{ text: string; n: number } | null>(null);
  const seekFlashTimerRef = useRef<number | null>(null);
  // The host paused the song with the Pause button. resumeIfPaused leaves such
  // a song paused; play(), a new load, a commit and stop() clear it.
  const hostPausedRef = useRef(false);
  // The live song's start point (the round's start_time), whether it has
  // played to its end, and where it ended: stopVideo rewinds a finished song,
  // so the end is remembered here. Refs, so the []-memoised handle reads them.
  const songStartRef = useRef(0);
  const songEndedRef = useRef(false);
  const endedAtRef = useRef(0);
  // During a buzz after the end, the point the host picked with back: play()
  // (Wrong / Continue round) starts the song there. null: the start point.
  const replayFromRef = useRef<number | null>(null);
  // Where play() restarts a finished song: it plays from 0:00, so the first
  // PLAYING moves it here (see play()).
  const seekOnPlayRef = useRef<number | null>(null);

  // Stable callback handles so the mount effect can run with []. Inline
  // onReady/onError props from a parent that re-renders frequently would
  // otherwise tear down and rebuild the YT.Player every render -- the iframe
  // ends up with no videoId set (YT error 153) and the YouTube API/CDN gets
  // hammered (~10 req/s, hundreds of MB/min).
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  const onStartStallRef = useRef(onStartStall);
  const onEarlyPauseRef = useRef(onEarlyPause);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onPlayingRef.current = onPlaying;
    onStartStallRef.current = onStartStall;
    onEarlyPauseRef.current = onEarlyPause;
  });

  // PLAYING-detection state for the song-start measurement. `playingFiredRef`
  // dedupes the two sources (onStateChange + poll) so onPlaying fires once per
  // load; `playWatchRef` holds the bounded fallback poll's interval id. Cleared
  // inline (only refs are touched) so the run-once mount effect and the
  // imperative handle stay free of extra deps.
  const playingFiredRef = useRef(false);
  const playWatchRef = useRef<number | null>(null);

  // Double-buffer / preload state. When this player is the standby buffering
  // the *next* song, `prebufferingRef` is true: the first PLAYING is caught and
  // the player frozen (paused at the start), `onPlaying` is suppressed, and
  // `prebufferPausedRef` dedupes the freeze. `prebufferStartRef` remembers the
  // start offset so commitPrebuffered can seek back to it on resume. Refs (not
  // state) so the run-once mount effect and the []-memoised handle stay clean.
  const prebufferingRef = useRef(false);
  const prebufferPausedRef = useRef(false);
  const prebufferStartRef = useRef(0);
  // The video this player was last asked to load/prebuffer, reported with
  // onError so a failure can be traced to a catalog song.
  const videoIdRef = useRef<string | null>(null);

  // Load health, on Date.now() so fake timers move it. A visible-time clock:
  // `visibleMsRef` holds the visible time of past spells and
  // `visibleSpellStartRef` when the current visible spell began (null while
  // hidden). `prebufferVisibleAtRef` is the clock's reading when the song's
  // first prebuffer was issued, so a prebuffer's age is the visible time
  // since. `visibilityChangedAtRef` is when visibility last changed at all;
  // the start watch only counts a wait the page spent visible throughout.
  const visibleMsRef = useRef(0);
  const visibleSpellStartRef = useRef<number | null>(null);
  const prebufferVisibleAtRef = useRef(0);
  const visibilityChangedAtRef = useRef(0);
  // The start watch: one timer per audible load or commit. `startWatchGenRef`
  // is bumped by every load, prebuffer, commit and stop, so a watch armed for
  // an older load can never fire.
  const startWatchRef = useRef<number | null>(null);
  const startWatchGenRef = useRef(0);
  // Early pause: when the current load first reached PLAYING, whether it was
  // already reported, and whether the app itself asked this player to pause
  // (pause() for a buzz, stop() for a swap) since it last played.
  const playingAtRef = useRef(0);
  const earlyPauseReportedRef = useRef(false);
  const appPauseRef = useRef(false);

  useEffect(() => {
    if (document.visibilityState === "visible") visibleSpellStartRef.current = Date.now();
    const onVisibility = (): void => {
      const now = Date.now();
      visibilityChangedAtRef.current = now;
      const spellStart = visibleSpellStartRef.current;
      if (document.visibilityState === "visible") {
        if (spellStart === null) visibleSpellStartRef.current = now;
      } else if (spellStart !== null) {
        visibleMsRef.current += now - spellStart;
        visibleSpellStartRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Total visible time so far; only differences between readings mean anything.
  const visibleClock = useCallback((): number => {
    const spellStart = visibleSpellStartRef.current;
    return visibleMsRef.current + (spellStart === null ? 0 : Date.now() - spellStart);
  }, []);

  // Cancel any pending start watch and invalidate any already-queued fire.
  // Refs only, so it is stable for the []-memoised handle.
  const cancelStartWatch = useCallback(() => {
    startWatchGenRef.current += 1;
    if (startWatchRef.current !== null) {
      window.clearTimeout(startWatchRef.current);
      startWatchRef.current = null;
    }
  }, []);

  // Arm the start watch for the audible load or commit just issued.
  const armStartWatch = useCallback(() => {
    cancelStartWatch();
    const gen = startWatchGenRef.current;
    const armedAt = Date.now();
    startWatchRef.current = window.setTimeout(() => {
      startWatchRef.current = null;
      const player = playerRef.current;
      if (
        gen !== startWatchGenRef.current ||
        !player ||
        prebufferingRef.current ||
        playingFiredRef.current ||
        document.visibilityState !== "visible" ||
        visibilityChangedAtRef.current > armedAt
      ) {
        return;
      }
      onStartStallRef.current?.({
        state: player.getPlayerState(),
        loadedFraction: player.getVideoLoadedFraction() || 0,
      });
    }, START_STALL_MS);
  }, [cancelStartWatch]);

  // Arm (or re-arm) PLAYING detection for an audible load: reset the dedupe
  // flag and start the bounded fallback poll in case onStateChange(PLAYING) is
  // coalesced or missed. The poll self-clears once PLAYING is seen or the cap
  // hits, and never fires while this player is prebuffering. Closes over refs
  // only, so it is stable and safe to reference from the []-memoised handle.
  const armPlaying = useCallback(() => {
    playingFiredRef.current = false;
    if (playWatchRef.current !== null) window.clearInterval(playWatchRef.current);
    let ticks = 0;
    playWatchRef.current = window.setInterval(() => {
      ticks += 1;
      if (
        !playingFiredRef.current &&
        !prebufferingRef.current &&
        playerRef.current?.getPlayerState() === YT_STATE_PLAYING
      ) {
        // As in onStateChange(PLAYING): the song plays, so any app pause is over.
        appPauseRef.current = false;
        setTransport("playing");
        playingFiredRef.current = true;
        playingAtRef.current = Date.now();
        earlyPauseReportedRef.current = false;
        onPlayingRef.current?.("poll");
      }
      if (
        (playingFiredRef.current || ticks >= PLAY_POLL_MAX_TICKS) &&
        playWatchRef.current !== null
      ) {
        window.clearInterval(playWatchRef.current);
        playWatchRef.current = null;
      }
    }, PLAY_POLL_MS);
  }, []);

  // Play a song that ended again, from `seconds`. A finished song was stopped,
  // and on a stopped video both playVideo and seekTo start it at 0:00
  // (measured on prod 2026-10-27), so it is loaded again at that point. Refs
  // and state setters only, so it is stable for the []-memoised handle.
  const replay = useCallback((seconds: number) => {
    const player = playerRef.current;
    const videoId = videoIdRef.current;
    if (!player || !videoId) return;
    songEndedRef.current = false;
    replayFromRef.current = null;
    seekOnPlayRef.current = null;
    hostPausedRef.current = false;
    setEnded(false);
    setTransport("playing");
    player.loadVideoById({ videoId, startSeconds: seconds });
  }, []);

  // We render the iframe ourselves (rather than letting YT.Player replace a
  // div) and wait for its `load` event before attaching the API. Otherwise
  // www-widgetapi.js starts a postMessage poll targeted at youtube-nocookie.com
  // while the iframe is still at about:blank, and every ping logs a
  // "target origin does not match" warning until the iframe finishes
  // navigating. Privacy-enhanced mode (youtube-nocookie) also suppresses the
  // doubleclick conversion-pixel CORS errors that the regular youtube.com
  // host emits once a video plays.
  useEffect(() => {
    let cancelled = false;
    const playerInit = startPlayerInit();
    void (async () => {
      const apiCached = !!window.YT?.Player;
      const YT = await loadApi();
      if (cancelled || !containerRef.current) return;
      playerInit.apiLoaded(apiCached);
      const iframe = containerRef.current;
      await new Promise<void>((resolve) => {
        if (iframe.dataset.ytLoaded === "1") {
          resolve();
          return;
        }
        const onLoad = (): void => {
          iframe.removeEventListener("load", onLoad);
          iframe.dataset.ytLoaded = "1";
          resolve();
        };
        iframe.addEventListener("load", onLoad);
      });
      if (cancelled) return;
      playerRef.current = new YT.Player(iframe, {
        events: {
          onReady: () => {
            setErrorCode(null);
            setLoaded(true);
            playerInit.ready();
            onReadyRef.current?.();
          },
          onError: (event) => {
            setErrorCode(event.data);
            onErrorRef.current?.(event.data, videoIdRef.current);
          },
          onStateChange: (event) => {
            if (event.data === YT_STATE_PLAYING) {
              if (prebufferingRef.current) {
                // Standby buffering the next song: it has now downloaded enough
                // to play, so freeze it (paused, buffered) and do NOT resolve
                // the song-start span. commitPrebuffered will resume it later.
                if (!prebufferPausedRef.current) {
                  prebufferPausedRef.current = true;
                  playerRef.current?.pauseVideo();
                }
              } else {
                appPauseRef.current = false;
                setTransport("playing");
                const seekTo = seekOnPlayRef.current;
                if (seekTo !== null) {
                  seekOnPlayRef.current = null;
                  playerRef.current?.seekTo(seekTo, true);
                }
                if (!playingFiredRef.current) {
                  playingFiredRef.current = true;
                  playingAtRef.current = Date.now();
                  earlyPauseReportedRef.current = false;
                  if (playWatchRef.current !== null) {
                    window.clearInterval(playWatchRef.current);
                    playWatchRef.current = null;
                  }
                  onPlayingRef.current?.("statechange");
                }
              }
            }
            if (
              event.data === YT_STATE_PAUSED &&
              !prebufferingRef.current &&
              playingFiredRef.current
            ) {
              setTransport("paused");
            }
            if (
              event.data === YT_STATE_PAUSED &&
              !prebufferingRef.current &&
              playingFiredRef.current &&
              !appPauseRef.current &&
              !earlyPauseReportedRef.current &&
              document.visibilityState === "visible"
            ) {
              const msAfterStart = Date.now() - playingAtRef.current;
              if (msAfterStart <= EARLY_PAUSE_WINDOW_MS) {
                earlyPauseReportedRef.current = true;
                onEarlyPauseRef.current?.(msAfterStart);
              }
            }
            if (event.data === YT_STATE_ENDED) {
              const player = playerRef.current;
              if (!prebufferingRef.current) {
                endedAtRef.current = player?.getDuration() || player?.getCurrentTime() || 0;
                songEndedRef.current = true;
                replayFromRef.current = null;
                seekOnPlayRef.current = null;
              }
              setEnded(true);
              setTransport(prebufferingRef.current ? "idle" : "ended");
              player?.stopVideo();
            }
          },
        },
      });
    })();
    return () => {
      cancelled = true;
      if (playWatchRef.current !== null) {
        window.clearInterval(playWatchRef.current);
        playWatchRef.current = null;
      }
      cancelStartWatch();
      if (seekFlashTimerRef.current !== null) window.clearTimeout(seekFlashTimerRef.current);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [cancelStartWatch]);

  useImperativeHandle(
    ref,
    () => ({
      loadVideoById: (videoId, startSeconds) => {
        // A direct, audible load — cancel any prebuffer mode this player may
        // have been in and make sure it isn't left muted from a prior prebuffer.
        prebufferingRef.current = false;
        prebufferPausedRef.current = false;
        setEnded(false);
        // Clear any error from a previous song so the cover (when in
        // covered mode) doesn't keep showing "Video unavailable" for what
        // is now a different, valid video.
        setErrorCode(null);
        setHasVideo(true);
        // A new song: no app pause of it yet (a stop() at the last swap was
        // for the previous one).
        appPauseRef.current = false;
        hostPausedRef.current = false;
        songEndedRef.current = false;
        replayFromRef.current = null;
        seekOnPlayRef.current = null;
        songStartRef.current = startSeconds ?? 0;
        setTransport("idle");
        armPlaying();
        armStartWatch();
        videoIdRef.current = videoId;
        playerRef.current?.unMute();
        playerRef.current?.loadVideoById({
          videoId,
          startSeconds: startSeconds ?? 0,
        });
      },
      prebuffer: (videoId, startSeconds) => {
        // Buffer the next song silently. Mute first so the room never hears it,
        // and arm prebuffer mode so onStateChange freezes it at the start
        // without firing onPlaying. Any in-flight PLAYING detection from a
        // previous (audible) load on this player is torn down.
        prebufferingRef.current = true;
        prebufferPausedRef.current = false;
        prebufferStartRef.current = startSeconds ?? 0;
        if (playWatchRef.current !== null) {
          window.clearInterval(playWatchRef.current);
          playWatchRef.current = null;
        }
        setEnded(false);
        setErrorCode(null);
        setHasVideo(true);
        hostPausedRef.current = false;
        songEndedRef.current = false;
        replayFromRef.current = null;
        seekOnPlayRef.current = null;
        setTransport("idle");
        prebufferVisibleAtRef.current = visibleClock();
        cancelStartWatch();
        videoIdRef.current = videoId;
        playerRef.current?.mute();
        playerRef.current?.loadVideoById({
          videoId,
          startSeconds: prebufferStartRef.current,
        });
      },
      commitPrebuffered: (startSeconds) => {
        // Promote the standby's buffered video to live playback. Leaving
        // prebuffer mode first means the next PLAYING resolves the song-start
        // span. seekTo + unMute + playVideo resumes from the buffered start
        // near-instantly when prebuffer finished; if it hadn't, the same calls
        // simply let the in-flight load play through (still faster than a cold
        // load, and correctly measured).
        const start = startSeconds ?? prebufferStartRef.current;
        prebufferingRef.current = false;
        prebufferPausedRef.current = false;
        setEnded(false);
        setErrorCode(null);
        appPauseRef.current = false;
        hostPausedRef.current = false;
        songEndedRef.current = false;
        replayFromRef.current = null;
        seekOnPlayRef.current = null;
        songStartRef.current = start;
        setTransport("idle");
        armPlaying();
        armStartWatch();
        playerRef.current?.seekTo(start, true);
        playerRef.current?.unMute();
        playerRef.current?.playVideo();
      },
      pause: () => {
        // A buzz can pause a song before it ever started; that is no stall.
        appPauseRef.current = true;
        cancelStartWatch();
        playerRef.current?.pauseVideo();
      },
      play: () => {
        // Wrong / Continue round restart the song, also one the host paused.
        hostPausedRef.current = false;
        // A song that played to its end was stopped, and playVideo starts it
        // at 0:00. A reload at the point (as the buttons do) is not used here:
        // Wrong / Continue call play() after an RPC await, where a fresh load
        // can be blocked autoplay on iOS. So it plays as before, and its first
        // PLAYING moves it to the point the host picked with back during the
        // buzz, else to where the round started.
        if (songEndedRef.current) {
          const from = replayFromRef.current ?? songStartRef.current;
          songEndedRef.current = false;
          replayFromRef.current = null;
          seekOnPlayRef.current = null;
          setEnded(false);
          setTransport("playing");
          seekOnPlayRef.current = from > 0 ? from : null;
        }
        playerRef.current?.playVideo();
      },
      resumeIfPaused: () => {
        // Only resume from a genuine PAUSED state so a finished (ENDED) clip is
        // never replayed and a live/buffering/idle player is left untouched.
        // A song the host paused stays paused.
        if (hostPausedRef.current) return;
        if (playerRef.current?.getPlayerState() === YT_STATE_PAUSED) {
          playerRef.current.playVideo();
        }
      },
      stop: () => {
        // A stopped player holds no prebuffer and has no start to watch.
        prebufferingRef.current = false;
        prebufferPausedRef.current = false;
        appPauseRef.current = true;
        hostPausedRef.current = false;
        songEndedRef.current = false;
        replayFromRef.current = null;
        seekOnPlayRef.current = null;
        cancelStartWatch();
        setEnded(true);
        setTransport("idle");
        playerRef.current?.stopVideo();
      },
      retryPrebuffer: () => {
        const videoId = videoIdRef.current;
        if (!prebufferingRef.current || prebufferPausedRef.current || !videoId) return;
        playerRef.current?.mute();
        playerRef.current?.loadVideoById({ videoId, startSeconds: prebufferStartRef.current });
      },
      prebufferStatus: () => {
        const player = playerRef.current;
        if (!player || !prebufferingRef.current) return null;
        return {
          frozen: prebufferPausedRef.current,
          loadedFraction: player.getVideoLoadedFraction() || 0,
          state: player.getPlayerState(),
          ageMs: visibleClock() - prebufferVisibleAtRef.current,
        };
      },
    }),
    [armPlaying, armStartWatch, cancelStartWatch, visibleClock],
  );

  // The "−10s" / "+10s" confirmation for a jump.
  function showSeekFlash(deltaSeconds: number): void {
    const text = deltaSeconds < 0 ? `−${-deltaSeconds}s` : `+${deltaSeconds}s`;
    setSeekFlash((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));
    if (seekFlashTimerRef.current !== null) window.clearTimeout(seekFlashTimerRef.current);
    seekFlashTimerRef.current = window.setTimeout(() => {
      seekFlashTimerRef.current = null;
      setSeekFlash(null);
    }, SEEK_FLASH_MS);
  }

  // The host's back / forward buttons. Before the song starts and while this
  // player holds a prebuffer there is nothing to move. YouTube keeps a paused
  // song paused across seekTo, so a jump during a buzz stays silent.
  function seekBy(deltaSeconds: number): void {
    const player = playerRef.current;
    if (!player || prebufferingRef.current) return;
    if (transport === "ended") {
      // The song played to its end: back replays its last seconds (forward has
      // nothing to skip to). During a buzz back only picks the point, and the
      // song stays silent until Wrong or Continue round plays it from there.
      if (deltaSeconds >= 0) return;
      const target = Math.max(0, (replayFromRef.current ?? endedAtRef.current) + deltaSeconds);
      if (holdPlayback) replayFromRef.current = target;
      else replay(target);
      showSeekFlash(deltaSeconds);
      return;
    }
    const state = player.getPlayerState();
    if (state !== YT_STATE_PLAYING && state !== YT_STATE_PAUSED && state !== YT_STATE_BUFFERING) {
      return;
    }
    const now = player.getCurrentTime() || 0;
    const duration = player.getDuration() || 0;
    let target = Math.max(0, now + deltaSeconds);
    // Stop a second short of the end: a jump past it would end the song.
    if (duration > 0) target = Math.min(target, Math.max(now, duration - 1));
    player.seekTo(target, true);
    showSeekFlash(deltaSeconds);
  }

  // The host's Pause / Play button, Replay once the song has ended.
  function togglePlayback(): void {
    const player = playerRef.current;
    if (!player || holdPlayback) return;
    if (transport === "playing") {
      // An app pause for the early-pause telemetry, and no start to watch.
      hostPausedRef.current = true;
      appPauseRef.current = true;
      cancelStartWatch();
      player.pauseVideo();
      setTransport("paused");
    } else if (transport === "paused") {
      hostPausedRef.current = false;
      player.playVideo();
      setTransport("playing");
    } else if (transport === "ended") {
      replay(songStartRef.current);
    }
  }

  if (noCover) {
    // No-cover mode: just the iframe, plus the idle panel until the first
    // video. Parents handle error UX themselves via the onError callback (e.g.
    // surface a toast). data-testid + data-ready are preserved because E2E
    // specs assert on them.
    return (
      <div className={styles.wrapper} data-testid={testId} data-ready={loaded}>
        <iframe
          ref={containerRef}
          className={styles.player}
          src={EMBED_SRC}
          title="YouTube player"
          allow="autoplay; encrypted-media"
          allowFullScreen
        />
        {hasVideo ? null : (
          <div className={styles.cover} data-testid={`${testId}-idle`}>
            {idleLabel ? <span className={styles.loading}>{idleLabel}</span> : null}
          </div>
        )}
        {controls && hasVideo ? (
          <div className={styles.transport}>
            <button
              type="button"
              className={styles.transportBtn}
              onClick={() => seekBy(-SEEK_STEP_S)}
              disabled={transport === "idle"}
              aria-label={`Back ${SEEK_STEP_S} seconds`}
              data-testid={`${testId}-back`}
            >
              <RewindIcon />
              <span>{SEEK_STEP_S}</span>
            </button>
            <button
              type="button"
              className={`${styles.transportBtn} ${styles.transportToggle}`}
              onClick={togglePlayback}
              disabled={transport === "idle" || holdPlayback}
              aria-label={
                transport === "ended"
                  ? "Replay the song"
                  : transport === "paused"
                    ? "Play the song"
                    : "Pause the song"
              }
              data-testid={`${testId}-toggle`}
            >
              {transport === "ended" ? (
                <RewindIcon />
              ) : transport === "paused" ? (
                <PlayIcon />
              ) : (
                <PauseIcon />
              )}
            </button>
            <button
              type="button"
              className={styles.transportBtn}
              onClick={() => seekBy(SEEK_STEP_S)}
              disabled={transport === "idle" || transport === "ended"}
              aria-label={`Forward ${SEEK_STEP_S} seconds`}
              data-testid={`${testId}-forward`}
            >
              <span>{SEEK_STEP_S}</span>
              <ForwardIcon />
            </button>
            {seekFlash ? (
              <span key={seekFlash.n} className={styles.seekFlash} aria-hidden="true">
                {seekFlash.text}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const overlayHidden = hideOverlay && loaded && errorCode === null && !ended && !coverWhilePaused;
  // When the video is loaded but the parent is covering it during a buzz
  // pause, show no copy at all -- "Ready" was leftover from the pre-load
  // state and reads as a YouTube splash. The cover still hides the iframe.
  const showLabel = errorCode !== null || ended || !loaded;
  return (
    <div className={styles.wrapper} data-testid={testId} data-ready={loaded}>
      <iframe
        ref={containerRef}
        className={styles.player}
        src={EMBED_SRC}
        title="YouTube player"
        allow="autoplay; encrypted-media"
        allowFullScreen
      />
      <div
        className={`${styles.cover} ${overlayHidden ? styles.coverHidden : ""}`}
        role={errorCode !== null ? "alert" : undefined}
      >
        {showLabel ? (
          errorCode !== null ? (
            <span className={styles.error}>Video unavailable; manager can pick a new song.</span>
          ) : ended ? (
            <span className={styles.loading}>Song ended</span>
          ) : (
            <span className={styles.loading}>Loading player...</span>
          )
        ) : null}
      </div>
    </div>
  );
});
