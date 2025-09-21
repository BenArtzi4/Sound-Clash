import React from 'react';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';

const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="not-found-page">
      {/* Header */}
      <header className="page-header">
        <div className="container">
          <Logo size="medium" />
        </div>
      </header>

      {/* Main content */}
      <main className="page-main">
        <div className="container">
          <div className="not-found-content">
            <div className="error-display">
              <h1 className="error-code large-title">404</h1>
              <h2 className="error-title title-1">Page Not Found</h2>
              <p className="error-message body">
                The page you're looking for doesn't exist or may have been moved.
              </p>
            </div>

            <div className="error-actions">
              <button 
                className="btn btn-primary btn-large"
                onClick={() => navigate('/')}
              >
                Go Home
              </button>
              
              <button 
                className="btn btn-tertiary"
                onClick={() => navigate(-1)}
              >
                Go Back
              </button>
            </div>

            <div className="error-suggestions">
              <h3 className="title-2">What you can do:</h3>
              <ul className="suggestions-list">
                <li className="body">
                  <strong>Create a new game</strong> and get a fresh game code
                </li>
                <li className="body">
                  <strong>Join an existing game</strong> with a valid 6-digit code
                </li>
                <li className="body">
                  <strong>Check the URL</strong> for any typos or errors
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default NotFoundPage;