import { useEffect, useRef, useState, useCallback } from 'react';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface UseWebSocketOptions {
  gameCode: string;
  teamName: string;
  role: 'team' | 'manager' | 'display';
  onMessage?: (data: any) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Event) => void;
}

interface UseWebSocketReturn {
  connectionStatus: ConnectionStatus;
  sendMessage: (message: any) => void;
  isConnected: boolean;
}

export const useWebSocket = (options: UseWebSocketOptions): UseWebSocketReturn => {
  const {
    gameCode,
    teamName,
    role,
    onMessage,
    onConnected,
    onDisconnected,
    onError,
  } = options;

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  // Get WebSocket URL from environment or use default
  const getWebSocketUrl = useCallback(() => {
    const baseUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8002';
    // Backend endpoints: /ws/team/{code}, /ws/manager/{code}, /ws/display/{code}
    return `${baseUrl}/ws/${role}/${gameCode}`;
  }, [gameCode, role, teamName]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(getWebSocketUrl());

      ws.onopen = () => {
        console.log('[WebSocket] Connection opened, waiting for authentication...');
        setConnectionStatus('connecting');

        // Send team_join message after connection (required by backend)
        if (role === 'team') {
          console.log('[WebSocket] Sending team_join:', { type: 'team_join', team_name: teamName });
          ws.send(JSON.stringify({
            type: 'team_join',
            team_name: teamName
          }));
        }

        // Don't set connected status here - wait for connection_ack from backend
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[WebSocket] Received message:', data);

          // Handle connection acknowledgment
          if (data.type === 'connection_ack' || data.type === 'manager_connected' || data.type === 'display_connected') {
            console.log('[WebSocket] Connection acknowledged by backend');
            setConnectionStatus('connected');
            reconnectAttemptsRef.current = 0;
            onConnected?.();
          }

          // Handle errors
          if (data.type === 'error') {
            console.error('[WebSocket] Backend error:', data.message);
            setConnectionStatus('error');
            ws.close();
            return;
          }

          onMessage?.(data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
        onError?.(error);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setConnectionStatus('disconnected');
        onDisconnected?.();

        // Attempt to reconnect
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
          setConnectionStatus('reconnecting');

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.error('Max reconnection attempts reached');
          setConnectionStatus('error');
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionStatus('error');
    }
  }, [getWebSocketUrl, onConnected, onMessage, onDisconnected, onError, role, teamName]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('disconnected');
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected. Message not sent:', message);
    }
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connectionStatus,
    sendMessage,
    isConnected: connectionStatus === 'connected',
  };
};
