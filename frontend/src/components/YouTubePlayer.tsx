import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { startPlayerInit } from "../lib/telemetry";
import styles from "./YouTubePlayer.module.css";

export interface YouTubePlayerHandle {
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  pause: () => void;
  play: () => void;
  stop: () => void;
}

interface Props {
  // When true, render only the iframe — no cover element, no loading / ended /
  // error / buzz-pause overlay. The host loses the anti-spoiler protection of
  // the cover (YouTube's own "more videos" UI may briefly show between songs)
  // in exchange for an always-visible video. Errors surface via `onError` so
  // the parent can react inline (e.g. toast).
  noCover?: boolean;
  hideOverlay?: boolean;
  // When true, keep the cover visible even while the video is loaded (used by
  // the manager view during a buzz / scoring pause so YouTube's pause-state
  // "more videos" tiles can't leak song titles to the room). Ignored when
  // `noCover` is true.
  coverWhilePaused?: boolean;
  onReady?: () => void;
  onError?: (code: number) => void;
  // Fired the first time the player reaches PLAYING after a loadVideoById. The
  // YouTube IFrame API has no native "audio started" event, so we derive it
  // from onStateChange (PLAYING) with a bounded getPlayerState poll as a
  // fallback. Used to measure song-start latency; `detection` records which
  // mechanism fired. Fires at most once per load.
  onPlaying?: (detection: "statechange" | "poll") => void;
}

interface YTPlayer {
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  stopVideo: () => void;
  getPlayerState: () => number;
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
// getPlayerState poll cadence + cap for the PLAYING fallback (~6s).
const PLAY_POLL_MS = 250;
const PLAY_POLL_MAX_TICKS = 24;

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
  { noCover, hideOverlay, coverWhilePaused, onReady, onError, onPlaying },
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

  // Stable callback handles so the mount effect can run with []. Inline
  // onReady/onError props from a parent that re-renders frequently would
  // otherwise tear down and rebuild the YT.Player every render -- the iframe
  // ends up with no videoId set (YT error 153) and the YouTube API/CDN gets
  // hammered (~10 req/s, hundreds of MB/min).
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const onPlayingRef = useRef(onPlaying);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
    onPlayingRef.current = onPlaying;
  });

  // PLAYING-detection state for the song-start measurement. `playingFiredRef`
  // dedupes the two sources (onStateChange + poll) so onPlaying fires once per
  // load; `playWatchRef` holds the bounded fallback poll's interval id. Cleared
  // inline (only refs are touched) so the run-once mount effect and the
  // imperative handle stay free of extra deps.
  const playingFiredRef = useRef(false);
  const playWatchRef = useRef<number | null>(null);

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
            onErrorRef.current?.(event.data);
          },
          onStateChange: (event) => {
            if (event.data === YT_STATE_PLAYING && !playingFiredRef.current) {
              playingFiredRef.current = true;
              if (playWatchRef.current !== null) {
                window.clearInterval(playWatchRef.current);
                playWatchRef.current = null;
              }
              onPlayingRef.current?.("statechange");
            }
            if (event.data === YT_STATE_ENDED) {
              setEnded(true);
              playerRef.current?.stopVideo();
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
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      loadVideoById: (videoId, startSeconds) => {
        setEnded(false);
        // Clear any error from a previous song so the cover (when in
        // covered mode) doesn't keep showing "Video unavailable" for what
        // is now a different, valid video.
        setErrorCode(null);
        // Arm PLAYING detection for this load: reset the dedupe flag and start
        // a bounded fallback poll in case onStateChange(PLAYING) is coalesced
        // or missed. The poll self-clears once PLAYING is seen or the cap hits.
        playingFiredRef.current = false;
        if (playWatchRef.current !== null) window.clearInterval(playWatchRef.current);
        let ticks = 0;
        playWatchRef.current = window.setInterval(() => {
          ticks += 1;
          if (
            !playingFiredRef.current &&
            playerRef.current?.getPlayerState() === YT_STATE_PLAYING
          ) {
            playingFiredRef.current = true;
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
        playerRef.current?.loadVideoById({
          videoId,
          startSeconds: startSeconds ?? 0,
        });
      },
      pause: () => playerRef.current?.pauseVideo(),
      play: () => playerRef.current?.playVideo(),
      stop: () => {
        setEnded(true);
        playerRef.current?.stopVideo();
      },
    }),
    [],
  );

  if (noCover) {
    // No-cover mode: just the iframe. Parents handle error UX themselves via
    // the onError callback (e.g. surface a toast). data-testid + data-ready
    // are preserved because E2E specs assert on them.
    return (
      <div className={styles.wrapper} data-testid="youtube-player" data-ready={loaded}>
        <iframe
          ref={containerRef}
          className={styles.player}
          src={EMBED_SRC}
          title="YouTube player"
          allow="autoplay; encrypted-media"
          allowFullScreen
        />
      </div>
    );
  }

  const overlayHidden = hideOverlay && loaded && errorCode === null && !ended && !coverWhilePaused;
  // When the video is loaded but the parent is covering it during a buzz
  // pause, show no copy at all -- "Ready" was leftover from the pre-load
  // state and reads as a YouTube splash. The cover still hides the iframe.
  const showLabel = errorCode !== null || ended || !loaded;
  return (
    <div className={styles.wrapper} data-testid="youtube-player" data-ready={loaded}>
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
