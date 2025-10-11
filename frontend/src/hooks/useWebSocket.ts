import { useEffect, useRef, useState, useCallback } from 'react';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface UseWebSocketOptions {
  gameCode: string;
  teamName?: string;  // Optional - only required for 'team' role
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
  const isConnectingRef = useRef(false);

  // Store callbacks in refs to avoid reconnection when they change
  const onMessageRef = useRef(onMessage);
  const onConnectedRef = useRef(onConnected);
  const onDisconnectedRef = useRef(onDisconnected);
  const onErrorRef = useRef(onError);

  // Update callback refs when they change (without triggering reconnection)
  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectedRef.current = onConnected;
    onDisconnectedRef.current = onDisconnected;
    onErrorRef.current = onError;
  }, [onMessage, onConnected, onDisconnected, onError]);

  // Get WebSocket URL from environment or use default
  const getWebSocketUrl = useCallback(() => {
    const baseUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8002';
    // Backend endpoints: /ws/team/{code}, /ws/manager/{code}, /ws/display/{code}
    return `${baseUrl}/ws/${role}/${gameCode}`;
  }, [gameCode, role, teamName]);

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connections
    if (isConnectingRef.current) {
      console.log('[WebSocket] Already connecting, skipping...');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('[WebSocket] Already connected or connecting, skipping...');
      return;
    }

    isConnectingRef.current = true;
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
            isConnectingRef.current = false;
            onConnectedRef.current?.();
          }

          // Handle errors
          if (data.type === 'error') {
            console.error('[WebSocket] Backend error:', data.message);
            setConnectionStatus('error');
            isConnectingRef.current = false;
            ws.close();
            return;
          }

          onMessageRef.current?.(data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setConnectionStatus('error');
        isConnectingRef.current = false;
        onErrorRef.current?.(error);
      };

      ws.onclose = () => {
        console.log('[WebSocket] Connection closed');
        setConnectionStatus('disconnected');
        isConnectingRef.current = false;
        onDisconnectedRef.current?.();

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
      console.error('[WebSocket] Failed to create connection:', error);
      setConnectionStatus('error');
      isConnectingRef.current = false;
    }
  }, [getWebSocketUrl, role, teamName]); // Removed callbacks from dependencies - they're now in refs

  const disconnect = useCallback(() => {
    console.log('[WebSocket] Disconnecting...');

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    isConnectingRef.current = false;
    setConnectionStatus('disconnected');
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected. Message not sent:', message);
    }
  }, []);

  // Connect on mount and when essential params change, disconnect on unmount
  useEffect(() => {
    console.log('[WebSocket] useEffect triggered - connecting...');
    connect();

    return () => {
      console.log('[WebSocket] useEffect cleanup - disconnecting...');
      disconnect();
    };
  }, [gameCode, role, teamName]); // Only reconnect when essential params change, NOT when callbacks change

  // Heartbeat - send ping every 10 seconds to keep connection alive
  useEffect(() => {
    if (connectionStatus !== 'connected' || !wsRef.current) return;

    console.log('[WebSocket] Starting heartbeat...');
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('[WebSocket] Sending ping...');
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 10000); // Every 10 seconds

    return () => {
      console.log('[WebSocket] Stopping heartbeat...');
      clearInterval(interval);
    };
  }, [connectionStatus]);

  return {
    connectionStatus,
    sendMessage,
    isConnected: connectionStatus === 'connected',
  };
};
