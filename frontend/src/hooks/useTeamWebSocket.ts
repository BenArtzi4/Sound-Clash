/**
 * React Hook for Team WebSocket Connection
 * Provides a clean interface for React components to use WebSocket
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { TeamWebSocketClient } from '../services/websocket/TeamWebSocketClient';
import { ConnectionState } from '../services/websocket/types';

export interface UseTeamWebSocketResult {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  teams: string[];
  connectionState: ConnectionState;
  connect: (gameCode: string, teamName: string) => Promise<boolean>;
  disconnect: () => void;
}

export function useTeamWebSocket(): UseTeamWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<string[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  
  const clientRef = useRef<TeamWebSocketClient | null>(null);

  // Initialize client on mount
  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = new TeamWebSocketClient();
    }

    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  // Connect function
  const connect = useCallback(async (gameCode: string, teamName: string): Promise<boolean> => {
    if (!clientRef.current) {
      console.error('WebSocket client not initialized');
      return false;
    }

    setConnecting(true);
    setError(null);

    try {
      const success = await clientRef.current.connect(gameCode, teamName, {
        onConnected: () => {
          console.log('WebSocket connected callback');
          setConnected(true);
          setConnecting(false);
          setConnectionState(ConnectionState.CONNECTED);
        },
        onDisconnected: () => {
          console.log('WebSocket disconnected callback');
          setConnected(false);
          setConnecting(false);
          setConnectionState(ConnectionState.DISCONNECTED);
        },
        onTeamsUpdate: (updatedTeams) => {
          console.log('Teams updated:', updatedTeams);
          setTeams(updatedTeams);
        },
        onError: (errorMessage) => {
          console.error('WebSocket error:', errorMessage);
          setError(errorMessage);
          setConnecting(false);
        },
        onKicked: (reason) => {
          console.log('Kicked from game:', reason);
          setError(`Kicked: ${reason}`);
          setConnected(false);
          setConnecting(false);
        },
      });

      if (success) {
        setConnected(true);
        setConnecting(false);
      } else {
        setConnecting(false);
        setError('Failed to connect');
      }

      return success;
    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(false);
      return false;
    }
  }, []);

  // Disconnect function
  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      setConnected(false);
      setConnecting(false);
      setTeams([]);
      setError(null);
      setConnectionState(ConnectionState.DISCONNECTED);
    }
  }, []);

  return {
    connected,
    connecting,
    error,
    teams,
    connectionState,
    connect,
    disconnect,
  };
}
