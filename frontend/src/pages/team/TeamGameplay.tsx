import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useWebSocket } from '../../hooks/useWebSocket';
import BuzzerButton, { BuzzerState } from '../../components/BuzzerButton';
import Logo from '../../components/common/Logo';
import '../../styles/pages/team-gameplay.css';
import '../../styles/themes/minimal-clean.css';

interface LocationState {
  teamName: string;
}

interface ComponentLockStatus {
  song_name: boolean;
  artist_content: boolean;
}

const TeamGameplay: React.FC = () => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  
  const state = location.state as LocationState;
  const teamName = state?.teamName;

  const [buzzerState, setBuzzerState] = useState<BuzzerState>('disabled');
  const [buzzedTeamName, setBuzzedTeamName] = useState<string>('');
  const [componentStatus, setComponentStatus] = useState<ComponentLockStatus>({
    song_name: false,
    artist_content: false,
  });
  const [isSoundtrack, setIsSoundtrack] = useState(false);

  // Redirect if no team name
  useEffect(() => {
    if (!teamName || !gameCode) {
      navigate('/team/join');
    }
  }, [teamName, gameCode, navigate]);

  // WebSocket message handler - wrapped in useCallback to prevent reconnection loop
  const handleWebSocketMessage = useCallback((data: any) => {
    console.log('[Team] Received message:', data);

    switch (data.type) {
      case 'game_started':
        setBuzzerState('disabled');
        break;

      case 'round_started':
        setBuzzerState('enabled');
        setIsSoundtrack(data.is_soundtrack || false);
        setComponentStatus({
          song_name: false,
          artist_content: false,
        });
        break;

      case 'buzzer_locked':
        if (data.team_name === teamName) {
          setBuzzerState('you_buzzed');
        } else {
          setBuzzerState('other_buzzed');
          setBuzzedTeamName(data.team_name);
        }
        break;

      case 'answer_evaluated':
        setComponentStatus(data.locked_components);

        // Re-enable buzzer if not all components are locked
        const allLocked = data.locked_components.song_name && data.locked_components.artist_content;
        if (!allLocked) {
          setBuzzerState('enabled');
        }
        break;

      case 'round_completed':
        setBuzzerState('disabled');
        break;

      case 'game_ended':
        // Game finished
        setBuzzerState('disabled');
        break;

      default:
        console.log('[Team] Unhandled message type:', data.type);
    }
  }, [teamName]); // Only teamName is used in the handler

  // WebSocket connection
  const { connectionStatus, sendMessage, isConnected } = useWebSocket({
    gameCode: gameCode || '',
    teamName: teamName || '',
    role: 'team',
    onMessage: handleWebSocketMessage,
  });

  // Handle buzz button press
  const handleBuzz = () => {
    if (buzzerState === 'enabled' && isConnected) {
      sendMessage({
        type: 'buzz_pressed',
        team_name: teamName,
      });
      // Optimistically update UI
      setBuzzerState('you_buzzed');
    }
  };

  // Component status text
  const getComponentStatusText = () => {
    const songLabel = 'Song';
    const artistLabel = isSoundtrack ? 'Content' : 'Artist';

    if (componentStatus.song_name && componentStatus.artist_content) {
      return `${songLabel} ✓ | ${artistLabel} ✓`;
    } else if (componentStatus.song_name) {
      return `${songLabel} ✓ | ${artistLabel}`;
    } else if (componentStatus.artist_content) {
      return `${songLabel} | ${artistLabel} ✓`;
    } else {
      return `${songLabel} & ${artistLabel}`;
    }
  };

  if (!teamName || !gameCode) {
    return null;
  }

  return (
    <div className="team-gameplay-page theme-minimal-clean">
      <header className="gameplay-header">
        <Logo size="small" />
        <div className="connection-indicator">
          <span className={`connection-dot connection-${connectionStatus}`}></span>
          <span className="connection-text">{connectionStatus}</span>
        </div>
      </header>

      <main className="gameplay-main">
        <div className="gameplay-container">
          {/* Team Name */}
          <div className="team-info">
            <h2 className="team-name">{teamName}</h2>
            <p className="game-code">Game: {gameCode}</p>
          </div>

          {/* Component Status */}
          <div className="component-status">
            <p className="status-text">{getComponentStatusText()}</p>
          </div>

          {/* Buzzer Button */}
          <BuzzerButton
            state={buzzerState}
            onBuzz={handleBuzz}
            buzzedTeamName={buzzedTeamName}
          />

          {/* Waiting Message */}
          {buzzerState === 'disabled' && connectionStatus === 'connected' && (
            <div className="waiting-message">
              <p>Waiting for manager to start round...</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default TeamGameplay;
