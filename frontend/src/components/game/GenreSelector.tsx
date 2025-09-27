import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import type { GenreCategory, GenreOption } from '../types';

interface GenreSelectorProps {
  selectedGenres: string[];
  onSelectionChange: (genres: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
}

const GenreSelector: React.FC<GenreSelectorProps> = ({
  selectedGenres,
  onSelectionChange,
  loading = false,
  disabled = false
}) => {
  const [categories, setCategories] = useState<Record<string, GenreCategory>>({});
  const [loadingGenres, setLoadingGenres] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const fetchGenres = async () => {
      try {
        setLoadingGenres(true);
        setError('');
        
        const response = await apiService.getGenreCategories();
        if (response.success && response.data) {
          setCategories(response.data);
        } else {
          throw new Error(response.error || 'Failed to fetch genres');
        }
      } catch (err: any) {
        console.error('Failed to fetch genres:', err);
        setError('Failed to load music genres. Please try again.');
        
        // Fallback to sample data for development
        setCategories({
          israeli: {
            name: "Israeli Music",
            description: "Israeli songs across all styles",
            icon: "🇮🇱",
            genres: [
              { id: "israeli-rock", label: "Israeli Rock", description: "Israeli rock bands and anthems" },
              { id: "israeli-pop", label: "Israeli Pop", description: "Modern Israeli pop hits" },
              { id: "israeli-hafla", label: "Israeli Hafla", description: "Party and celebration songs" }
            ]
          },
          styles: {
            name: "Musical Styles",
            description: "Genre-based categories",
            icon: "🎸",
            genres: [
              { id: "rock", label: "Rock", description: "Classic rock anthems" },
              { id: "pop", label: "Pop", description: "Mainstream pop hits" },
              { id: "hip-hop", label: "Hip-Hop", description: "Rap and hip-hop beats" }
            ]
          }
        });
      } finally {
        setLoadingGenres(false);
      }
    };

    fetchGenres();
  }, []);

  const toggleGenre = (genreId: string) => {
    if (disabled) return;
    
    const newSelection = selectedGenres.includes(genreId)
      ? selectedGenres.filter(id => id !== genreId)
      : [...selectedGenres, genreId];
    
    onSelectionChange(newSelection);
  };

  const selectAllInCategory = (categoryGenres: GenreOption[]) => {
    if (disabled) return;
    
    const categoryIds = categoryGenres.map(g => g.id);
    const allSelected = categoryIds.every(id => selectedGenres.includes(id));
    
    if (allSelected) {
      onSelectionChange(selectedGenres.filter(id => !categoryIds.includes(id)));
    } else {
      const newSelection = [...new Set([...selectedGenres, ...categoryIds])];
      onSelectionChange(newSelection);
    }
  };

  const clearAll = () => {
    if (disabled) return;
    onSelectionChange([]);
  };

  if (loadingGenres || loading) {
    return (
      <div className="genre-selector">
        <div className="genre-loading">
          <p className="body">Loading music genres...</p>
          <div className="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="genre-selector">
        <div className="genre-error">
          <p className="body error">{error}</p>
          <button 
            className="btn btn-tertiary"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (Object.keys(categories).length === 0) {
    return (
      <div className="genre-selector">
        <div className="no-genres">
          <p className="body">No music genres available at the moment.</p>
          <p className="caption">The game database is being set up. You can still create a game.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="genre-selector">
      {/* Selection Summary */}
      <div className="genre-summary">
        <div className="summary-text">
          <span className="body">
            {selectedGenres.length === 0 ? 'No genres selected' : 
             `${selectedGenres.length} genre${selectedGenres.length !== 1 ? 's' : ''} selected`}
          </span>
        </div>
        {selectedGenres.length > 0 && (
          <button 
            className="btn btn-tertiary btn-small"
            onClick={clearAll}
            disabled={disabled}
          >
            Clear All
          </button>
        )}
      </div>

      {/* Genre Categories */}
      <div className="genre-categories">
        {Object.entries(categories).map(([categoryId, category]) => {
          const categoryGenres = category.genres;
          const selectedInCategory = categoryGenres.filter(g => selectedGenres.includes(g.id)).length;
          const allSelected = selectedInCategory === categoryGenres.length;
          const someSelected = selectedInCategory > 0;

          return (
            <div key={categoryId} className="genre-category">
              <div className="category-header">
                <div className="category-info">
                  <h3 className="headline">
                    {category.icon && <span className="category-icon">{category.icon}</span>}
                    {category.name}
                  </h3>
                  <p className="caption">{category.description}</p>
                </div>
                <button
                  className={`category-select-all ${allSelected ? 'selected' : someSelected ? 'partial' : ''}`}
                  onClick={() => selectAllInCategory(categoryGenres)}
                  disabled={disabled}
                  title={allSelected ? 'Deselect all' : 'Select all in category'}
                >
                  {allSelected ? '✓' : someSelected ? '◐' : '○'} 
                  <span className="btn-text">
                    {allSelected ? 'All' : someSelected ? `${selectedInCategory}/${categoryGenres.length}` : 'None'}
                  </span>
                </button>
              </div>

              <div className="genre-grid">
                {categoryGenres.map(genre => (
                  <button
                    key={genre.id}
                    type="button"
                    className={`genre-option ${selectedGenres.includes(genre.id) ? 'selected' : ''}`}
                    onClick={() => toggleGenre(genre.id)}
                    disabled={disabled}
                  >
                    <div className="genre-option-content">
                      <span className="genre-label headline">{genre.label}</span>
                      <span className="genre-description caption">{genre.description}</span>
                      {genre.song_count !== undefined && (
                        <span className="genre-song-count caption">
                          {genre.song_count} songs
                        </span>
                      )}
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
            </div>
          );
        })}
      </div>

      {/* Selected Preview */}
      {selectedGenres.length > 0 && (
        <div className="genre-selection-preview">
          <p className="caption">Selected genres:</p>
          <div className="selected-genre-tags">
            {selectedGenres.slice(0, 5).map(genreId => {
              const genre = Object.values(categories)
                .flatMap(cat => cat.genres)
                .find(g => g.id === genreId);
              return genre ? (
                <span key={genreId} className="genre-tag">
                  {genre.label}
                </span>
              ) : null;
            })}
            {selectedGenres.length > 5 && (
              <span className="genre-tag-more">
                +{selectedGenres.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GenreSelector;