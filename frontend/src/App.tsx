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
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-content">
            <h2>Oops! Something went wrong</h2>
            <p>The Sound Clash app encountered an unexpected error.</p>
            <button 
              onClick={() => window.location.reload()}
              className="btn btn-primary"
            >
              Reload App
            </button>
            <a href="/" className="btn btn-secondary">
              Go Home
            </a>
          </div>
        </div>
      );
    }

    return <>{this.props.children}</>;
  }
}

// Lazy load pages
const HomePage = lazy(() => import('./pages/HomePage'));
const TeamJoin = lazy(() => import('./pages/team/TeamJoin'));
const TeamGameplay = lazy(() => import('./pages/team/TeamGameplay'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const Day1ValidationTest = lazy(() => import('./pages/Day1ValidationTest'));

// Placeholder pages (to be built in later days)
// Manager pages
const ManagerConsoleNew = lazy(() => import('./pages/manager/ManagerConsoleNew'));
const CreateGamePage = lazy(() => import('./pages/game/CreateGamePage'));
const WaitingRoomPage = lazy(() => import('./pages/game/WaitingRoomPage'));

// Placeholder pages (to be built later)
const DisplayJoinPlaceholder = lazy(() => Promise.resolve({
  default: () => (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Display Screen</h1>
      <p>Display interface coming in Day 5</p>
      <a href="/">← Back to Home</a>
    </div>
  )
}));

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
                {/* Homepage - Three role selection buttons */}
                <Route path="/" element={<HomePage />} />
                
                {/* Team screens */}
                <Route path="/team/join" element={<TeamJoin />} />
                <Route path="/team/game/:gameCode" element={<TeamGameplay />} />
                
                {/* Manager screens */}
                <Route path="/manager/create" element={<CreateGamePage />} />
                <Route path="/game/:gameCode/lobby" element={<WaitingRoomPage />} />
                <Route path="/manager/game/:gameCode" element={<ManagerConsoleNew />} />
                
                {/* Display screens */}
                <Route path="/display/join" element={<DisplayJoinPlaceholder />} />
                <Route path="/display/join/:gameCode" element={<DisplayJoinPlaceholder />} />
                <Route path="/display/game/:gameCode" element={<DisplayJoinPlaceholder />} />
                <Route path="/display/winner/:gameCode" element={<DisplayJoinPlaceholder />} />
                
                {/* Day 1 Validation Test */}
                <Route path="/test/day1" element={<Day1ValidationTest />} />
                
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
