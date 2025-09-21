import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import Logo from '../components/Logo';

const WaitingRoomPage: React.FC = () => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();
  const { state, dispatch, leaveGame } = useGame();
  
  // Mock teams data - in real app this would come from WebSocket
  const [teams, setTeams] = useState<string[]>([
    'Rock Stars',
    'Music Masters',
    'Quiz Kings'
  ]);

  useEffect(() => {
    // If no game state, redirect to home
    if (!state.gameCode && gameCode) {
      // Try to restore from localStorage
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
      // If can't restore, go home
      navigate('/');
    }
  }, [gameCode, state.gameCode, navigate, dispatch]);

  const handleLeaveGame = () => {
    leaveGame();
    navigate('/');
  };

  const handleStartGame = () => {
    // In real app, this would call the API to start the game
    console.log('Starting game...');
    // For now, just show an alert
    alert('Game starting functionality will be implemented with backend integration!');
  };

  const copyGameCode = async () => {
    if (gameCode) {
      try {
        await navigator.clipboard.writeText(gameCode);
        // Show temporary success message
        alert('Game code copied to clipboard!');
      } catch (err) {
        // Fallback for older browsers
        console.log('Game code:', gameCode);
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
      {/* Header */}
      <header className="page-header">
        <div className="container">
          <button 
            className="btn btn-tertiary back-button"
            onClick={handleLeaveGame}
          >
            ← Leave Game
          </button>
          <Logo size="medium" />
        </div>
      </header>

      {/* Main content */}
      <main className="page-main">
        <div className="container">
          <div className="waiting-room-content">
            
            {/* Game Code Section */}
            <div className="game-code-section card">
              <h1 className="title-1 text-center">Waiting Room</h1>
              
              <div className="game-code-display">
                <span className="game-code-label subhead">Game Code</span>
                <div className="game-code-value">
                  <span className="game-code-text large-title">{gameCode}</span>
                  <button 
                    className="btn btn-tertiary copy-button"
                    onClick={copyGameCode}
                    title="Copy game code"
                  >
                    📋 Copy
                  </button>
                </div>
                <p className="game-code-help caption">
                  Share this code with other players
                </p>
              </div>
            </div>

            {/* Teams Section */}
            <div className="teams-section card">
              <div className="teams-header">
                <h2 className="title-2">Teams Joined</h2>
                <span className="team-count caption">
                  {teams.length} team{teams.length !== 1 ? 's' : ''} ready
                </span>
              </div>
              
              {teams.length > 0 ? (
                <div className="teams-list">
                  {teams.map((team, index) => (
                    <div key={index} className="team-item">
                      <div className="team-avatar">
                        {team.charAt(0).toUpperCase()}
                      </div>
                      <span className="team-name headline">{team}</span>
                      <div className="team-status">
                        <span className="status-indicator ready"></span>
                        <span className="status-text caption">Ready</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-teams">
                  <p className="body">No teams have joined yet</p>
                  <p className="caption">Share the game code to get started</p>
                </div>
              )}
            </div>

            {/* Game Settings Preview */}
            <div className="settings-section card">
              <h2 className="title-2">Game Settings</h2>
              <div className="settings-grid">
                <div className="setting-item">
                  <span className="setting-label subhead">Genres:</span>
                  <span className="setting-value body">Rock, Pop, 80s</span>
                </div>
                <div className="setting-item">
                  <span className="setting-label subhead">Difficulty:</span>
                  <span className="setting-value body">Mixed</span>
                </div>
                <div className="setting-item">
                  <span className="setting-label subhead">Answer Time:</span>
                  <span className="setting-value body">10 seconds</span>
                </div>
              </div>
            </div>

            {/* Action Section */}
            <div className="action-section">
              {state.isManager ? (
                <div className="manager-actions">
                  <button 
                    className="btn btn-primary btn-large"
                    onClick={handleStartGame}
                    disabled={teams.length === 0}
                  >
                    Start Game
                  </button>
                  {teams.length === 0 && (
                    <p className="caption text-center">
                      Wait for at least one team to join
                    </p>
                  )}
                </div>
              ) : (
                <div className="player-status">
                  <div className="status-card">
                    <h3 className="headline">You're in as: {state.teamName}</h3>
                    <p className="body">Waiting for the host to start the game...</p>
                    <div className="loading-indicator">
                      <div className="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default WaitingRoomPage;