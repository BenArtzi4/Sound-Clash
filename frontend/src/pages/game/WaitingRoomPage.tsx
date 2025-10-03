import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGame } from '../../context/GameContext';
import Logo from '../../components/common/Logo';
import '../../styles/pages/waiting-room.css';

interface Team {
  name: string;
  status: 'connected' | 'disconnected';
  joinedAt: string;
}

interface GameSettings {
  genres: string[];
  difficulty: string;
  answerTime: number;
  maxTeams: number;
}

const WaitingRoomPage: React.FC = () => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();
  const { state, dispatch, leaveGame } = useGame();
  
  const [teams] = useState<Team[]>([]);
  const [gameSettings] = useState<GameSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  useEffect(() => {
    if (!state.gameCode && gameCode) {
      const savedGame = localStorage.getItem('sound-clash-game');
      if (savedGame) {
        const { gameCode: savedCode, teamName, isManager } = JSON.parse(savedGame);
        if (savedCode === gameCode) {
          dispatch({ type: 'SET_GAME_CODE', payload: savedCode });
          dispatch({ type: 'SET_TEAM_NAME', payload: teamName });
          dispatch({ type: 'SET_IS_MANAGER', payload: isManager });
          return;
        }
      }
      navigate('/');
    }
  }, [gameCode, state.gameCode, navigate, dispatch]);

  useEffect(() => {
    const fetchGameData = async () => {
      try {
        setLoading(true);
        setTimeout(() => {
          setLoading(false);
        }, 1000);
      } catch (error) {
        console.error('Failed to fetch game data:', error);
        setLoading(false);
      }
    };

    if (gameCode) {
      fetchGameData();
    }
  }, [gameCode]);

  const handleLeaveGame = () => {
    leaveGame();
    navigate('/');
  };

  const handleStartGame = () => {
    if (teams.length === 0) {
      showToastMessage('Wait for at least one team to join before starting!');
      return;
    }
    
    console.log('Starting game...');
    navigate(`/manager/game/${gameCode}`);
  };

  const showToastMessage = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const copyGameCode = async () => {
    if (gameCode) {
      try {
        await navigator.clipboard.writeText(gameCode);
        showToastMessage('Game code copied to clipboard!');
      } catch (err) {
        showToastMessage(`Game code: ${gameCode}`);
      }
    }
  };

  if (!state.gameCode || !gameCode) {
    return (
      <div className="waiting-room-page">
        <div className="container">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="waiting-room-page">
      {showToast && (
        <div className="toast">
          <span className="toast-icon">✓</span>
          {toastMessage}
        </div>
      )}

      <header className="page-header">
        <div className="header-content">
          <Logo size="medium" />
          <button className="btn-leave" onClick={handleLeaveGame}>
            ← Leave Game
          </button>
        </div>
      </header>

      <main className="page-main">
        <div className="waiting-container">
          <div className="game-code-section">
            <h1 className="page-title">Waiting Room</h1>
            
            <div className="game-code-card">
              <p className="code-label">Share this code with players</p>
              <div className="code-display">{gameCode}</div>
              <button className="btn-copy" onClick={copyGameCode}>
                📋 Copy Code
              </button>
              <p className="code-help">
                Players can join at any time before the game starts
              </p>
            </div>
          </div>

          <div className="teams-section">
            <div className="section-header">
              <h2 className="section-title">Teams</h2>
              <span className="team-count">
                {teams.length} team{teams.length !== 1 ? 's' : ''} joined
              </span>
            </div>
            
            {loading ? (
              <div className="empty-state">
                <p>Loading teams...</p>
              </div>
            ) : teams.length > 0 ? (
              <div className="teams-list">
                {teams.map((team, index) => (
                  <div key={index} className="team-item">
                    <div className="team-avatar">
                      {team.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="team-info">
                      <span className="team-name">{team.name}</span>
                      <div className="team-status">
                        <span className={`status-dot ${team.status}`}></span>
                        <span className="status-text">
                          {team.status === 'connected' ? 'Connected' : 'Disconnected'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>Waiting for teams to join...</p>
                <p className="empty-hint">Share the game code above</p>
              </div>
            )}
          </div>

          <div className="settings-section">
            <h2 className="section-title">Game Settings</h2>
            {loading ? (
              <div className="settings-grid">
                <div className="setting-item">
                  <span className="setting-label">Loading settings...</span>
                </div>
              </div>
            ) : gameSettings ? (
              <div className="settings-grid">
                <div className="setting-item">
                  <span className="setting-label">Genres:</span>
                  <span className="setting-value">
                    {gameSettings.genres.length > 0 ? gameSettings.genres.join(', ') : 'Not set'}
                  </span>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Difficulty:</span>
                  <span className="setting-value">{gameSettings.difficulty}</span>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Answer Time:</span>
                  <span className="setting-value">{gameSettings.answerTime} seconds</span>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Max Teams:</span>
                  <span className="setting-value">
                    {gameSettings.maxTeams === 0 ? 'Unlimited' : gameSettings.maxTeams}
                  </span>
                </div>
              </div>
            ) : (
              <div className="settings-grid">
                <div className="setting-item">
                  <span className="setting-label">Settings will load when available</span>
                </div>
              </div>
            )}
          </div>

          <div className="action-section">
            {state.isManager ? (
              <div className="manager-actions">
                <button 
                  className="btn-start-game"
                  onClick={handleStartGame}
                  disabled={teams.length === 0 || loading}
                >
                  🚀 Start Game
                </button>
                {teams.length === 0 && !loading && (
                  <p className="action-hint">
                    Wait for at least one team to join
                  </p>
                )}
                {teams.length > 0 && (
                  <p className="action-hint">
                    {teams.length} team{teams.length !== 1 ? 's' : ''} ready to play!
                  </p>
                )}
              </div>
            ) : (
              <div className="player-status">
                <div className="status-card">
                  <h3>You're in as: {state.teamName}</h3>
                  <p>Waiting for the host to start the game...</p>
                  <div className="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default WaitingRoomPage;
