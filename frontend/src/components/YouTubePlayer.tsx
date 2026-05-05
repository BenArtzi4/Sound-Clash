import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import styles from "./YouTubePlayer.module.css";

export interface YouTubePlayerHandle {
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  pause: () => void;
  play: () => void;
  stop: () => void;
}

interface Props {
  hideOverlay?: boolean;
  onReady?: () => void;
}

interface YTPlayer {
  loadVideoById: (opts: { videoId: string; startSeconds?: number }) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  stopVideo: () => void;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    config: {
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
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

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer(
  { hideOverlay, onReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const YT = await loadApi();
      if (cancelled || !containerRef.current) return;
      playerRef.current = new YT.Player(containerRef.current, {
        width: "100%",
        height: "100%",
        playerVars: {
          modestbranding: 1,
          rel: 0,
          controls: 0,
          disablekb: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            setLoaded(true);
            onReady?.();
          },
        },
      });
    })();
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [onReady]);

  useImperativeHandle(
    ref,
    () => ({
      loadVideoById: (videoId, startSeconds) => {
        playerRef.current?.loadVideoById({
          videoId,
          startSeconds: startSeconds ?? 0,
        });
      },
      pause: () => playerRef.current?.pauseVideo(),
      play: () => playerRef.current?.playVideo(),
      stop: () => playerRef.current?.stopVideo(),
    }),
    [],
  );

  return (
    <div className={styles.wrapper}>
      <div ref={containerRef} className={styles.player} />
      <div className={`${styles.cover} ${hideOverlay && loaded ? styles.coverHidden : ""}`}>
        <span className={styles.loading}>{loaded ? "Ready" : "Loading player..."}</span>
      </div>
    </div>
  );
});
