import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useManagerWebSocket } from '../../hooks/useManagerWebSocket';
import YouTubePlayer, { YouTubePlayerHandle } from '../../components/manager/YouTubePlayer';
import CorrectAnswersCard from '../../components/manager/CorrectAnswersCard';
import EvaluationPanel from '../../components/manager/EvaluationPanel';
import RoundControls from '../../components/manager/RoundControls';
import '../../styles/pages/manager-console.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001';

type RoundState = 'idle' | 'active' | 'completed';

interface Song {
  id: number;
  title: string;
  artist: string;
  youtube_id: string;
  start_time: number;
  is_soundtrack?: boolean;
}

const ManagerConsoleNew: React.FC = () => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();

  const [roundState, setRoundState] = useState<RoundState>('idle');
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [lockedComponents, setLockedComponents] = useState({
    song_name: false,
    artist_content: false,
  });
  const [evaluating, setEvaluating] = useState(false);
  const [availableSongs, setAvailableSongs] = useState<Song[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [playedSongIds, setPlayedSongIds] = useState<Set<number>>(new Set());

  // Ref for YouTube player controls
  const youtubePlayerRef = useRef<YouTubePlayerHandle>(null);

  // WebSocket connection with sendMessage
  const { isConnected, gameState, error, sendMessage } = useManagerWebSocket({
    gameCode: gameCode || '',
    onGameStarted: () => {
      console.log('[Manager] Game started');
    },
    onRoundStarted: (round) => {
      console.log('[Manager] Round started:', round);
      setCurrentSong(round.song as Song);
      setRoundState('active');
      setLockedComponents({ song_name: false, artist_content: false });
    },
    onBuzzerLocked: (buzz) => {
      console.log('[Manager] Buzzer locked:', buzz);
      // Pause the YouTube player when a team buzzes
      if (youtubePlayerRef.current) {
        console.log('[Manager] Pausing YouTube player due to buzz');
        youtubePlayerRef.current.pause();
      }
    },
    onRoundCompleted: () => {
      console.log('[Manager] Round completed');
      setRoundState('completed');
    },
    onGameFinished: (result) => {
      console.log('[Manager] Game finished:', result);
      alert(`Game finished! Winner: ${result.winner}`);
      navigate('/');
    },
  });

  // Fetch songs filtered by game genres
  useEffect(() => {
    const fetchSongs = async () => {
      // Wait for game settings to be available
      if (!gameCode) return;

      setLoadingSongs(true);
      try {
        // First, get game settings to retrieve selected genres
        const ALB_URL = import.meta.env.VITE_ALB_URL || 'http://localhost:8002';
        const gameStatusResponse = await fetch(`${ALB_URL}/api/game/${gameCode}/status`);

        if (!gameStatusResponse.ok) {
          console.error('[Manager] Failed to fetch game status');
          return;
        }

        const gameStatus = await gameStatusResponse.json();
        const selectedGenres = gameStatus.settings?.genres || [];

        console.log('[Manager] Game genres:', selectedGenres);

        // Use /select endpoint with genre filtering
        const response = await fetch(`${API_URL}/api/songs/select`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            genres: selectedGenres,
            limit: 100
          })
        });

        if (response.ok) {
          const data = await response.json();
          setAvailableSongs(data.songs || []);
          console.log('[Manager] Loaded', data.songs?.length || 0, 'songs filtered by genres:', selectedGenres);
        }
      } catch (err) {
        console.error('[Manager] Failed to fetch songs:', err);
      } finally {
        setLoadingSongs(false);
      }
    };
    fetchSongs();
  }, [gameCode]);

  // Start round - select random song and send WebSocket message
  const startRound = useCallback(() => {
    if (availableSongs.length === 0) {
      alert('No songs available. Please add songs to the database first.');
      return;
    }

    // Filter out already played songs
    const unplayedSongs = availableSongs.filter(song => !playedSongIds.has(song.id));

    if (unplayedSongs.length === 0) {
      alert('All songs have been played! No more unique songs available.');
      return;
    }

    // Select random song from unplayed songs
    const randomIndex = Math.floor(Math.random() * unplayedSongs.length);
    const selectedSong = unplayedSongs[randomIndex];

    console.log('[Manager] Starting round with song:', selectedSong.title);
    console.log('[Manager] Played songs:', playedSongIds.size, 'Unplayed:', unplayedSongs.length);

    // Add to played songs
    setPlayedSongIds(prev => new Set(prev).add(selectedSong.id));

    // Send WebSocket message to start round
    sendMessage({
      type: 'start_round',
      song: {
        id: selectedSong.id,
        title: selectedSong.title,
        artist: selectedSong.artist,
        youtube_id: selectedSong.youtube_id,
        start_time: selectedSong.start_time || 5,
        is_soundtrack: selectedSong.is_soundtrack || false,
      },
    });
  }, [availableSongs, playedSongIds, sendMessage]);

  // Evaluate answer - send WebSocket message
  const evaluateAnswer = useCallback(
    (songCorrect: boolean, artistCorrect: boolean, wrongAnswer: boolean) => {
      if (!gameState.buzzedTeam) return;

      setEvaluating(true);
      console.log('[Manager] Evaluating answer:', { songCorrect, artistCorrect, wrongAnswer });

      // Send WebSocket message
      sendMessage({
        type: 'evaluate_answer',
        song_correct: songCorrect,
        artist_correct: artistCorrect,
        wrong_answer: wrongAnswer,
      });

      // Update locked components locally (will be confirmed by server)
      setLockedComponents((prev) => ({
        song_name: prev.song_name || songCorrect,
        artist_content: prev.artist_content || artistCorrect,
      }));

      setEvaluating(false);
    },
    [gameState.buzzedTeam, sendMessage]
  );

  // Continue song - resume playback after buzz and reset buzzers
  const continueSong = useCallback(() => {
    console.log('[Manager] Continuing song');
    // Send WebSocket message to reset buzzers on backend
    sendMessage({
      type: 'continue_song',
    });
    // Resume YouTube playback
    if (youtubePlayerRef.current) {
      youtubePlayerRef.current.play();
    }
  }, [sendMessage]);

  // Finish round - complete round when both components are answered
  const finishRound = useCallback(() => {
    console.log('[Manager] Finishing round - both components answered');
    sendMessage({
      type: 'skip_round',  // Uses same backend message as skip
    });
    setRoundState('completed');
  }, [sendMessage]);

  // Skip round - send WebSocket message
  const skipRound = useCallback(() => {
    console.log('[Manager] Skipping round');
    sendMessage({
      type: 'skip_round',
    });
    setRoundState('completed');
  }, [sendMessage]);

  // Next round - reset local state
  const nextRound = useCallback(() => {
    setRoundState('idle');
    setCurrentSong(null);
    setLockedComponents({ song_name: false, artist_content: false });
  }, []);

  // Start game - send WebSocket message to transition from waiting to playing
  const startGame = useCallback(() => {
    console.log('[Manager] Starting game');
    sendMessage({
      type: 'start_game',
    });
  }, [sendMessage]);

  // End game - send WebSocket message
  const endGame = useCallback(() => {
    console.log('[Manager] Ending game');
    sendMessage({
      type: 'end_game',
    });
  }, [sendMessage]);

  const handleApproveSong = () => {
    evaluateAnswer(true, false, false);
  };

  const handleApproveArtist = () => {
    evaluateAnswer(false, true, false);
  };

  const handleWrongAnswer = () => {
    evaluateAnswer(false, false, true);
  };

  if (!gameCode) {
    return (
      <div className="manager-console-page">
        <div className="error-message">Invalid game code</div>
      </div>
    );
  }

  return (
    <div className="manager-console-page">
      {/* Header */}
      <header className="console-header">
        <div className="header-content">
          <div className="header-left">
            <h1 className="console-title">🎮 Manager Console</h1>
            {/* Only show game code in waiting state */}
            {gameState.state === 'waiting' && (
              <p className="game-code-display">
                Game Code: <strong>{gameCode}</strong>
              </p>
            )}
          </div>
          <div className="header-right">
            <div className="connection-indicator">
              {isConnected ? (
                <span className="status-connected">✓ Connected</span>
              ) : (
                <span className="status-connecting">⟳ Connecting...</span>
              )}
            </div>
            <button className="btn-back" onClick={() => navigate('/')}>
              ← Exit
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span>⚠️ {error}</span>
        </div>
      )}

      {loadingSongs && (
        <div className="info-banner">
          <span>Loading songs...</span>
        </div>
      )}

      {/* Main Content - Single column layout */}
      <main className="console-main">
        <div className="console-container-single">
          {/* 1. YouTube Player */}
          <section className="player-section">
            <YouTubePlayer
              ref={youtubePlayerRef}
              videoId={currentSong?.youtube_id || null}
              startTime={currentSong?.start_time || 5}
              autoplay={true}
            />
          </section>

          {/* 2. Correct Answers Card */}
          {currentSong && roundState === 'active' && (
            <CorrectAnswersCard
              songName={currentSong.title}
              artistOrContent={currentSong.artist}
              isSoundtrack={currentSong?.is_soundtrack || false}
              lockedComponents={lockedComponents}
              visible={true}
            />
          )}

          {/* 3. Evaluation Panel */}
          {gameState.buzzedTeam && roundState === 'active' && (
            <EvaluationPanel
              buzzedTeamName={gameState.buzzedTeam.team_name}
              isSoundtrack={currentSong?.is_soundtrack || false}
              onApproveSong={handleApproveSong}
              onApproveArtistContent={handleApproveArtist}
              onWrongAnswer={handleWrongAnswer}
              disabled={evaluating}
              lockedComponents={lockedComponents}
            />
          )}

          {/* 4. Round Controls (Playback controls) */}
          <RoundControls
            roundNumber={gameState.currentRound?.round_number || null}
            gameState={gameState.state}
            roundState={roundState}
            onStartGame={startGame}
            onStartRound={startRound}
            onNextRound={nextRound}
            onContinueSong={continueSong}
            onFinishRound={finishRound}
            onSkipRound={skipRound}
            onEndGame={endGame}
            disabled={!isConnected || loadingSongs}
            lockedComponents={lockedComponents}
          />

          {/* 5. Teams List */}
          <section className="teams-section">
            <h3 className="section-title">Teams ({gameState.teams.length})</h3>
            {gameState.teams.length === 0 ? (
              <div className="empty-state">
                <p>No teams connected</p>
              </div>
            ) : (
              <div className="teams-list">
                {gameState.teams.map((team) => (
                  <div key={team.name} className="team-item">
                    <div className="team-info">
                      <span className="team-name">{team.name}</span>
                      {team.connected && (
                        <span className="team-status-dot" title="Connected">
                          ●
                        </span>
                      )}
                    </div>
                    <span className="team-score">{team.score} pts</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 6. Instructions */}
          <section className="instructions-section">
            <h3 className="section-title">💡 How to Use</h3>
            <ul className="instructions-list">
              <li>Click "Start Round" to select a random song</li>
              <li>Teams will buzz when they know the answer</li>
              <li>Listen to their verbal answer</li>
              <li>Approve correct components or mark wrong</li>
              <li>Use "Continue" to resume song and re-enable buzzers</li>
              <li>Use "Restart Song" to play from beginning</li>
              <li>Click "Skip Round" if no one can answer</li>
              <li>Songs available: {availableSongs.length}</li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
};

export default ManagerConsoleNew;
