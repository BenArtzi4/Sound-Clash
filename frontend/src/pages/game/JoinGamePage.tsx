import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import Logo from '../components/Logo';

const JoinGamePage: React.FC = () => {
  const navigate = useNavigate();
  const { joinGame, state } = useGame();
  
  const [gameCode, setGameCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [errors, setErrors] = useState<{gameCode?: string; teamName?: string}>({});
  const [showSuccess, setShowSuccess] = useState(false);

  const validateForm = () => {
    const newErrors: {gameCode?: string; teamName?: string} = {};
    
    // Validate game code (6 characters, alphanumeric)
    if (!gameCode.trim()) {
      newErrors.gameCode = 'Game code is required';
    } else if (gameCode.length !== 6) {
      newErrors.gameCode = 'Game code must be 6 characters';
    } else if (!/^[A-Z0-9]+$/i.test(gameCode)) {
      newErrors.gameCode = 'Game code must contain only letters and numbers';
    }
    
    // Validate team name
    if (!teamName.trim()) {
      newErrors.teamName = 'Team name is required';
    } else if (teamName.trim().length < 2) {
      newErrors.teamName = 'Team name must be at least 2 characters';
    } else if (teamName.trim().length > 20) {
      newErrors.teamName = 'Team name must be 20 characters or less';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      // Here we would call the API to join the game
      // For now, we'll just use the context
      joinGame(gameCode.toUpperCase(), teamName.trim());
      
      // Show success feedback
      setShowSuccess(true);
      
      // Navigate to waiting room after brief delay
      setTimeout(() => {
        navigate(`/game/${gameCode.toUpperCase()}/lobby`);
      }, 800);
    } catch (error) {
      setErrors({ gameCode: 'Failed to join game. Please check your game code.' });
    }
  };

  const handleGameCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    if (value.length <= 6) {
      setGameCode(value);
      if (errors.gameCode) {
        setErrors({ ...errors, gameCode: undefined });
      }
    }
  };

  const handleTeamNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTeamName(e.target.value);
    if (errors.teamName) {
      setErrors({ ...errors, teamName: undefined });
    }
  };

  if (showSuccess) {
    return (
      <div className="join-game-page">
        <div className="success-screen">
          <div className="success-content">
            <div className="success-icon">✓</div>
            <h1 className="title-1">Joining Game...</h1>
            <p className="body">Taking you to the waiting room</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="join-game-page">
      {/* Header */}
      <header className="page-header">
        <div className="container">
          <Logo size="medium" />
          <button 
            className="btn btn-tertiary back-button"
            onClick={() => navigate('/')}
          >
            ← Back
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="page-main">
        <div className="form-container">
          <div className="join-form-card card">
            <div className="form-header">
              <h1 className="title-1">Join Game</h1>
              <p className="subhead">Enter the game code to join an existing game</p>
            </div>

            <form onSubmit={handleSubmit} className="join-form">
              {/* Game Code Input */}
              <div className="form-group">
                <label htmlFor="gameCode" className="form-label headline">
                  Game Code
                </label>
                <div className="input-wrapper">
                  <input
                    id="gameCode"
                    type="text"
                    className={`input game-code-input ${errors.gameCode ? 'error' : gameCode.length === 6 ? 'success' : ''}`}
                    placeholder="ABC123"
                    value={gameCode}
                    onChange={handleGameCodeChange}
                    maxLength={6}
                    autoComplete="off"
                    autoCapitalize="characters"
                  />
                  {gameCode.length === 6 && !errors.gameCode && (
                    <div className="input-success-indicator">✓</div>
                  )}
                </div>
                <div className="input-hint caption">
                  6-character code from the game host
                </div>
                {errors.gameCode && (
                  <span className="error-message caption error">
                    {errors.gameCode}
                  </span>
                )}
              </div>

              {/* Team Name Input */}
              <div className="form-group">
                <label htmlFor="teamName" className="form-label headline">
                  Team Name
                </label>
                <div className="input-wrapper">
                  <input
                    id="teamName"
                    type="text"
                    className={`input ${errors.teamName ? 'error' : teamName.length >= 2 ? 'success' : ''}`}
                    placeholder="Rock Stars"
                    value={teamName}
                    onChange={handleTeamNameChange}
                    maxLength={20}
                  />
                  {teamName.length >= 2 && !errors.teamName && (
                    <div className="input-success-indicator">✓</div>
                  )}
                </div>
                <div className="input-hint caption">
                  Choose a fun name for your team
                </div>
                {errors.teamName && (
                  <span className="error-message caption error">
                    {errors.teamName}
                  </span>
                )}
              </div>

              {/* Submit Button */}
              <button 
                type="submit" 
                className={`btn btn-primary btn-large ${state.loading ? 'loading' : ''}`}
                disabled={state.loading || gameCode.length !== 6 || teamName.length < 2}
              >
                {state.loading ? 'Joining...' : 'Join Game'}
              </button>
            </form>

            {/* Help text */}
            <div className="help-text">
              <p className="caption">
                Don't have a game code? Ask the game host to share it with you.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default JoinGamePage;