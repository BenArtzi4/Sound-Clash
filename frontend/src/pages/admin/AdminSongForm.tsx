import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminAPI, SongCreate } from '../../services/adminAPI';
import Logo from '../../components/common/Logo';
import '../../styles/pages/admin-song-form.css';

const AdminSongForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  const [formData, setFormData] = useState<SongCreate>({
    title: '',
    artist: '',
    youtube_id: '',
    duration_seconds: undefined,
    genres: []
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [youtubeValid, setYoutubeValid] = useState<boolean | null>(null);

  const genres = adminAPI.getAvailableGenres();

  useEffect(() => {
    if (isEdit && id) {
      loadSong(parseInt(id));
    }
  }, [id, isEdit]);

  const loadSong = async (songId: number) => {
    try {
      setLoading(true);
      const song = await adminAPI.getSong(songId);
      setFormData({
        title: song.title,
        artist: song.artist,
        youtube_id: song.youtube_id,
        duration_seconds: song.duration_seconds,
        genres: song.genres
      });
    } catch (error) {
      console.error('Error loading song:', error);
      setError('Failed to load song');
    } finally {
      setLoading(false);
    }
  };

  const validateYouTubeId = async (youtubeId: string) => {
    if (!youtubeId) {
      setYoutubeValid(null);
      return;
    }

    // YouTube validation endpoint not implemented yet
    // Just mark as valid for now
    setYoutubeValid(true);
    
    /* TODO: Implement YouTube validation endpoint
    try {
      const result = await adminAPI.validateYouTubeId(youtubeId);
      setYoutubeValid(result.valid);
      
      if (result.valid && result.duration) {
        setFormData(prev => ({
          ...prev,
          duration_seconds: result.duration
        }));
      }
    } catch (error) {
      setYoutubeValid(false);
    }
    */
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.title || !formData.artist || !formData.youtube_id) {
      setError('Please fill in all required fields');
      return;
    }

    if (formData.genres.length === 0) {
      setError('Please select at least one genre');
      return;
    }

    try {
      setLoading(true);
      
      if (isEdit && id) {
        await adminAPI.updateSong(parseInt(id), formData);
      } else {
        await adminAPI.createSong(formData);
      }
      
      navigate('/admin/songs');
    } catch (error: any) {
      console.error('Error saving song:', error);
      setError(error.response?.data?.detail || 'Failed to save song');
    } finally {
      setLoading(false);
    }
  };

  const toggleGenre = (genre: string) => {
    setFormData(prev => ({
      ...prev,
      genres: prev.genres.includes(genre)
        ? prev.genres.filter(g => g !== genre)
        : [...prev.genres, genre]
    }));
  };

  const formatGenreName = (genre: string) => {
    return genre.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  return (
    <div className="admin-song-form-page">
      <header className="admin-header">
        <div className="header-content">
          <Logo size="medium" />
          <h1>{isEdit ? 'Edit Song' : 'Add New Song'}</h1>
          <button className="btn-back" onClick={() => navigate('/admin/songs')}>
            ← Back to List
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-container">
          <div className="form-card">
            {error && (
              <div className="error-banner">
                ⚠️ {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              {/* Title */}
              <div className="form-group">
                <label htmlFor="title">Song Title *</label>
                <input
                  id="title"
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Enter song title"
                  required
                />
              </div>

              {/* Artist */}
              <div className="form-group">
                <label htmlFor="artist">Artist *</label>
                <input
                  id="artist"
                  type="text"
                  value={formData.artist}
                  onChange={(e) => setFormData({ ...formData, artist: e.target.value })}
                  placeholder="Enter artist name"
                  required
                />
              </div>

              {/* YouTube ID */}
              <div className="form-group">
                <label htmlFor="youtube_id">YouTube ID *</label>
                <div className="youtube-id-input">
                  <input
                    id="youtube_id"
                    type="text"
                    value={formData.youtube_id}
                    onChange={(e) => {
                      setFormData({ ...formData, youtube_id: e.target.value });
                      setYoutubeValid(null);
                    }}
                    onBlur={(e) => validateYouTubeId(e.target.value)}
                    placeholder="e.g., dQw4w9WgXcQ"
                    required
                  />
                  {youtubeValid === true && <span className="validation-icon valid">✓</span>}
                  {youtubeValid === false && <span className="validation-icon invalid">✗</span>}
                </div>
                {formData.youtube_id && (
                  <a 
                    href={`https://youtube.com/watch?v=${formData.youtube_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="youtube-link"
                  >
                    Preview on YouTube →
                  </a>
                )}
              </div>

              {/* Duration */}
              <div className="form-group">
                <label htmlFor="duration">Duration (seconds)</label>
                <input
                  id="duration"
                  type="number"
                  value={formData.duration_seconds || ''}
                  onChange={(e) => setFormData({ 
                    ...formData, 
                    duration_seconds: e.target.value ? parseInt(e.target.value) : undefined 
                  })}
                  placeholder="e.g., 240"
                  min="1"
                />
                <small>Leave empty to auto-detect</small>
              </div>

              {/* Genres */}
              <div className="form-group">
                <label>Genres * (select at least one)</label>
                <div className="genre-checkboxes">
                  {genres.map(genre => (
                    <label key={genre} className="genre-checkbox">
                      <input
                        type="checkbox"
                        checked={formData.genres.includes(genre)}
                        onChange={() => toggleGenre(genre)}
                      />
                      <span>{formatGenreName(genre)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* YouTube Preview */}
              {formData.youtube_id && youtubeValid && (
                <div className="youtube-preview">
                  <h3>Preview</h3>
                  <iframe
                    src={`https://www.youtube.com/embed/${formData.youtube_id}`}
                    title="YouTube preview"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                </div>
              )}

              {/* Actions */}
              <div className="form-actions">
                <button 
                  type="button" 
                  className="btn-cancel"
                  onClick={() => navigate('/admin/songs')}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-submit"
                  disabled={loading}
                >
                  {loading ? 'Saving...' : isEdit ? 'Update Song' : 'Add Song'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminSongForm;
