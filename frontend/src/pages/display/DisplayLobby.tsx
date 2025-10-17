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
          case 'display_connected':
            // Initial connection - receive current teams list and game state
            console.log('[Display Lobby] Display connected:', data);
            if (data.teams) {
              console.log('[Display Lobby] Initial teams loaded:', data.teams);
              setTeams(data.teams.map((t: any) => ({
                name: typeof t === 'string' ? t : t.name
              })));
            }
            // Check if game is already started (joined mid-game)
            if (data.game_state === 'playing' || data.state === 'playing') {
              console.log('[Display Lobby] Game already started! Redirecting to game screen...');
              window.location.href = `/display/game/${gameCode}`;
            }
            break;

          case 'team_joined':
          case 'team_update':
            // Team joined or updated
            if (data.teams) {
              console.log('[Display Lobby] Teams updated:', data.teams);
              setTeams(data.teams.map((t: any) => ({
                name: typeof t === 'string' ? t : t.name
              })));
            } else if (data.team_name) {
              // Single team joined event
              setTeams((prev) => {
                if (!prev.find((t) => t.name === data.team_name)) {
                  return [...prev, { name: data.team_name }];
                }
                return prev;
              });
            }
            break;

          case 'team_left':
            if (data.team_name) {
              setTeams((prev) => prev.filter((t) => t.name !== data.team_name));
            }
            break;

          case 'game_state':
            console.log('[Display Lobby] Game state update:', data);
            if (data.teams) {
              setTeams(data.teams.map((t: any) => ({
                name: typeof t === 'string' ? t : t.name
              })));
            }
            // Check if game state changed to playing
            if (data.state === 'playing' || data.game_state === 'playing') {
              console.log('[Display Lobby] Game state changed to playing! Redirecting...');
              window.location.href = `/display/game/${gameCode}`;
            }
            break;

          case 'game_started':
            // Navigate to game screen
            console.log('[Display Lobby] Game started event received! Redirecting...');
            window.location.href = `/display/game/${gameCode}`;
            break;

          case 'pong':
            // Heartbeat response
            break;

          default:
            console.log('[Display Lobby] Unhandled message type:', data.type);
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

    // Heartbeat to keep connection alive (backend has 30-second timeout)
    const heartbeatInterval = setInterval(() => {
      if (websocket.readyState === WebSocket.OPEN) {
        console.log('Display: Sending heartbeat ping');
        websocket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 5000); // Every 5 seconds

    return () => {
      clearInterval(heartbeatInterval);
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
