import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Suspense, lazy, Component, ReactNode } from 'react';
import './styles/variables.css';
import './styles/global.css';
import './styles/components.css';
import './styles/loading-styles.css';

// Import context providers
import { GameProvider } from './context/GameContext';

// Error Boundary Component
interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('App Error:', error, errorInfo);
    // Here you could send error to monitoring service
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-content">
            <h2>🎵 Oops! Something went wrong</h2>
            <p>The Sound Clash app encountered an unexpected error.</p>
            <button 
              onClick={() => window.location.reload()}
              className="btn btn-primary"
            >
              🔄 Reload App
            </button>
            <a href="/" className="btn btn-secondary">
              🏠 Go Home
            </a>
          </div>
        </div>
      );
    }

    return <>{this.props.children}</>;
  }
}

// Lazy load pages for better performance
const LandingPage = lazy(() => import('./pages/LandingPage'));
const JoinGamePage = lazy(() => import('./pages/JoinGamePage'));
const CreateGamePage = lazy(() => import('./pages/CreateGamePage'));
const WaitingRoomPage = lazy(() => import('./pages/WaitingRoomPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

// Loading component
const PageLoadingSpinner = () => (
  <div className="page-loading">
    <div className="loading-spinner">
      <div className="spinner"></div>
      <p>Loading Sound Clash...</p>
    </div>
  </div>
);

function App() {
  return (
    <AppErrorBoundary>
      <GameProvider>
        <Router>
          <div className="App">
            <Suspense fallback={<PageLoadingSpinner />}>
              <Routes>
                {/* Landing page - choose to join or create */}
                <Route path="/" element={<LandingPage />} />
                
                {/* Join existing game flow */}
                <Route path="/join" element={<JoinGamePage />} />
                
                {/* Create new game flow */}
                <Route path="/create" element={<CreateGamePage />} />
                
                {/* Waiting room for both creators and joiners */}
                <Route path="/game/:gameCode/lobby" element={<WaitingRoomPage />} />
                
                {/* 404 page */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </div>
        </Router>
      </GameProvider>
    </AppErrorBoundary>
  );
}

export default App;