import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '../../context/GameContext';
import Logo from '../../components/common/Logo';
import '../../styles/pages/create-game.css';

const ALB_URL = import.meta.env.VITE_ALB_URL || 'http://localhost:8002';

// Simplified genre list
const GENRE_OPTIONS = [
  { id: 'israeli-rock', name: 'Israeli Rock', category: 'Israeli' },
  { id: 'israeli-pop', name: 'Israeli Pop', category: 'Israeli' },
  { id: 'hafla', name: 'Hafla', category: 'Israeli' },
  { id: 'israeli-classics', name: 'Israeli Classics', category: 'Israeli' },
  { id: 'rock', name: 'Rock', category: 'Styles' },
  { id: 'pop', name: 'Pop', category: 'Styles' },
  { id: 'hip-hop', name: 'Hip-Hop', category: 'Styles' },
  { id: 'electronic', name: 'Electronic', category: 'Styles' },
  { id: '60s-70s', name: '60s-70s', category: 'Decades' },
  { id: '80s', name: '80s', category: 'Decades' },
  { id: '90s', name: '90s', category: 'Decades' },
  { id: '2000s', name: '2000s', category: 'Decades' },
  { id: 'movies', name: 'Movie Soundtracks', category: 'Media' },
  { id: 'tv', name: 'TV Themes', category: 'Media' },
  { id: 'disney', name: 'Disney', category: 'Media' },
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

  const toggleGenre = (genreId: string) => {
    setSelectedGenres(prev => 
      prev.includes(genreId) 
        ? prev.filter(g => g !== genreId)
        : [...prev, genreId]
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
      
      // Call backend API to create game
      try {
        const response = await fetch(`${ALB_URL}/api/game/${gameCode}/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            max_rounds: 10,
            genres: selectedGenres,
          }),
        });

        if (!response.ok) {
          console.warn('Backend API call failed, continuing anyway');
        }
      } catch (err) {
        console.warn('Could not connect to backend:', err);
        // Continue anyway for offline development
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

  // Group genres by category
  const genresByCategory: Record<string, typeof GENRE_OPTIONS> = {};
  GENRE_OPTIONS.forEach(genre => {
    if (!genresByCategory[genre.category]) {
      genresByCategory[genre.category] = [];
    }
    genresByCategory[genre.category].push(genre);
  });

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
              {Object.entries(genresByCategory).map(([category, genres]) => (
                <div key={category} className="genre-category">
                  <h3 className="category-title">{category}</h3>
                  <div className="genre-grid">
                    {genres.map(genre => (
                      <button
                        key={genre.id}
                        className={`genre-chip ${selectedGenres.includes(genre.id) ? 'selected' : ''}`}
                        onClick={() => toggleGenre(genre.id)}
                      >
                        <span className="genre-name">{genre.name}</span>
                        {selectedGenres.includes(genre.id) && (
                          <span className="check-icon">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
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
