import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './styles/variables.css';
import './styles/global.css';
import './styles/components.css';

// Import pages
import LandingPage from './pages/LandingPage';
import JoinGamePage from './pages/JoinGamePage';
import CreateGamePage from './pages/CreateGamePage';
import WaitingRoomPage from './pages/WaitingRoomPage';
import NotFoundPage from './pages/NotFoundPage';

// Import context providers
import { GameProvider } from './context/GameContext';

function App() {
  return (
    <GameProvider>
      <Router>
        <div className="App">
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
        </div>
      </Router>
    </GameProvider>
  );
}

export default App;