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
const LandingPage = lazy(() => import('./pages/LandingPage'));
const JoinGamePage = lazy(() => import('./pages/game/JoinGamePage'));
const CreateGamePage = lazy(() => import('./pages/game/CreateGamePage'));
const WaitingRoomPage = lazy(() => import('./pages/game/WaitingRoomPage'));
const WaitingRoom = lazy(() => import('./pages/game/WaitingRoom'));
const ManagerConsole = lazy(() => import('./pages/manager/ManagerConsole'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const WebSocketTester = lazy(() => import('./components/WebSocketTester'));

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
                {/* Landing page */}
                <Route path="/" element={<LandingPage />} />
                
                {/* Join existing game flow */}
                <Route path="/join" element={<JoinGamePage />} />
                
                {/* Create new game flow */}
                <Route path="/create" element={<CreateGamePage />} />
                
                {/* Waiting room for both creators and joiners */}
                <Route path="/game/:gameCode/lobby" element={<WaitingRoomPage />} />
                
                {/* Task 2.3 - New Waiting Room with WebSocket */}
                <Route path="/game/:gameCode/waiting" element={<WaitingRoom />} />
                
                {/* Task 2.3 - Manager Console */}
                <Route path="/manager/:gameCode" element={<ManagerConsole />} />
                
                {/* WebSocket Phase 2 Testing */}
                <Route path="/test/websocket" element={<WebSocketTester />} />
                
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
