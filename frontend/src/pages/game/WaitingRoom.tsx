import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocket } from '../../hooks/useWebSocket';
import './WaitingRoom.css';

const WaitingRoom: React.FC = () => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();
  
  const [teamName, setTeamName] = useState<string>('');
  const [hasJoined, setHasJoined] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);

  const { isConnected, teams, totalTeams, error, connect } = useWebSocket({
    gameCode: gameCode || '',
    teamName: teamName,
    isManager: false,
    autoConnect: false,
    onMessage: (message) => {
      if (message.type === 'game_started') {
        setGameStarted(true);
        // Navigate to game screen after 2 seconds
        setTimeout(() => {
          navigate(`/game/${gameCode}/play`);
        }, 2000);
      }
    }
  });

  const handleJoinGame = (e: React.FormEvent) => {
    e.preventDefault();
    if (teamName.trim()) {
      connect();
      setHasJoined(true);
    }
  };

  const handleLeaveGame = () => {
    navigate('/');
  };

  // Update connection status when connected
  useEffect(() => {
    if (isConnected) {
      console.log('Connected to game:', gameCode);
    }
  }, [isConnected, gameCode]);

  if (!gameCode) {
    return (
      <div className="waiting-room-container">
        <div className="error-message">Invalid game code</div>
      </div>
    );
  }

  if (gameStarted) {
    return (
      <div className="waiting-room-container">
        <div className="game-starting">
          <h1>🎵 Game Starting! 🎵</h1>
          <p>Get ready to identify those songs!</p>
        </div>
      </div>
    );
  }

  if (!hasJoined) {
    return (
      <div className="waiting-room-container">
        <div className="join-form-container">
          <h1>Join Game</h1>
          <p className="game-code">Game Code: <strong>{gameCode}</strong></p>
          
          <form onSubmit={handleJoinGame} className="join-form">
            <div className="form-group">
              <label htmlFor="teamName">Team Name</label>
              <input
                id="teamName"
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="Enter your team name"
                maxLength={30}
                required
                autoFocus
              />
            </div>
            
            {error && (
              <div className="error-message">{error}</div>
            )}
            
            <button type="submit" className="btn-primary" disabled={!teamName.trim()}>
              Join Game
            </button>
            
            <button type="button" className="btn-secondary" onClick={handleLeaveGame}>
              Back to Home
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="waiting-room-container">
      <div className="waiting-room">
        <header className="waiting-room-header">
          <h1>🎵 Sound Clash</h1>
          <p className="game-code">Game Code: <strong>{gameCode}</strong></p>
        </header>

        <div className="connection-status">
          {isConnected ? (
            <span className="status-connected">✓ Connected</span>
          ) : (
            <span className="status-connecting">⟳ Connecting...</span>
          )}
        </div>

        <div className="your-team-info">
          <h2>Your Team</h2>
          <div className="team-badge">{teamName}</div>
        </div>

        <div className="teams-section">
          <h2>Teams in Game ({totalTeams})</h2>
          
          {teams.length === 0 ? (
            <p className="waiting-message">Waiting for teams to join...</p>
          ) : (
            <div className="teams-list">
              {teams.map((team, index) => (
                <div 
                  key={team.name} 
                  className={`team-item ${team.name === teamName ? 'current-team' : ''}`}
                >
                  <span className="team-number">{index + 1}</span>
                  <span className="team-name">{team.name}</span>
                  {team.connected && (
                    <span className="team-connected">●</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="error-message">{error}</div>
        )}

        <div className="waiting-message-box">
          <p>⏳ Waiting for the manager to start the game...</p>
        </div>

        <button className="btn-secondary" onClick={handleLeaveGame}>
          Leave Game
        </button>
      </div>
    </div>
  );
};

export default WaitingRoom;
