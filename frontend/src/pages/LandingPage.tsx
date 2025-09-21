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
            {/* Subtitle */}
            <p className="landing-subtitle subhead">
              The ultimate music trivia buzzer game
            </p>

            {/* Main action buttons */}
            <div className="landing-actions">
              <button 
                className="btn btn-primary btn-large"
                onClick={() => navigate('/join')}
              >
                Join Game
              </button>
              
              <button 
                className="btn btn-secondary btn-large"
                onClick={() => navigate('/create')}
              >
                Create Game
              </button>
            </div>

            {/* How it works */}
            <div className="landing-info">
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