import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../../context/GameContext';
import Logo from '../../components/common/Logo';
import '../../styles/pages/create-game.css';

const ALB_URL = import.meta.env.VITE_ALB_URL || 'http://localhost:8002';

// Actual genres from songs_converted.csv - NO CATEGORIES
const AVAILABLE_GENRES = [
  'rock',
  'pop',
  'electronic',
  'hip-hop',
  'soundtracks',
  'mizrahit',
  'israeli-rock-pop',
  'israeli-cover',
  'israeli-pop',
  'israeli-rap-hip-hop'
];

const CreateGamePage: React.FC = () => {
  const navigate = useNavigate();
  const { createGame } = useGame();
  
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const generateGameCode = (): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev => 
      prev.includes(genre) 
        ? prev.filter(g => g !== genre)
        : [...prev, genre]
    );
    setError('');
  };

  const handleCreateGame = async () => {
    if (selectedGenres.length === 0) {
      setError('Please select at least one genre');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      const gameCode = generateGameCode();
      
      // Call backend API to notify WebSocket service about new game
      try {
        const response = await fetch(`${ALB_URL}/api/game/${gameCode}/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'game_created',
            settings: {
              max_rounds: 10,
              genres: selectedGenres,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('Backend API call failed:', response.status, errorText);
          throw new Error(`Failed to create game: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('Game created in WebSocket service:', result);
      } catch (err) {
        console.error('Failed to notify WebSocket service:', err);
        throw err; // Don't continue if we can't create the game
      }

      // Store in context
      createGame(gameCode);
      
      // Navigate to waiting room
      navigate(`/game/${gameCode}/lobby`);
    } catch (err) {
      console.error('Error creating game:', err);
      setError('Failed to create game. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Format genre names for display (replace hyphens with spaces, capitalize)
  const formatGenreName = (genre: string): string => {
    return genre
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="create-game-page">
      <header className="page-header">
        <div className="header-content">
          <Logo size="medium" />
          <button className="btn-back" onClick={() => navigate('/')}>
            ← Back
          </button>
        </div>
      </header>

      <main className="page-main">
        <div className="create-container">
          <div className="create-card">
            <h1 className="page-title">Create New Game</h1>
            <p className="page-subtitle">Select music genres for your game</p>

            {error && (
              <div className="error-banner">
                <span>⚠️ {error}</span>
              </div>
            )}

            <div className="genres-section">
              <div className="genre-grid-flat">
                {AVAILABLE_GENRES.map(genre => (
                  <button
                    key={genre}
                    className={`genre-chip ${selectedGenres.includes(genre) ? 'selected' : ''}`}
                    onClick={() => toggleGenre(genre)}
                  >
                    <span className="genre-name">{formatGenreName(genre)}</span>
                    {selectedGenres.includes(genre) && (
                      <span className="check-icon">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="selected-summary">
              <span className="summary-text">
                {selectedGenres.length === 0
                  ? 'No genres selected'
                  : `${selectedGenres.length} genre${selectedGenres.length > 1 ? 's' : ''} selected`}
              </span>
            </div>

            <div className="action-section">
              <button
                className={`btn-create ${loading ? 'loading' : ''}`}
                onClick={handleCreateGame}
                disabled={loading || selectedGenres.length === 0}
              >
                {loading ? 'Creating Game...' : 'Create Game'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default CreateGamePage;
