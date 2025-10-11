import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCodeGenerator from '../../components/display/QRCodeGenerator';
import Logo from '../../components/common/Logo';
import '../../styles/pages/display-lobby.css';

interface Team {
  name: string;
}

interface DisplayLobbyProps {
  wsUrl?: string;
}

const DisplayLobby: React.FC<DisplayLobbyProps> = ({ wsUrl }) => {
  const { gameCode } = useParams<{ gameCode: string }>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  const joinUrl = `${window.location.origin}/team/join?code=${gameCode}`;

  useEffect(() => {
    if (!gameCode) return;

    // Connect to WebSocket as display
    const baseUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8002';
    const websocket = new WebSocket(
      wsUrl || `${baseUrl}/ws/display/${gameCode}`
    );

    websocket.onopen = () => {
      console.log('Display WebSocket connected');
      setConnectionStatus('connected');
    };

    websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Display received:', data);

        switch (data.type) {
          case 'team_joined':
            setTeams((prev) => {
              if (!prev.find((t) => t.name === data.team_name)) {
                return [...prev, { name: data.team_name }];
              }
              return prev;
            });
            break;

          case 'game_state':
            if (data.teams) {
              setTeams(data.teams.map((t: any) => ({ name: t.name })));
            }
            break;

          case 'game_started':
            // Navigate to game screen
            window.location.href = `/display/game/${gameCode}`;
            break;
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocket.onerror = (error) => {
      console.error('Display WebSocket error:', error);
      setConnectionStatus('disconnected');
    };

    websocket.onclose = () => {
      console.log('Display WebSocket disconnected');
      setConnectionStatus('disconnected');
    };

    return () => {
      websocket.close();
    };
  }, [gameCode, wsUrl]);

  return (
    <div className="display-lobby-page">
      <div className="display-lobby-header">
        <Logo size="large" animated />
        <h1 className="display-title">Sound Clash</h1>
      </div>

      <div className="display-lobby-content">
        {/* Game Code Section */}
        <div className="game-code-section">
          <p className="join-instruction">Join the game at:</p>
          <div className="join-url">{window.location.origin}/team/join</div>
          <div className="game-code-display">
            <span className="code-label">Game Code:</span>
            <span className="code-value">{gameCode}</span>
          </div>
        </div>

        {/* QR Code Section */}
        <div className="qr-code-section">
          <QRCodeGenerator url={joinUrl} size={300} />
          <p className="qr-instruction">Scan to join instantly!</p>
        </div>

        {/* Teams List */}
        <div className="teams-section">
          <h2 className="teams-header">
            {teams.length === 0 ? 'Waiting for teams...' : `Teams Ready (${teams.length})`}
          </h2>
          {teams.length > 0 && (
            <div className="teams-list">
              {teams.map((team, index) => (
                <div key={index} className="team-item">
                  <span className="team-icon">👥</span>
                  <span className="team-name">{team.name}</span>
                  <span className="team-status">✓ Ready</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Waiting Message */}
        <div className="waiting-message">
          <div className="loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <p>Waiting for manager to start the game...</p>
        </div>

        {/* Connection Status */}
        <div className={`connection-status ${connectionStatus}`}>
          {connectionStatus === 'connecting' && '🔄 Connecting...'}
          {connectionStatus === 'connected' && '✓ Connected'}
          {connectionStatus === 'disconnected' && '✗ Disconnected'}
        </div>
      </div>
    </div>
  );
};

export default DisplayLobby;
