import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import Logo from '../components/Logo';

interface Genre {
  id: string;
  label: string;
  description: string;
}

const CreateGamePage: React.FC = () => {
  const navigate = useNavigate();
  const { createGame, state } = useGame();
  
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // TODO: Replace with actual API call to fetch genres
    const fetchGenres = async () => {
      try {
        setLoading(true);
        // TODO: Implement actual API call
        // const response = await fetch('/api/genres');
        // const genresData = await response.json();
        // setGenres(genresData);
        
        // For now, simulate loading and show empty state
        setTimeout(() => {
          setGenres([]); // Empty array to show "no genres available" state
          setLoading(false);
        }, 1000);
      } catch (error) {
        console.error('Failed to fetch genres:', error);
        setError('Failed to load music genres. Please try again.');
        setLoading(false);
      }
    };

    fetchGenres();
  }, []);

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
    // Validate at least one genre is selected (when genres are available)
    if (genres.length > 0 && selectedGenres.length === 0) {
      setError('Please select at least one music genre');
      return;
    }

    try {
      // Generate a unique game code
      const gameCode = generateGameCode();
      
      // TODO: Replace with actual API call to create game
      // const response = await fetch('/api/games', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     gameCode,
      //     settings: {
      //       selectedGenres,
      //       difficulty: 'mixed',
      //       answerTime: 10,
      //       maxTeams: 0 // unlimited
      //     }
      //   })
      // });
      
      // For now, just use the context
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
                
                {loading ? (
                  <div className="genre-loading">
                    <p className="body">Loading available genres...</p>
                  </div>
                ) : genres.length > 0 ? (
                  <>
                    <div className="genre-grid">
                      {genres.map(genre => (
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
                  </>
                ) : (
                  <div className="no-genres">
                    <p className="body">No music genres available at the moment.</p>
                    <p className="caption">The game database is being set up. You can still create a game without genre selection.</p>
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
                className={`btn btn-primary btn-large ${state.loading || loading ? 'loading' : ''}`}
                onClick={handleCreateGame}
                disabled={state.loading || loading}
              >
                {state.loading || loading ? 'Creating Game...' : 'Create Game'}
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