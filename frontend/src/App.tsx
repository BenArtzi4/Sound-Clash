import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Suspense, lazy, Component, ReactNode } from 'react';
import './styles/variables.css';
import './styles/global.css';
import './styles/components.css';
import './styles/loading-styles.css';

// Import context providers
import { GameProvider } from './context/GameContext';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

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
const TestPage = lazy(() => import('./pages/TestPage'));

// Manager pages
const ManagerConsoleNew = lazy(() => import('./pages/manager/ManagerConsoleNew'));
const CreateGamePage = lazy(() => import('./pages/game/CreateGamePage'));
const WaitingRoomPage = lazy(() => import('./pages/game/WaitingRoomPage'));

// Display pages
const DisplayJoin = lazy(() => import('./pages/display/DisplayJoin'));
const DisplayLobby = lazy(() => import('./pages/display/DisplayLobby'));
const DisplayGame = lazy(() => import('./pages/display/DisplayGame'));
const DisplayWinner = lazy(() => import('./pages/display/DisplayWinner'));

// Admin pages
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminSongList = lazy(() => import('./pages/admin/AdminSongList'));
const AdminSongForm = lazy(() => import('./pages/admin/AdminSongForm'));
const AdminBulkImport = lazy(() => import('./pages/admin/AdminBulkImport'));
const AdminGenres = lazy(() => import('./pages/admin/AdminGenres'));

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
      <AuthProvider>
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
                <Route path="/display/join" element={<DisplayJoin />} />
                <Route path="/display/join/:gameCode" element={<DisplayLobby />} />
                <Route path="/display/game/:gameCode" element={<DisplayGame />} />
                <Route path="/display/winner/:gameCode" element={<DisplayWinner />} />
                
                {/* Admin screens */}
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
                <Route path="/admin/songs" element={<ProtectedRoute><AdminSongList /></ProtectedRoute>} />
                <Route path="/admin/songs/new" element={<ProtectedRoute><AdminSongForm /></ProtectedRoute>} />
                <Route path="/admin/songs/:id/edit" element={<ProtectedRoute><AdminSongForm /></ProtectedRoute>} />
                <Route path="/admin/songs/import" element={<ProtectedRoute><AdminBulkImport /></ProtectedRoute>} />
                <Route path="/admin/genres" element={<ProtectedRoute><AdminGenres /></ProtectedRoute>} />
                
                {/* Test Page */}
                <Route path="/test" element={<TestPage />} />
                
                {/* 404 page */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </div>
        </Router>
        </GameProvider>
      </AuthProvider>
    </AppErrorBoundary>
  );
}

export default App;
