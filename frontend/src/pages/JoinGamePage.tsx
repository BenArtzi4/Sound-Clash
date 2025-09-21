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
      
      // Navigate to waiting room
      navigate(`/game/${gameCode.toUpperCase()}/lobby`);
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

  return (
    <div className="join-game-page">
      {/* Header */}
      <header className="page-header">
        <div className="container">
          <button 
            className="btn btn-tertiary back-button"
            onClick={() => navigate('/')}
          >
            ← Back
          </button>
          <Logo size="medium" />
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
                <input
                  id="gameCode"
                  type="text"
                  className={`input game-code-input ${errors.gameCode ? 'error' : ''}`}
                  placeholder="ABC123"
                  value={gameCode}
                  onChange={handleGameCodeChange}
                  maxLength={6}
                  autoComplete="off"
                  autoCapitalize="characters"
                />
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
                <input
                  id="teamName"
                  type="text"
                  className={`input ${errors.teamName ? 'error' : ''}`}
                  placeholder="Rock Stars"
                  value={teamName}
                  onChange={handleTeamNameChange}
                  maxLength={20}
                />
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
                disabled={state.loading}
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