/**
 * WebSocket Testing Component
 * Use this to test Phase 2 WebSocket functionality
 */

import React, { useState } from 'react';
import { useTeamWebSocket } from '../hooks/useTeamWebSocket';
import { ConnectionState } from '../services/websocket/types';

export const WebSocketTester: React.FC = () => {
  const [gameCode, setGameCode] = useState('');
  const [teamName, setTeamName] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const { connected, connecting, error, teams, connectionState, connect, disconnect } = useTeamWebSocket();

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLog(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
  };

  const handleConnect = async () => {
    if (!gameCode || !teamName) {
      addLog('ERROR: Please enter both game code and team name');
      return;
    }

    addLog(`Attempting to connect to game ${gameCode} as ${teamName}...`);
    const success = await connect(gameCode, teamName);
    
    if (success) {
      addLog(`SUCCESS: Connected to game ${gameCode}`);
    } else {
      addLog(`FAILED: Could not connect to game ${gameCode}`);
    }
  };

  const handleDisconnect = () => {
    addLog('Disconnecting...');
    disconnect();
    addLog('Disconnected');
  };

  const getConnectionStateColor = () => {
    switch (connectionState) {
      case ConnectionState.CONNECTED:
        return 'green';
      case ConnectionState.CONNECTING:
      case ConnectionState.RECONNECTING:
        return 'orange';
      case ConnectionState.ERROR:
        return 'red';
      default:
        return 'gray';
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace', maxWidth: '800px', margin: '0 auto' }}>
      <h1>WebSocket Phase 2 Tester</h1>
      
      {/* Connection Status */}
      <div style={{ 
        padding: '10px', 
        marginBottom: '20px', 
        border: `2px solid ${getConnectionStateColor()}`,
        borderRadius: '5px',
        backgroundColor: '#f5f5f5'
      }}>
        <h3>Connection Status</h3>
        <div>State: <strong style={{ color: getConnectionStateColor() }}>{connectionState}</strong></div>
        <div>Connected: <strong>{connected ? 'YES' : 'NO'}</strong></div>
        <div>Connecting: <strong>{connecting ? 'YES' : 'NO'}</strong></div>
        {error && <div>Error: <strong style={{ color: 'red' }}>{error}</strong></div>}
      </div>

      {/* Connection Form */}
      <div style={{ marginBottom: '20px' }}>
        <h3>Connection</h3>
        <div style={{ marginBottom: '10px' }}>
          <label>
            Game Code:
            <input
              type="text"
              value={gameCode}
              onChange={(e) => setGameCode(e.target.value.toUpperCase())}
              placeholder="Enter game code"
              style={{ marginLeft: '10px', padding: '5px' }}
              disabled={connected}
            />
          </label>
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label>
            Team Name:
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Enter team name"
              style={{ marginLeft: '10px', padding: '5px' }}
              disabled={connected}
            />
          </label>
        </div>
        <div>
          {!connected ? (
            <button
              onClick={handleConnect}
              disabled={connecting}
              style={{ padding: '10px 20px', cursor: 'pointer' }}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              style={{ padding: '10px 20px', cursor: 'pointer' }}
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Teams List */}
      <div style={{ marginBottom: '20px' }}>
        <h3>Teams in Game ({teams.length})</h3>
        {teams.length > 0 ? (
          <ul>
            {teams.map((team, index) => (
              <li key={index}>{team}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'gray' }}>No teams yet</p>
        )}
      </div>

      {/* Log */}
      <div>
        <h3>Event Log</h3>
        <div style={{ 
          height: '300px', 
          overflowY: 'auto', 
          border: '1px solid #ccc', 
          padding: '10px',
          backgroundColor: '#f9f9f9'
        }}>
          {log.length > 0 ? (
            log.map((entry, index) => (
              <div key={index} style={{ marginBottom: '5px', fontSize: '12px' }}>
                {entry}
              </div>
            ))
          ) : (
            <div style={{ color: 'gray' }}>No events yet</div>
          )}
        </div>
        <button 
          onClick={() => setLog([])}
          style={{ marginTop: '10px', padding: '5px 10px', cursor: 'pointer' }}
        >
          Clear Log
        </button>
      </div>

      {/* Instructions */}
      <div style={{ marginTop: '30px', padding: '15px', backgroundColor: '#e8f4f8', borderRadius: '5px' }}>
        <h3>Testing Instructions</h3>
        <ol>
          <li>Create a game using the API (see test commands below)</li>
          <li>Enter the game code and a team name above</li>
          <li>Click "Connect"</li>
          <li>Open another browser tab/window and connect as a different team</li>
          <li>Watch the teams list update in real-time</li>
        </ol>
        <h4>Create Test Game (PowerShell):</h4>
        <pre style={{ backgroundColor: '#2d2d2d', color: '#f8f8f2', padding: '10px', borderRadius: '5px', overflow: 'auto' }}>
{`$gameData = @{
    max_teams = 4
    max_rounds = 10
    selected_genres = @("Rock", "Pop")
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/games/create" -Method Post -Body $gameData -ContentType "application/json"

Write-Host "Game Code: $($response.game_code)"`}
        </pre>
      </div>
    </div>
  );
};

export default WebSocketTester;
