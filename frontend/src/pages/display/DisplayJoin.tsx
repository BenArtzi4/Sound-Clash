import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../../components/common/Logo';
import '../../styles/pages/display-join.css';

const DisplayJoin: React.FC = () => {
  const navigate = useNavigate();
  const [gameCode, setGameCode] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!gameCode || gameCode.length !== 6) {
      setError('Please enter a valid 6-character game code');
      return;
    }

    navigate(`/display/join/${gameCode.toUpperCase()}`);
  };

  return (
    <div className="display-join-page">
      <header className="page-header">
        <div className="header-content">
          <Logo size="medium" />
          <button className="btn-back" onClick={() => navigate('/')}>
            ← Back to Home
          </button>
        </div>
      </header>

      <main className="page-main">
        <div className="join-container">
          <div className="join-card">
            <div className="display-icon">📺</div>
            <h1 className="page-title">Display Screen</h1>
            <p className="page-subtitle">
              Connect this device as the main display screen
            </p>

            <form className="join-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="gameCode" className="form-label">
                  Enter Game Code
                </label>
                <input
                  id="gameCode"
                  type="text"
                  className={`form-input ${error ? 'error' : ''}`}
                  placeholder="ABC123"
                  value={gameCode}
                  onChange={(e) => {
                    setGameCode(e.target.value.toUpperCase());
                    setError('');
                  }}
                  maxLength={6}
                  autoFocus
                />
                {error && <span className="error-message">{error}</span>}
              </div>

              <button type="submit" className="btn-join">
                Connect Display
              </button>
            </form>

            <div className="info-box">
              <p className="info-title">💡 Display Screen Purpose:</p>
              <ul className="info-list">
                <li>Shows the main scoreboard for everyone to see</li>
                <li>Displays round information and game status</li>
                <li>Shows team buzz notifications</li>
                <li>Best viewed on TV or projector</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DisplayJoin;
