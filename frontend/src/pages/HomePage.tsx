import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/common/Logo';
import '../styles/pages/homepage.css';
import '../styles/themes/minimal-clean.css';

const HomePage: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.body.className = 'theme-minimal-clean';
    localStorage.setItem('soundclash-style', 'minimal-clean');
  }, []);

  return (
    <div className="landing-page theme-minimal-clean">
      <header className="landing-header">
        <div className="container">
          <Logo size="large" />
        </div>
      </header>

      <main className="landing-main">
        <div className="container">
          <div className="landing-content">
            <div className="landing-hero">
              <h1 className="landing-title">Welcome to Sound Clash</h1>
              <p className="landing-subtitle">
                The ultimate music trivia buzzer game
              </p>
              <p className="landing-description">
                Choose your role to get started
              </p>
            </div>

            <div className="landing-actions">
              <button 
                className="role-btn role-btn-primary"
                onClick={() => navigate('/team/join')}
              >
                <span className="btn-icon">📱</span>
                <div className="btn-content">
                  <span className="btn-title">Join as Team</span>
                  <span className="btn-subtitle">Play on your phone</span>
                </div>
              </button>
              
              <button 
                className="role-btn role-btn-secondary"
                onClick={() => navigate('/manager/create')}
              >
                <span className="btn-icon">🎮</span>
                <div className="btn-content">
                  <span className="btn-title">Manager Console</span>
                  <span className="btn-subtitle">Create new game</span>
                </div>
              </button>

              <button 
                className="role-btn role-btn-accent"
                onClick={() => navigate('/display/join')}
              >
                <span className="btn-icon">📺</span>
                <div className="btn-content">
                  <span className="btn-title">Display Screen</span>
                  <span className="btn-subtitle">Show scoreboard</span>
                </div>
              </button>
            </div>

            <div className="landing-info">
              <h2 className="info-title">How to Play</h2>
              <div className="info-grid">
                <div className="info-item">
                  <div className="info-number">1</div>
                  <div className="info-content">
                    <h3>Teams Join</h3>
                    <p>Each team uses their phone to join with a game code</p>
                  </div>
                </div>
                
                <div className="info-item">
                  <div className="info-number">2</div>
                  <div className="info-content">
                    <h3>Listen & Buzz</h3>
                    <p>First team to buzz gets to answer</p>
                  </div>
                </div>
                
                <div className="info-item">
                  <div className="info-number">3</div>
                  <div className="info-content">
                    <h3>Manager Evaluates</h3>
                    <p>Manager approve or decline answers</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default HomePage;
