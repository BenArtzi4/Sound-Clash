import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Logo from '../../components/common/Logo';
import '../../styles/pages/admin-login.css';

const AdminLogin: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Simulate a small delay for better UX
    setTimeout(() => {
      const success = login(password);
      
      if (success) {
        navigate('/admin');
      } else {
        setError('Invalid password. Please try again.');
        setPassword('');
      }
      setLoading(false);
    }, 500);
  };

  return (
    <div className="admin-login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <Logo size="large" />
            <h1>Admin Login</h1>
            <p>Enter password to access admin panel</p>
          </div>

          {error && (
            <div className="error-banner">
              <span>⚠️ {error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                required
                autoFocus
                disabled={loading}
              />
            </div>

            <button 
              type="submit" 
              className="btn-login"
              disabled={loading || !password}
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          <div className="login-footer">
            <button 
              className="btn-back-home"
              onClick={() => navigate('/')}
            >
              ← Back to Home
            </button>
          </div>

          <div className="login-info">
            <p className="info-text">
              🔒 Secure admin access
            </p>
            <p className="info-subtext">
              Contact system administrator if you don't have the password
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
