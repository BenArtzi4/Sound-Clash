import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import Logo from '../components/Logo';

// Genre options
const GENRE_OPTIONS = [
  { id: 'rock', label: 'Rock', description: 'Classic and modern rock hits' },
  { id: 'pop', label: 'Pop', description: 'Chart-topping pop songs' },
  { id: '80s', label: '80s', description: 'Iconic 1980s hits' },
  { id: '90s', label: '90s', description: 'Nostalgic 1990s favorites' },
  { id: 'movies', label: 'Movies', description: 'Soundtrack and theme songs' },
  { id: 'tv', label: 'TV Shows', description: 'Television theme songs' },
  { id: 'jazz', label: 'Jazz', description: 'Classic jazz standards' },
  { id: 'classical', label: 'Classical', description: 'Orchestral masterpieces' },
];

const CreateGamePage: React.FC = () => {
  const navigate = useNavigate();
  const { createGame, state } = useGame();
  
  const [selectedGenres, setSelectedGenres] = useState<string[]>(['rock', 'pop']);
  const [error, setError] = useState<string>('');

  const toggleGenre = (genreId: string) => {
    setSelectedGenres(prev => 
      prev.includes(genreId) 
        ? prev.filter(id => id !== genreId)
        : [...prev, genreId]
    );
    setError(''); // Clear error when user makes changes
  };

  const generateGameCode = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleCreateGame = async () => {
    // Validate at least one genre is selected
    if (selectedGenres.length === 0) {
      setError('Please select at least one music genre');
      return;
    }

    try {
      // Generate a unique game code
      const gameCode = generateGameCode();
      
      // Here we would call the API to create the game
      // For now, we'll just use the context
      createGame(gameCode);
      
      // Navigate to waiting room as manager
      navigate(`/game/${gameCode}/lobby`);
    } catch (error) {
      setError('Failed to create game. Please try again.');
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

      {/* Main content */}
      <main className="page-main">
        <div className="form-container">
          <div className="create-form-card card">
            <div className="form-header">
              <h1 className="title-1">Create Game</h1>
              <p className="subhead">Set up a new Sound Clash game for your group</p>
            </div>

            <div className="create-form">
              {/* Genre Selection */}
              <div className="form-section">
                <h2 className="title-2">Select Music Genres</h2>
                <p className="body">Choose the types of music for your game</p>
                
                <div className="genre-grid">
                  {GENRE_OPTIONS.map(genre => (
                    <button
                      key={genre.id}
                      type="button"
                      className={`genre-option ${selectedGenres.includes(genre.id) ? 'selected' : ''}`}
                      onClick={() => toggleGenre(genre.id)}
                    >
                      <div className="genre-option-content">
                        <span className="genre-label headline">{genre.label}</span>
                        <span className="genre-description caption">{genre.description}</span>
                      </div>
                      <div className="genre-checkbox">
                        {selectedGenres.includes(genre.id) && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path 
                              d="M13.5 4.5L6 12L2.5 8.5" 
                              stroke="currentColor" 
                              strokeWidth="2" 
                              strokeLinecap="round" 
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </div>
                    </button>
                  ))}
                </div>

                {selectedGenres.length > 0 && (
                  <div className="selected-summary">
                    <p className="caption">
                      Selected: {selectedGenres.length} genre{selectedGenres.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>

              {/* Game Settings Preview */}
              <div className="form-section">
                <h2 className="title-2">Game Settings</h2>
                <div className="settings-preview">
                  <div className="setting-item">
                    <span className="setting-label body">Difficulty:</span>
                    <span className="setting-value">Mixed (Easy, Medium, Hard)</span>
                  </div>
                  <div className="setting-item">
                    <span className="setting-label body">Round Timer:</span>
                    <span className="setting-value">10 seconds per answer</span>
                  </div>
                  <div className="setting-item">
                    <span className="setting-label body">Teams:</span>
                    <span className="setting-value">Unlimited</span>
                  </div>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="error-message-container">
                  <span className="error-message caption error">{error}</span>
                </div>
              )}

              {/* Create Button */}
              <button 
                className={`btn btn-primary btn-large ${state.loading ? 'loading' : ''}`}
                onClick={handleCreateGame}
                disabled={state.loading}
              >
                {state.loading ? 'Creating Game...' : 'Create Game'}
              </button>
            </div>

            {/* Help text */}
            <div className="help-text">
              <p className="caption">
                You'll receive a 6-digit game code that players can use to join your game.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CreateGamePage;