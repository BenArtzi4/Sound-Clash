import React from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';

const LandingPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="landing-page">
      {/* Header with Sound Clash branding */}
      <header className="landing-header">
        <div className="container">
          <Logo size="large" />
        </div>
      </header>

      {/* Main content */}
      <main className="landing-main">
        <div className="container">
          <div className="landing-content">
            {/* Enhanced subtitle with better hierarchy */}
            <div className="landing-hero">
              <p className="landing-subtitle headline">
                The ultimate music trivia buzzer game
              </p>
              <p className="landing-description body">
                Test your music knowledge in real-time with friends. Buzz in first to win points!
              </p>
            </div>

            {/* Main action buttons with better spacing */}
            <div className="landing-actions">
              <button 
                className="btn btn-primary btn-large btn-prominent"
                onClick={() => navigate('/join')}
              >
                <span className="btn-icon">🎮</span>
                Join Game
              </button>
              
              <button 
                className="btn btn-secondary btn-large"
                onClick={() => navigate('/create')}
              >
                <span className="btn-icon">🎵</span>
                Create Game
              </button>
            </div>

            {/* Enhanced how it works section */}
            <div className="landing-info">
              <h2 className="info-title title-2">How to Play</h2>
              <div className="info-grid">
                <div className="info-item">
                  <div className="info-number">1</div>
                  <h3 className="headline">Create or Join</h3>
                  <p className="body">Start a new game or join with a 6-digit code</p>
                </div>
                
                <div className="info-item">
                  <div className="info-number">2</div>
                  <h3 className="headline">Listen & Buzz</h3>
                  <p className="body">Identify songs, artists, and movies fastest</p>
                </div>
                
                <div className="info-item">
                  <div className="info-number">3</div>
                  <h3 className="headline">Win Points</h3>
                  <p className="body">Score points and climb the leaderboard</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LandingPage;