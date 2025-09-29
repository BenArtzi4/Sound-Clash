import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWebSocket } from '../../hooks/useWebSocket';
import './ManagerConsole.css';

const ManagerConsole: React.FC = () => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();
  
  const [showKickConfirm, setShowKickConfirm] = useState<string | null>(null);

  const ALB_URL = import.meta.env.VITE_ALB_URL || 'http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com';

  const { isConnected, teams, totalTeams, error, sendMessage } = useWebSocket({
    gameCode: gameCode || '',
    isManager: true,
    autoConnect: true,
    onMessage: (message) => {
      console.log('[Manager] Received message:', message);
    }
  });

  const handleStartGame = () => {
    if (teams.length < 2) {
      alert('Need at least 2 teams to start the game!');
      return;
    }
    
    sendMessage({ type: 'start_game' });
  };

  const handleKickTeam = async (teamName: string) => {
    try {
      const response = await fetch(
        `${ALB_URL}/api/game/${gameCode}/kick/${encodeURIComponent(teamName)}`,
        { method: 'POST' }
      );
      
      if (response.ok) {
        console.log(`Team ${teamName} kicked successfully`);
        setShowKickConfirm(null);
      } else {
        const data = await response.json();
        alert(`Failed to kick team: ${data.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error kicking team:', err);
      alert('Failed to kick team. Please try again.');
    }
  };

  const handleRefreshTeams = () => {
    sendMessage({ type: 'get_teams' });
  };

  const handleBackToHome = () => {
    navigate('/');
  };

  if (!gameCode) {
    return (
      <div className="manager-console-container">
        <div className="error-message">Invalid game code</div>
      </div>
    );
  }

  return (
    <div className="manager-console-container">
      <div className="manager-console">
        <header className="console-header">
          <h1>🎮 Manager Console</h1>
          <p className="game-code">Game Code: <strong>{gameCode}</strong></p>
        </header>

        <div className="connection-status">
          {isConnected ? (
            <span className="status-connected">✓ Connected to Game</span>
          ) : (
            <span className="status-connecting">⟳ Connecting...</span>
          )}
        </div>

        {error && (
          <div className="error-message">{error}</div>
        )}

        <div className="console-stats">
          <div className="stat-card">
            <div className="stat-value">{totalTeams}</div>
            <div className="stat-label">Teams Connected</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">Waiting</div>
            <div className="stat-label">Game Status</div>
          </div>
        </div>

        <div className="teams-management">
          <div className="section-header">
            <h2>Teams ({totalTeams})</h2>
            <button className="btn-refresh" onClick={handleRefreshTeams} title="Refresh teams">
              ⟳
            </button>
          </div>

          {teams.length === 0 ? (
            <div className="empty-state">
              <p>⏳ Waiting for teams to join...</p>
              <p className="hint">Share the game code with players!</p>
            </div>
          ) : (
            <div className="teams-grid">
              {teams.map((team, index) => (
                <div key={team.name} className="team-card">
                  <div className="team-card-header">
                    <span className="team-number">{index + 1}</span>
                    <span className="team-name">{team.name}</span>
                    {team.connected && (
                      <span className="team-status-dot" title="Connected">●</span>
                    )}
                  </div>
                  <div className="team-card-actions">
                    <button 
                      className="btn-kick"
                      onClick={() => setShowKickConfirm(team.name)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="console-actions">
          <button 
            className="btn-start-game" 
            onClick={handleStartGame}
            disabled={!isConnected || teams.length < 2}
          >
            {teams.length < 2 ? 'Need 2+ Teams' : 'Start Game'}
          </button>
          
          <button className="btn-secondary" onClick={handleBackToHome}>
            End Session
          </button>
        </div>

        <div className="console-info">
          <p>💡 <strong>Tips:</strong></p>
          <ul>
            <li>Share the game code with players to join</li>
            <li>Need at least 2 teams to start</li>
            <li>Remove inactive teams if needed</li>
          </ul>
        </div>
      </div>

      {/* Kick Confirmation Modal */}
      {showKickConfirm && (
        <div className="modal-overlay" onClick={() => setShowKickConfirm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Remove Team?</h3>
            <p>Are you sure you want to remove <strong>{showKickConfirm}</strong> from the game?</p>
            <div className="modal-actions">
              <button 
                className="btn-confirm-kick" 
                onClick={() => handleKickTeam(showKickConfirm)}
              >
                Yes, Remove
              </button>
              <button 
                className="btn-cancel" 
                onClick={() => setShowKickConfirm(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerConsole;
