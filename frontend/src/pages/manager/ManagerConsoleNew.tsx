import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useManagerWebSocket } from '../../hooks/useManagerWebSocket';
import YouTubePlayer from '../../components/manager/YouTubePlayer';
import CorrectAnswersCard from '../../components/manager/CorrectAnswersCard';
import EvaluationPanel from '../../components/manager/EvaluationPanel';
import RoundControls from '../../components/manager/RoundControls';
import '../../styles/pages/manager-console.css';

const ALB_URL = import.meta.env.VITE_ALB_URL || 'http://localhost:8002';

type RoundState = 'idle' | 'active' | 'completed';

const ManagerConsoleNew: React.FC = () => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();

  const [roundState, setRoundState] = useState<RoundState>('idle');
  const [currentSong, setCurrentSong] = useState<any>(null);
  const [lockedComponents, setLockedComponents] = useState({
    song_name: false,
    artist_content: false,
  });
  const [evaluating, setEvaluating] = useState(false);

  // WebSocket connection
  const { isConnected, gameState, error } = useManagerWebSocket({
    gameCode: gameCode || '',
    onGameStarted: () => {
      console.log('[Manager] Game started');
    },
    onRoundStarted: (round) => {
      console.log('[Manager] Round started:', round);
      setCurrentSong(round.song);
      setRoundState('active');
      setLockedComponents({ song_name: false, artist_content: false });
    },
    onBuzzerLocked: (buzz) => {
      console.log('[Manager] Buzzer locked:', buzz);
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

  // API calls
  const startRound = useCallback(async () => {
    try {
      const response = await fetch(`${ALB_URL}/api/game/${gameCode}/round/start`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to start round');
      }
      const data = await response.json();
      console.log('[Manager] Round started:', data);
    } catch (err) {
      console.error('[Manager] Error starting round:', err);
      alert('Failed to start round. Please try again.');
    }
  }, [gameCode]);

  const evaluateAnswer = useCallback(
    async (songCorrect: boolean, artistCorrect: boolean, _wrongAnswer: boolean) => {
      if (!gameState.buzzedTeam) return;

      setEvaluating(true);
      try {
        const response = await fetch(`${ALB_URL}/api/game/${gameCode}/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            song_correct: songCorrect,
            artist_correct: artistCorrect,
            movie_tv_correct: false, // Not used in simplified version
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to evaluate answer');
        }

        // Update locked components
        setLockedComponents((prev) => ({
          song_name: prev.song_name || songCorrect,
          artist_content: prev.artist_content || artistCorrect,
        }));

        console.log('[Manager] Answer evaluated');
      } catch (err) {
        console.error('[Manager] Error evaluating answer:', err);
        alert('Failed to evaluate answer. Please try again.');
      } finally {
        setEvaluating(false);
      }
    },
    [gameCode, gameState.buzzedTeam]
  );

  const restartSong = useCallback(async () => {
    try {
      // Just restart the YouTube player
      // The backend will handle buzzer re-enabling
      alert('Song restarted! Buzzers are now available again.');
    } catch (err) {
      console.error('[Manager] Error restarting song:', err);
    }
  }, []);

  const skipRound = useCallback(async () => {
    try {
      const response = await fetch(`${ALB_URL}/api/game/${gameCode}/timeout`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to skip round');
      }
      setRoundState('completed');
      console.log('[Manager] Round skipped');
    } catch (err) {
      console.error('[Manager] Error skipping round:', err);
      alert('Failed to skip round. Please try again.');
    }
  }, [gameCode]);

  const nextRound = useCallback(() => {
    setRoundState('idle');
    setCurrentSong(null);
    setLockedComponents({ song_name: false, artist_content: false });
  }, []);

  const endGame = useCallback(async () => {
    try {
      const response = await fetch(`${ALB_URL}/api/game/${gameCode}/end`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to end game');
      }
      console.log('[Manager] Game ended');
    } catch (err) {
      console.error('[Manager] Error ending game:', err);
      alert('Failed to end game. Please try again.');
    }
  }, [gameCode]);

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
            <p className="game-code-display">
              Game Code: <strong>{gameCode}</strong>
            </p>
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

      {/* Main Content */}
      <main className="console-main">
        <div className="console-container">
          {/* Left Column - YouTube Player & Answers */}
          <div className="console-left">
            {/* YouTube Player */}
            <section className="player-section">
              <YouTubePlayer
                videoId={currentSong?.youtube_id || null}
                startTime={currentSong?.start_time || 5}
                autoplay={true}
              />
            </section>

            {/* Correct Answers Card */}
            {currentSong && roundState === 'active' && (
              <CorrectAnswersCard
                songName={currentSong.title}
                artistOrContent={currentSong.artist}
                isSoundtrack={false} // TODO: Get from song metadata
                lockedComponents={lockedComponents}
                visible={true}
              />
            )}

            {/* Evaluation Panel */}
            {gameState.buzzedTeam && roundState === 'active' && (
              <EvaluationPanel
                buzzedTeamName={gameState.buzzedTeam.team_name}
                isSoundtrack={false} // TODO: Get from song metadata
                onApproveSong={handleApproveSong}
                onApproveArtistContent={handleApproveArtist}
                onWrongAnswer={handleWrongAnswer}
                disabled={evaluating}
              />
            )}
          </div>

          {/* Right Column - Controls & Teams */}
          <div className="console-right">
            {/* Round Controls */}
            <RoundControls
              roundNumber={gameState.currentRound?.round_number || null}
              gameState={gameState.state}
              roundState={roundState}
              onStartRound={startRound}
              onNextRound={nextRound}
              onRestartSong={restartSong}
              onSkipRound={skipRound}
              onEndGame={endGame}
              disabled={!isConnected}
            />

            {/* Teams List */}
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

            {/* Instructions */}
            <section className="instructions-section">
              <h3 className="section-title">💡 How to Use</h3>
              <ul className="instructions-list">
                <li>Start a round to select a random song</li>
                <li>Teams will buzz when they know the answer</li>
                <li>Listen to their verbal answer</li>
                <li>Approve correct components or mark wrong</li>
                <li>Restart song to re-enable buzzers</li>
                <li>Skip round if no one can answer</li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ManagerConsoleNew;
