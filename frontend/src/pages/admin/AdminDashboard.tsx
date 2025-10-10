import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI, GenreStats } from '../../services/adminAPI';
import { useAuth } from '../../context/AuthContext';
import Logo from '../../components/common/Logo';
import '../../styles/pages/admin-dashboard.css';

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [stats, setStats] = useState<{
    totalSongs: number;
    genreStats: GenreStats[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const [songsResponse, genreStats] = await Promise.all([
        adminAPI.getSongs({ per_page: 1 }),
        adminAPI.getGenreStats()
      ]);
      
      setStats({
        totalSongs: songsResponse.total_songs,
        genreStats: genreStats
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  return (
    <div className="admin-dashboard-page">
      <header className="admin-header">
        <div className="header-content">
          <Logo size="medium" />
          <div className="header-title">
            <h1>Admin Dashboard</h1>
            <p>Song Management System</p>
          </div>
        <div className="header-actions">
          <button className="btn-back" onClick={() => navigate('/')}>
            ← Exit Admin
          </button>
          <button className="btn-logout" onClick={handleLogout}>
            🔒 Logout
          </button>
        </div>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-container">
          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading dashboard...</p>
            </div>
          ) : (
            <>
              {/* Stats Cards */}
              <div className="stats-grid">
                <div className="stat-card primary">
                  <div className="stat-icon">🎵</div>
                  <div className="stat-content">
                    <h3>Total Songs</h3>
                    <p className="stat-value">{stats?.totalSongs || 0}</p>
                  </div>
                </div>

                <div className="stat-card secondary">
                  <div className="stat-icon">🎸</div>
                  <div className="stat-content">
                    <h3>Genres</h3>
                    <p className="stat-value">{stats?.genreStats.length || 0}</p>
                  </div>
                </div>

                <div className="stat-card accent">
                  <div className="stat-icon">📊</div>
                  <div className="stat-content">
                    <h3>Most Popular</h3>
                    <p className="stat-value">
                      {stats?.genreStats[0]?.genre || 'N/A'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="actions-section">
                <h2 className="section-title">Quick Actions</h2>
                <div className="actions-grid">
                  <button 
                    className="action-card"
                    onClick={() => navigate('/admin/songs')}
                  >
                    <span className="action-icon">📋</span>
                    <h3>View All Songs</h3>
                    <p>Browse and manage song library</p>
                  </button>

                  <button 
                    className="action-card"
                    onClick={() => navigate('/admin/songs/new')}
                  >
                    <span className="action-icon">➕</span>
                    <h3>Add New Song</h3>
                    <p>Add a single song manually</p>
                  </button>

                  <button 
                    className="action-card"
                    onClick={() => navigate('/admin/songs/import')}
                  >
                    <span className="action-icon">📥</span>
                    <h3>Bulk Import</h3>
                    <p>Import songs from CSV file</p>
                  </button>

                  <button 
                    className="action-card"
                    onClick={() => navigate('/admin/genres')}
                  >
                    <span className="action-icon">🎭</span>
                    <h3>Genre Stats</h3>
                    <p>View genre statistics</p>
                  </button>
                </div>
              </div>

              {/* Genre Distribution */}
              <div className="genre-section">
                <h2 className="section-title">Genre Distribution</h2>
                <div className="genre-stats-grid">
                  {stats?.genreStats.map((genre) => (
                    <div key={genre.genre} className="genre-stat-card">
                      <div className="genre-name">
                        {genre.genre.split('-').map(w => 
                          w.charAt(0).toUpperCase() + w.slice(1)
                        ).join(' ')}
                      </div>
                      <div className="genre-count">{genre.count} songs</div>
                      <div className="genre-bar">
                        <div 
                          className="genre-bar-fill" 
                          style={{
                            width: `${(genre.count / (stats.totalSongs || 1)) * 100}%`
                          }}
                        ></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
