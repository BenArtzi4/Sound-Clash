import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI, GenreStats } from '../../services/adminAPI';
import Logo from '../../components/common/Logo';
import '../../styles/pages/admin-genres.css';

const AdminGenres: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<GenreStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalSongs, setTotalSongs] = useState(0);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const genreStats = await adminAPI.getGenreStats();
      setStats(genreStats);
      setTotalSongs(genreStats.reduce((sum, g) => sum + g.count, 0));
    } catch (error) {
      console.error('Error loading genre stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatGenreName = (genre: string) => {
    return genre.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const getPercentage = (count: number) => {
    return totalSongs > 0 ? ((count / totalSongs) * 100).toFixed(1) : '0.0';
  };

  return (
    <div className="admin-genres-page">
      <header className="admin-header">
        <div className="header-content">
          <Logo size="medium" />
          <h1>Genre Statistics</h1>
          <button className="btn-back" onClick={() => navigate('/admin')}>
            ← Dashboard
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-container">
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading genre stats...</p>
            </div>
          ) : (
            <>
              <div className="stats-summary">
                <h2>Total Songs: {totalSongs}</h2>
                <p>Distributed across {stats.length} genres</p>
              </div>

              <div className="genre-stats-list">
                {stats
                  .sort((a, b) => b.count - a.count)
                  .map((genre, index) => (
                    <div key={genre.genre} className="genre-stat-item">
                      <div className="genre-rank">#{index + 1}</div>
                      <div className="genre-info">
                        <h3 className="genre-name">{formatGenreName(genre.genre)}</h3>
                        <div className="genre-details">
                          <span className="genre-count">{genre.count} songs</span>
                          <span className="genre-percentage">{getPercentage(genre.count)}%</span>
                        </div>
                      </div>
                      <div className="genre-bar-container">
                        <div
                          className="genre-bar-fill"
                          style={{ width: `${getPercentage(genre.count)}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
              </div>

              <div className="genre-info-box">
                <h3>ℹ️ About Genres</h3>
                <p>
                  Sound Clash supports 10 predefined genres matching your song database.
                  Each song can belong to multiple genres for better categorization.
                </p>
                <ul>
                  <li><strong>Rock</strong> - Classic and modern rock music</li>
                  <li><strong>Pop</strong> - Popular mainstream music</li>
                  <li><strong>Electronic</strong> - EDM, house, techno</li>
                  <li><strong>Hip Hop</strong> - Rap and hip hop tracks</li>
                  <li><strong>Soundtracks</strong> - Movie and TV show music</li>
                  <li><strong>Mizrahit</strong> - Israeli oriental music</li>
                  <li><strong>Israeli Rock Pop</strong> - Israeli rock/pop fusion</li>
                  <li><strong>Israeli Cover</strong> - Israeli cover songs</li>
                  <li><strong>Israeli Pop</strong> - Modern Israeli pop</li>
                  <li><strong>Israeli Rap Hip Hop</strong> - Israeli rap/hip hop</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminGenres;
