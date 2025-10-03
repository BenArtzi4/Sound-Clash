import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Logo from '../../components/Logo';
import '../../styles/pages/team-join.css';
import '../../styles/themes/minimal-clean.css';

const TeamJoin: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [gameCode, setGameCode] = useState(searchParams.get('code') || '');
  const [teamName, setTeamName] = useState('');
  const [errors, setErrors] = useState<{ gameCode?: string; teamName?: string }>({});
  const [isJoining, setIsJoining] = useState(false);
  
  const gameCodeInputRef = useRef<HTMLInputElement>(null);
  
  // Apply minimal clean theme
  useEffect(() => {
    document.body.className = 'theme-minimal-clean';
  }, []);

  // Auto-focus game code input on mount
  useEffect(() => {
    gameCodeInputRef.current?.focus();
  }, []);

  // Validate game code (6 alphanumeric characters)
  const validateGameCode = (code: string): boolean => {
    if (!code) {
      setErrors(prev => ({ ...prev, gameCode: 'Game code is required' }));
      return false;
    }
    if (code.length !== 6) {
      setErrors(prev => ({ ...prev, gameCode: 'Game code must be 6 characters' }));
      return false;
    }
    if (!/^[A-Z0-9]+$/.test(code)) {
      setErrors(prev => ({ ...prev, gameCode: 'Game code must be letters and numbers only' }));
      return false;
    }
    setErrors(prev => ({ ...prev, gameCode: undefined }));
    return true;
  };

  // Validate team name
  const validateTeamName = (name: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed) {
      setErrors(prev => ({ ...prev, teamName: 'Team name is required' }));
      return false;
    }
    if (trimmed.length > 30) {
      setErrors(prev => ({ ...prev, teamName: 'Team name must be 30 characters or less' }));
      return false;
    }
    setErrors(prev => ({ ...prev, teamName: undefined }));
    return true;
  };

  // Handle game code input (auto-uppercase, limit to 6 chars)
  const handleGameCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().slice(0, 6);
    setGameCode(value);
    if (value) {
      validateGameCode(value);
    }
  };

  // Handle team name input
  const handleTeamNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setTeamName(value);
    if (value.trim()) {
      validateTeamName(value);
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const isGameCodeValid = validateGameCode(gameCode);
    const isTeamNameValid = validateTeamName(teamName);
    
    if (!isGameCodeValid || !isTeamNameValid) {
      return;
    }

    setIsJoining(true);

    try {
      // TODO: Call API to verify game exists
      // For now, simulate delay
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Navigate to team gameplay page
      navigate(`/team/game/${gameCode}`, {
        state: { teamName: teamName.trim() }
      });
    } catch (error) {
      console.error('Failed to join game:', error);
      setErrors({ gameCode: 'Failed to join game. Please check the code and try again.' });
      setIsJoining(false);
    }
  };

  const isFormValid = gameCode.length === 6 && teamName.trim().length > 0 && !errors.gameCode && !errors.teamName;

  return (
    <div className="team-join-page theme-minimal-clean">
      <header className="team-join-header">
        <Logo size="medium" />
      </header>

      <main className="team-join-main">
        <div className="team-join-container">
          <div className="team-join-card">
            <h1 className="team-join-title">Join Game</h1>
            <p className="team-join-subtitle">Enter the game code and your team name</p>

            <form onSubmit={handleSubmit} className="team-join-form">
              {/* Game Code Input */}
              <div className="form-group">
                <label htmlFor="gameCode" className="form-label">
                  Game Code
                </label>
                <input
                  ref={gameCodeInputRef}
                  id="gameCode"
                  type="text"
                  className={`form-input game-code-input ${errors.gameCode ? 'error' : ''}`}
                  value={gameCode}
                  onChange={handleGameCodeChange}
                  placeholder="ABC123"
                  maxLength={6}
                  autoComplete="off"
                  disabled={isJoining}
                />
                {errors.gameCode && (
                  <span className="form-error">{errors.gameCode}</span>
                )}
              </div>

              {/* Team Name Input */}
              <div className="form-group">
                <label htmlFor="teamName" className="form-label">
                  Team Name
                </label>
                <input
                  id="teamName"
                  type="text"
                  className={`form-input ${errors.teamName ? 'error' : ''}`}
                  value={teamName}
                  onChange={handleTeamNameChange}
                  placeholder="Enter your team name"
                  maxLength={30}
                  autoComplete="off"
                  disabled={isJoining}
                />
                {errors.teamName && (
                  <span className="form-error">{errors.teamName}</span>
                )}
                <span className="form-hint">
                  {teamName.trim().length}/30 characters
                </span>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="btn btn-primary btn-large btn-block"
                disabled={!isFormValid || isJoining}
              >
                {isJoining ? (
                  <>
                    <span className="spinner-small"></span>
                    Joining...
                  </>
                ) : (
                  <>
                    <span className="btn-icon">🎮</span>
                    Join Game
                  </>
                )}
              </button>
            </form>

            {/* Back to Home Link */}
            <div className="team-join-footer">
              <button
                onClick={() => navigate('/')}
                className="link-button"
                disabled={isJoining}
              >
                ← Back to Home
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TeamJoin;
