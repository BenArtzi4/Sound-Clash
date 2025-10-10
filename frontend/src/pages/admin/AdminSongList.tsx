import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI, Song } from '../../services/adminAPI';
import Logo from '../../components/common/Logo';
import '../../styles/pages/admin-songs.css';

const AdminSongList: React.FC = () => {
  const navigate = useNavigate();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [sortBy, setSortBy] = useState('title');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const genres = adminAPI.getAvailableGenres();

  useEffect(() => {
    loadSongs();
  }, [page, genreFilter, sortBy, sortOrder]);

  const loadSongs = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getSongs({
        page,
        per_page: 20,
        search: search || undefined,
        genre: genreFilter || undefined,
        sort_by: sortBy,
        sort_order: sortOrder
      });
      
      setSongs(response.songs);
      setTotalPages(response.total_pages);
    } catch (error) {
      console.error('Error loading songs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPage(1);
    loadSongs();
  };

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) {
      return;
    }

    try {
      await adminAPI.deleteSong(id);
      loadSongs();
    } catch (error) {
      console.error('Error deleting song:', error);
      alert('Failed to delete song');
    }
  };

  const formatGenreName = (genre: string) => {
    return genre.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="admin-songs-page">
      <header className="admin-header">
        <div className="header-content">
          <Logo size="medium" />
          <h1>Song Library</h1>
          <button className="btn-back" onClick={() => navigate('/admin')}>
            ← Dashboard
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-container">
          {/* Toolbar */}
          <div className="toolbar">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search songs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button onClick={handleSearch}>🔍</button>
            </div>

            <select 
              value={genreFilter} 
              onChange={(e) => { setGenreFilter(e.target.value); setPage(1); }}
              className="filter-select"
            >
              <option value="">All Genres</option>
              {genres.map(genre => (
                <option key={genre} value={genre}>
                  {formatGenreName(genre)}
                </option>
              ))}
            </select>

            <select 
              value={sortBy} 
              onChange={(e) => setSortBy(e.target.value)}
              className="sort-select"
            >
              <option value="title">Sort by Title</option>
              <option value="artist">Sort by Artist</option>
              <option value="created_at">Sort by Date</option>
            </select>

            <button 
              className="sort-order-btn"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>

            <button 
              className="btn-add"
              onClick={() => navigate('/admin/songs/new')}
            >
              ➕ Add Song
            </button>
          </div>

          {/* Song Table */}
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading songs...</p>
            </div>
          ) : (
            <>
              <div className="songs-table">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Artist</th>
                      <th>Genres</th>
                      <th>YouTube ID</th>
                      <th>Duration</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {songs.map((song) => (
                      <tr key={song.id}>
                        <td className="song-title">{song.title}</td>
                        <td>{song.artist}</td>
                        <td>
                          <div className="genre-tags">
                            {song.genres.map(genre => (
                              <span key={genre} className="genre-tag">
                                {formatGenreName(genre)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="youtube-id">
                          <a 
                            href={`https://youtube.com/watch?v=${song.youtube_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {song.youtube_id}
                          </a>
                        </td>
                        <td>{song.duration_seconds ? `${Math.floor(song.duration_seconds / 60)}:${(song.duration_seconds % 60).toString().padStart(2, '0')}` : 'N/A'}</td>
                        <td className="actions">
                          <button 
                            className="btn-edit"
                            onClick={() => navigate(`/admin/songs/${song.id}/edit`)}
                          >
                            ✏️
                          </button>
                          <button 
                            className="btn-delete"
                            onClick={() => handleDelete(song.id, song.title)}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="pagination">
                <button 
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  ← Previous
                </button>
                <span>Page {page} of {totalPages}</span>
                <button 
                  disabled={page === totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next →
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminSongList;
