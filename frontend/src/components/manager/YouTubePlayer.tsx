import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import '../../styles/components/youtube-player.css';

interface YouTubePlayerProps {
  videoId: string | null;
  startTime?: number;
  autoplay?: boolean;
  onReady?: (player: any) => void;
  onStateChange?: (state: number) => void;
}

export interface YouTubePlayerHandle {
  play: () => void;
  pause: () => void;
  stop: () => void;
  seekTo: (seconds: number) => void;
  restart: () => void;
  getPlayer: () => any;
}

// YouTube Player States
export const YT_PLAYER_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(({
  videoId,
  startTime = 5,
  autoplay = false,
  onReady,
  onStateChange,
}, ref) => {
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [playerState, setPlayerState] = useState<number>(YT_PLAYER_STATES.UNSTARTED);

  // Load YouTube IFrame API
  useEffect(() => {
    // Check if API is already loaded
    if ((window as any).YT && (window as any).YT.Player) {
      return;
    }

    // Load YouTube IFrame API script
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    // Set up callback for when API is ready
    (window as any).onYouTubeIframeAPIReady = () => {
      console.log('[YouTube] IFrame API Ready');
    };
  }, []);

  // Initialize player when videoId changes
  useEffect(() => {
    if (!videoId || !containerRef.current) {
      return;
    }

    // Wait for API to be ready
    const initPlayer = () => {
      if (!(window as any).YT || !(window as any).YT.Player) {
        setTimeout(initPlayer, 100);
        return;
      }

      // Destroy existing player
      if (playerRef.current) {
        playerRef.current.destroy();
      }

      // Create new player
      playerRef.current = new (window as any).YT.Player(containerRef.current, {
        videoId: videoId,
        playerVars: {
          start: startTime,
          autoplay: autoplay ? 1 : 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          fs: 1,
        },
        events: {
          onReady: (event: any) => {
            console.log('[YouTube] Player ready');
            setIsPlayerReady(true);
            onReady?.(event.target);
            
            // Auto-start if enabled
            if (autoplay) {
              event.target.playVideo();
            }
          },
          onStateChange: (event: any) => {
            console.log('[YouTube] State changed:', event.data);
            setPlayerState(event.data);
            onStateChange?.(event.data);
          },
          onError: (event: any) => {
            console.error('[YouTube] Player error:', event.data);
          },
        },
      });
    };

    initPlayer();

    // Cleanup
    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, [videoId, startTime, autoplay, onReady, onStateChange]);

  // Player control methods
  const play = () => {
    if (playerRef.current && isPlayerReady) {
      playerRef.current.playVideo();
    }
  };

  const pause = () => {
    if (playerRef.current && isPlayerReady) {
      playerRef.current.pauseVideo();
    }
  };

  const stop = () => {
    if (playerRef.current && isPlayerReady) {
      playerRef.current.stopVideo();
    }
  };

  const seekTo = (seconds: number) => {
    if (playerRef.current && isPlayerReady) {
      playerRef.current.seekTo(seconds, true);
    }
  };

  const restart = () => {
    seekTo(startTime);
    play();
  };

  // Expose control methods to parent via ref
  useImperativeHandle(ref, () => ({
    play,
    pause,
    stop,
    seekTo,
    restart,
    getPlayer: () => playerRef.current,
  }));

  const getStateText = () => {
    switch (playerState) {
      case YT_PLAYER_STATES.PLAYING:
        return 'Playing';
      case YT_PLAYER_STATES.PAUSED:
        return 'Paused';
      case YT_PLAYER_STATES.BUFFERING:
        return 'Buffering...';
      case YT_PLAYER_STATES.ENDED:
        return 'Ended';
      case YT_PLAYER_STATES.CUED:
        return 'Ready';
      default:
        return 'Not Started';
    }
  };

  if (!videoId) {
    return (
      <div className="youtube-player-placeholder">
        <div className="placeholder-content">
          <div className="placeholder-icon">🎵</div>
          <p>No song selected</p>
          <p className="placeholder-hint">Start a round to load the song</p>
        </div>
      </div>
    );
  }

  return (
    <div className="youtube-player-container">
      <div className="youtube-player-wrapper">
        <div ref={containerRef} className="youtube-player-iframe" />
      </div>
      
      <div className="youtube-player-info">
        <span className="player-status">{getStateText()}</span>
        {isPlayerReady && (
          <div className="player-controls">
            {playerState !== YT_PLAYER_STATES.PLAYING ? (
              <button className="control-btn play-btn" onClick={play} title="Play">
                ▶️ Play
              </button>
            ) : (
              <button className="control-btn pause-btn" onClick={pause} title="Pause">
                ⏸ Pause
              </button>
            )}
            <button
              className="control-btn restart-btn"
              onClick={() => seekTo(startTime)}
              title="Restart from start time"
            >
              ⏮ Restart
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

YouTubePlayer.displayName = 'YouTubePlayer';

export default YouTubePlayer;
