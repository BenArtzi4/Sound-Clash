/**
 * Song Management Admin Page
 * Simple interface for managing songs without complex analytics
 */

import React, { useState, useEffect } from 'react';
import { songApiService, Song, Genre, SongSearchRequest } from '../../services/songApi';
import './SongManagementPage.css';

interface SongManagementPageProps {}

const SongManagementPage: React.FC<SongManagementPageProps> = () => {
  // State management
  const [songs, setSongs] = useState<Song[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Search/filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalSongs, setTotalSongs] = useState(0);
  
  // Selection state
  const [selectedSongs, setSelectedSongs] = useState<Set<number>>(new Set());
  
  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSong, setEditingSong] = useState<Song | null>(null);

  // Load initial data
  useEffect(() => {
    loadData();
  }, []);

  // Search when filters change
  useEffect(() => {
    if (!loading) {
      performSearch();
    }
  }, [searchTerm, selectedGenres, showInactive, currentPage]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [songsData, genresData] = await Promise.all([
        songApiService.searchSongs({ page: 1, page_size: 20 }),
        songApiService.getAllGenres()
      ]);
      
      setSongs(songsData.songs);
      setTotalPages(songsData.total_pages);
      setTotalSongs(songsData.total_songs);
      setGenres(genresData.genres);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async () => {
    try {
      setLoading(true);
      const searchRequest: SongSearchRequest = {
        search_term: searchTerm || undefined,
        genres: selectedGenres.length > 0 ? selectedGenres : undefined,
        is_active: showInactive ? undefined : true,
        page: currentPage,
        page_size: 20
      };
      
      const result = await songApiService.searchSongs(searchRequest);
      setSongs(result.songs);
      setTotalPages(result.total_pages);
      setTotalSongs(result.total_songs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSong = async (songId: number) => {
    if (!confirm('Are you sure you want to delete this song?')) return;
    
    try {
      await songApiService.deleteSong(songId);
      await performSearch(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete song');
    }
  };

  const handleBulkActivate = async () => {
    if (selectedSongs.size === 0) return;
    
    try {
      const result = await songApiService.bulkActivate(Array.from(selectedSongs));
      alert(`Activated ${result.successful} songs. ${result.failed} failed.`);
      setSelectedSongs(new Set());
      await performSearch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk activation failed');
    }
  };

  const handleBulkDeactivate = async () => {
    if (selectedSongs.size === 0) return;
    
    try {
      const result = await songApiService.bulkDeactivate(Array.from(selectedSongs));
      alert(`Deactivated ${result.successful} songs. ${result.failed} failed.`);
      setSelectedSongs(new Set());
      await performSearch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk deactivation failed');
    }
  };

  const toggleSongSelection = (songId: number) => {
    const newSelection = new Set(selectedSongs);
    if (newSelection.has(songId)) {
      newSelection.delete(songId);
    } else {
      newSelection.add(songId);
    }
    setSelectedSongs(newSelection);
  };

  const toggleGenreFilter = (genreSlug: string) => {
    if (selectedGenres.includes(genreSlug)) {
      setSelectedGenres(selectedGenres.filter(g => g !== genreSlug));
    } else {
      setSelectedGenres([...selectedGenres, genreSlug]);
    }
  };

  if (loading && songs.length === 0) {
    return (
      <div className="song-management-page">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading songs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="song-management-page">
      <div className="page-header">
        <h1>Song Management</h1>
        <button 
          className="btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          Add New Song
        </button>
      </div>

      {error && (
        <div className="error-message">
          <p>❌ {error}</p>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Search and Filters */}
      <div className="search-filters">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search songs by title or artist..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filters-row">
          <div className="genre-filters">
            <label>Genres:</label>
            <div className="genre-chips">
              {genres.slice(0, 8).map(genre => (
                <button
                  key={genre.slug}
                  className={`genre-chip ${selectedGenres.includes(genre.slug) ? 'active' : ''}`}
                  onClick={() => toggleGenreFilter(genre.slug)}
                >
                  {genre.name} ({genre.song_count})
                </button>
              ))}
            </div>
          </div>

          <div className="filter-options">
            <label>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive songs
            </label>
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedSongs.size > 0 && (
        <div className="bulk-actions">
          <p>{selectedSongs.size} songs selected</p>
          <button onClick={handleBulkActivate} className="btn-success">
            Activate Selected
          </button>
          <button onClick={handleBulkDeactivate} className="btn-warning">
            Deactivate Selected
          </button>
          <button onClick={() => setSelectedSongs(new Set())} className="btn-secondary">
            Clear Selection
          </button>
        </div>
      )}

      {/* Songs Table */}
      <div className="songs-table-container">
        <div className="results-info">
          <p>Showing {songs.length} of {totalSongs} songs</p>
        </div>

        <table className="songs-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={selectedSongs.size === songs.length && songs.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedSongs(new Set(songs.map(s => s.id)));
                    } else {
                      setSelectedSongs(new Set());
                    }
                  }}
                />
              </th>
              <th>Title</th>
              <th>Artist</th>
              <th>Genres</th>
              <th>YouTube</th>
              <th>Plays</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {songs.map(song => (
              <tr key={song.id} className={!song.is_active ? 'inactive' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedSongs.has(song.id)}
                    onChange={() => toggleSongSelection(song.id)}
                  />
                </td>
                <td className="song-title">{song.title}</td>
                <td>{song.artist}</td>
                <td>
                  <div className="genre-tags">
                    {song.genres.map(genre => (
                      <span key={genre} className="genre-tag">{genre}</span>
                    ))}
                  </div>
                </td>
                <td>
                  {song.youtube_id ? (
                    <a 
                      href={`https://www.youtube.com/watch?v=${song.youtube_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="youtube-link"
                    >
                      ▶️ Watch
                    </a>
                  ) : (
                    <span className="no-youtube">No Video</span>
                  )}
                </td>
                <td>{song.play_count}</td>
                <td>
                  <span className={`status ${song.is_active ? 'active' : 'inactive'}`}>
                    {song.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button 
                      onClick={() => setEditingSong(song)}
                      className="btn-edit"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => handleDeleteSong(song.id)}
                      className="btn-delete"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {songs.length === 0 && !loading && (
          <div className="no-results">
            <p>No songs found matching your criteria.</p>
            <button onClick={() => {
              setSearchTerm('');
              setSelectedGenres([]);
              setShowInactive(false);
              setCurrentPage(1);
            }}>
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button 
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="btn-secondary"
          >
            Previous
          </button>
          
          <span className="page-info">
            Page {currentPage} of {totalPages}
          </span>
          
          <button 
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="btn-secondary"
          >
            Next
          </button>
        </div>
      )}

      {/* Modals would go here - CreateSongModal and EditSongModal */}
      {showCreateModal && (
        <CreateSongModal
          genres={genres}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            performSearch();
          }}
        />
      )}

      {editingSong && (
        <EditSongModal
          song={editingSong}
          genres={genres}
          onClose={() => setEditingSong(null)}
          onSuccess={() => {
            setEditingSong(null);
            performSearch();
          }}
        />
      )}
    </div>
  );
};

// Simple Create Song Modal Component
const CreateSongModal: React.FC<{
  genres: Genre[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ genres, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    youtube_id: '',
    genres: [] as string[]
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title.trim() || !formData.artist.trim() || formData.genres.length === 0) {
      setError('Title, artist, and at least one genre are required');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      
      await songApiService.createSong({
        title: formData.title.trim(),
        artist: formData.artist.trim(),
        youtube_id: formData.youtube_id.trim() || undefined,
        genres: formData.genres
      });
      
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create song');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Add New Song</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Song title"
              required
            />
          </div>

          <div className="form-group">
            <label>Artist *</label>
            <input
              type="text"
              value={formData.artist}
              onChange={(e) => setFormData(prev => ({ ...prev, artist: e.target.value }))}
              placeholder="Artist name"
              required
            />
          </div>

          <div className="form-group">
            <label>YouTube ID</label>
            <input
              type="text"
              value={formData.youtube_id}
              onChange={(e) => setFormData(prev => ({ ...prev, youtube_id: e.target.value }))}
              placeholder="YouTube video ID (optional)"
            />
          </div>

          <div className="form-group">
            <label>Genres * (select at least one)</label>
            <div className="genre-checkboxes">
              {genres.map(genre => (
                <label key={genre.slug} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.genres.includes(genre.slug)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData(prev => ({ 
                          ...prev, 
                          genres: [...prev.genres, genre.slug] 
                        }));
                      } else {
                        setFormData(prev => ({ 
                          ...prev, 
                          genres: prev.genres.filter(g => g !== genre.slug) 
                        }));
                      }
                    }}
                  />
                  {genre.name}
                </label>
              ))}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Creating...' : 'Create Song'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Simple Edit Song Modal Component  
const EditSongModal: React.FC<{
  song: Song;
  genres: Genre[];
  onClose: () => void;
  onSuccess: () => void;
}> = ({ song, genres, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    title: song.title,
    artist: song.artist,
    youtube_id: song.youtube_id || '',
    genres: song.genres,
    is_active: song.is_active
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setSaving(true);
      setError(null);
      
      await songApiService.updateSong(song.id, {
        title: formData.title.trim() || undefined,
        artist: formData.artist.trim() || undefined,
        youtube_id: formData.youtube_id.trim() || undefined,
        genres: formData.genres,
        is_active: formData.is_active
      });
      
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update song');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Edit Song</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="error-message">{error}</div>}
          
          <div className="form-group">
            <label>Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label>Artist</label>
            <input
              type="text"
              value={formData.artist}
              onChange={(e) => setFormData(prev => ({ ...prev, artist: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label>YouTube ID</label>
            <input
              type="text"
              value={formData.youtube_id}
              onChange={(e) => setFormData(prev => ({ ...prev, youtube_id: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label>Genres</label>
            <div className="genre-checkboxes">
              {genres.map(genre => (
                <label key={genre.slug} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.genres.includes(genre.slug)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFormData(prev => ({ 
                          ...prev, 
                          genres: [...prev.genres, genre.slug] 
                        }));
                      } else {
                        setFormData(prev => ({ 
                          ...prev, 
                          genres: prev.genres.filter(g => g !== genre.slug) 
                        }));
                      }
                    }}
                  />
                  {genre.name}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
              />
              Active
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Updating...' : 'Update Song'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SongManagementPage;