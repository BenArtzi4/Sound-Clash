import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGame } from '../../context/GameContext';
import { useWebSocket } from '../../hooks/useWebSocket';
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

  const [teams, setTeams] = useState<Team[]>([]);
  const [gameSettings, setGameSettings] = useState<GameSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const showToastMessage = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }, []);

  // WebSocket message handler
  const handleWebSocketMessage = useCallback((data: any) => {
    console.log('[WaitingRoom] Received message:', data);

    switch (data.type) {
      case 'manager_connected':
        // Initial connection - receive current teams list
        if (data.teams) {
          setTeams(data.teams.map((team: any) => ({
            name: team.name,
            status: team.connected ? 'connected' : 'disconnected',
            joinedAt: team.joined_at
          })));
        }
        setLoading(false);
        break;

      case 'team_update':
        // Team joined or left
        if (data.teams) {
          setTeams(data.teams.map((team: any) => ({
            name: team.name,
            status: team.connected ? 'connected' : 'disconnected',
            joinedAt: team.joined_at
          })));
        }
        if (data.event === 'team_joined') {
          showToastMessage(`${data.team_name} joined the game!`);
        }
        break;

      default:
        console.log('[WaitingRoom] Unhandled message type:', data.type);
    }
  }, [showToastMessage]);

  // WebSocket connection
  const { connectionStatus } = useWebSocket({
    gameCode: gameCode || '',
    role: 'manager',
    onMessage: handleWebSocketMessage,
    onConnected: () => {
      console.log('[WaitingRoom] Manager connected to WebSocket');
    },
    onDisconnected: () => {
      console.log('[WaitingRoom] Manager disconnected from WebSocket');
    },
    onError: (error) => {
      console.error('[WaitingRoom] WebSocket error:', error);
    }
  });

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
    // Load game settings from localStorage
    const savedGame = localStorage.getItem('sound-clash-game');
    if (savedGame) {
      const { settings } = JSON.parse(savedGame);
      if (settings) {
        setGameSettings(settings);
      }
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {connectionStatus === 'connected' && (
              <span style={{ color: '#4caf50', fontSize: '0.875rem' }}>● Connected</span>
            )}
            {connectionStatus === 'connecting' && (
              <span style={{ color: '#ff9800', fontSize: '0.875rem' }}>● Connecting...</span>
            )}
            {connectionStatus === 'disconnected' && (
              <span style={{ color: '#f44336', fontSize: '0.875rem' }}>● Disconnected</span>
            )}
            <button className="btn-leave" onClick={handleLeaveGame}>
              ← Leave Game
            </button>
          </div>
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
