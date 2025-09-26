import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import Logo from '../components/Logo';
import GenreSelector from '../components/GenreSelector';
import type { CreateGameSettings } from '../types';

const CreateGamePage: React.FC = () => {
  const navigate = useNavigate();
  const { createGame} = useGame();
  
  const [settings, setSettings] = useState<CreateGameSettings>({
    selectedGenres: [],
    hostName: '',
    gameName: '',
    maxTeams: 0, // 0 = unlimited
    roundCount: 10,
    defaultDifficulty: 'mixed',
    answerTimeLimit: 10
  });
  
  const [currentStep, setCurrentStep] = useState<'genres' | 'settings' | 'review'>('genres');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const updateSettings = (updates: Partial<CreateGameSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
    setError(''); // Clear error when user makes changes
  };

  const validateCurrentStep = (): boolean => {
    switch (currentStep) {
      case 'genres':
        if (settings.selectedGenres.length === 0) {
          setError('Please select at least one music genre');
          return false;
        }
        return true;
      case 'settings':
        if (settings.hostName.trim().length < 2) {
          setError('Host name must be at least 2 characters');
          return false;
        }
        return true;
      case 'review':
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    if (!validateCurrentStep()) return;
    
    if (currentStep === 'genres') setCurrentStep('settings');
    else if (currentStep === 'settings') setCurrentStep('review');
  };

  const prevStep = () => {
    if (currentStep === 'settings') setCurrentStep('genres');
    else if (currentStep === 'review') setCurrentStep('settings');
  };

  const generateGameCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleCreateGame = async () => {
    if (!validateCurrentStep()) return;

    try {
      setLoading(true);
      setError('');
      
      // Generate a unique game code
      const gameCode = generateGameCode();
      
      // TODO: Replace with actual API call to create game
      // const gameData = {
      //   gameCode,
      //   settings: {
      //     selectedGenres: settings.selectedGenres,
      //     hostName: settings.hostName,
      //     gameName: settings.gameName,
      //     maxTeams: settings.maxTeams,
      //     roundCount: settings.roundCount,
      //     defaultDifficulty: settings.defaultDifficulty,
      //     answerTimeLimit: settings.answerTimeLimit
      //   }
      // };
      
      // For now, just use the context
      createGame(gameCode);
      
      // Navigate to waiting room as manager
      navigate(`/game/${gameCode}/lobby`);
    } catch (error) {
      setError('Failed to create game. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'genres':
        return (
          <div className="create-step">
            <div className="step-header">
              <h2 className="title-2">Select Music Genres</h2>
              <p className="body">Choose the types of music for your game</p>
            </div>
            
            <GenreSelector
              selectedGenres={settings.selectedGenres}
              onSelectionChange={(genres) => updateSettings({ selectedGenres: genres })}
              loading={loading}
            />
          </div>
        );

      case 'settings':
        return (
          <div className="create-step">
            <div className="step-header">
              <h2 className="title-2">Game Settings</h2>
              <p className="body">Configure your game preferences</p>
            </div>

            <div className="settings-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="hostName" className="form-label headline">
                    Your Name (Host)
                  </label>
                  <input
                    id="hostName"
                    type="text"
                    className="input"
                    placeholder="Enter your name"
                    value={settings.hostName}
                    onChange={(e) => updateSettings({ hostName: e.target.value })}
                    maxLength={50}
                  />
                  <div className="input-hint caption">
                    This will be shown to players during the game
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="gameName" className="form-label headline">
                    Game Name (Optional)
                  </label>
                  <input
                    id="gameName"
                    type="text"
                    className="input"
                    placeholder="Friday Night Trivia"
                    value={settings.gameName}
                    onChange={(e) => updateSettings({ gameName: e.target.value })}
                    maxLength={100}
                  />
                  <div className="input-hint caption">
                    Give your game a fun name
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="maxTeams" className="form-label headline">
                    Max Teams
                  </label>
                  <select
                    id="maxTeams"
                    className="input"
                    value={settings.maxTeams}
                    onChange={(e) => updateSettings({ maxTeams: parseInt(e.target.value) })}
                  >
                    <option value={0}>Unlimited</option>
                    <option value={4}>4 teams</option>
                    <option value={6}>6 teams</option>
                    <option value={8}>8 teams</option>
                    <option value={10}>10 teams</option>
                    <option value={12}>12 teams</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="roundCount" className="form-label headline">
                    Number of Rounds
                  </label>
                  <select
                    id="roundCount"
                    className="input"
                    value={settings.roundCount}
                    onChange={(e) => updateSettings({ roundCount: parseInt(e.target.value) })}
                  >
                    <option value={5}>5 rounds</option>
                    <option value={10}>10 rounds</option>
                    <option value={15}>15 rounds</option>
                    <option value={20}>20 rounds</option>
                    <option value={25}>25 rounds</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="difficulty" className="form-label headline">
                    Default Difficulty
                  </label>
                  <select
                    id="difficulty"
                    className="input"
                    value={settings.defaultDifficulty}
                    onChange={(e) => updateSettings({ defaultDifficulty: e.target.value as any })}
                  >
                    <option value="mixed">Mixed (Easy, Medium, Hard)</option>
                    <option value="easy">Easy Only</option>
                    <option value="medium">Medium Only</option>
                    <option value="hard">Hard Only</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="answerTime" className="form-label headline">
                    Answer Time Limit
                  </label>
                  <select
                    id="answerTime"
                    className="input"
                    value={settings.answerTimeLimit}
                    onChange={(e) => updateSettings({ answerTimeLimit: parseInt(e.target.value) })}
                  >
                    <option value={5}>5 seconds</option>
                    <option value={10}>10 seconds</option>
                    <option value={15}>15 seconds</option>
                    <option value={20}>20 seconds</option>
                    <option value={30}>30 seconds</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        );

      case 'review':
        return (
          <div className="create-step">
            <div className="step-header">
              <h2 className="title-2">Review & Create</h2>
              <p className="body">Review your game settings before creating</p>
            </div>

            <div className="review-summary">
              <div className="summary-section">
                <h3 className="headline">Game Details</h3>
                <div className="summary-grid">
                  <div className="summary-item">
                    <span className="summary-label">Host:</span>
                    <span className="summary-value">{settings.hostName}</span>
                  </div>
                  {settings.gameName && (
                    <div className="summary-item">
                      <span className="summary-label">Game Name:</span>
                      <span className="summary-value">{settings.gameName}</span>
                    </div>
                  )}
                  <div className="summary-item">
                    <span className="summary-label">Max Teams:</span>
                    <span className="summary-value">
                      {settings.maxTeams === 0 ? 'Unlimited' : settings.maxTeams}
                    </span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Rounds:</span>
                    <span className="summary-value">{settings.roundCount}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Difficulty:</span>
                    <span className="summary-value">{settings.defaultDifficulty}</span>
                  </div>
                  <div className="summary-item">
                    <span className="summary-label">Answer Time:</span>
                    <span className="summary-value">{settings.answerTimeLimit} seconds</span>
                  </div>
                </div>
              </div>

              <div className="summary-section">
                <h3 className="headline">Selected Genres ({settings.selectedGenres.length})</h3>
                <div className="genre-tags-review">
                  {settings.selectedGenres.map(genreId => (
                    <span key={genreId} className="genre-tag-review">
                      {genreId}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="create-game-page">
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

      {/* Progress Indicator */}
      <div className="progress-container">
        <div className="container">
          <div className="progress-steps">
            <div className={`progress-step ${currentStep === 'genres' ? 'active' : 
                           ['settings', 'review'].includes(currentStep) ? 'completed' : ''}`}>
              <div className="step-number">1</div>
              <span className="step-label">Genres</span>
            </div>
            <div className={`progress-step ${currentStep === 'settings' ? 'active' : 
                           currentStep === 'review' ? 'completed' : ''}`}>
              <div className="step-number">2</div>
              <span className="step-label">Settings</span>
            </div>
            <div className={`progress-step ${currentStep === 'review' ? 'active' : ''}`}>
              <div className="step-number">3</div>
              <span className="step-label">Review</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="page-main">
        <div className="form-container">
          <div className="create-form-card card">
            {renderStepContent()}

            {/* Error Message */}
            {error && (
              <div className="error-message-container">
                <span className="error-message caption error">{error}</span>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="step-navigation">
              {currentStep !== 'genres' && (
                <button 
                  className="btn btn-tertiary"
                  onClick={prevStep}
                  disabled={loading}
                >
                  ← Previous
                </button>
              )}
              
              {currentStep !== 'review' ? (
                <button 
                  className="btn btn-primary"
                  onClick={nextStep}
                  disabled={loading}
                >
                  Next →
                </button>
              ) : (
                <button 
                  className={`btn btn-primary btn-large ${loading ? 'loading' : ''}`}
                  onClick={handleCreateGame}
                  disabled={loading}
                >
                  {loading ? 'Creating Game...' : 'Create Game'}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CreateGamePage;