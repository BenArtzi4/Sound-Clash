import { useState, useEffect, useRef, useCallback } from 'react';

export interface Team {
  name: string;
  joined_at: string;
  connected: boolean;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export interface UseWebSocketReturn {
  isConnected: boolean;
  teams: Team[];
  totalTeams: number;
  error: string | null;
  sendMessage: (message: WebSocketMessage) => void;
  connect: () => void;
  disconnect: () => void;
}

interface UseWebSocketProps {
  gameCode: string;
  teamName?: string;
  isManager?: boolean;
  onMessage?: (message: WebSocketMessage) => void;
  autoConnect?: boolean;
}

export const useWebSocket = ({
  gameCode,
  teamName,
  isManager = false,
  onMessage,
  autoConnect = true
}: UseWebSocketProps): UseWebSocketReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [totalTeams, setTotalTeams] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout>();
  const heartbeatInterval = useRef<NodeJS.Timeout>();

  const getWebSocketUrl = () => {
    // Use the ALB directly with ws:// protocol (CloudFront doesn't support WebSocket upgrades)
    // Always use ws:// since our ALB only supports HTTP
    const wsProtocol = 'ws://';
    const albHost = 'sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com';
    const endpoint = isManager ? 'manager' : 'team';
    return `${wsProtocol}${albHost}/ws/${endpoint}/${gameCode.toUpperCase()}`;
  };

  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
    }
    
    heartbeatInterval.current = setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000); // Ping every 25 seconds
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      console.log('[WebSocket] Received:', message);

      // Update teams list on team updates
      if (message.type === 'team_update' || message.type === 'teams_list') {
        if (message.teams) {
          setTeams(message.teams);
          setTotalTeams(message.total_teams || message.teams.length);
        }
      }

      // Handle connection acknowledgment
      if (message.type === 'connection_ack' || message.type === 'manager_connected') {
        setIsConnected(true);
        setError(null);
        if (message.teams) {
          setTeams(message.teams);
          setTotalTeams(message.teams_count || message.total_teams || message.teams.length);
        }
      }

      // Handle errors
      if (message.type === 'error') {
        setError(message.message);
        setIsConnected(false);
      }

      // Handle kicked
      if (message.type === 'kicked') {
        setError(message.message);
        disconnect();
      }

      // Forward message to parent component
      if (onMessage) {
        onMessage(message);
      }
    } catch (err) {
      console.error('[WebSocket] Failed to parse message:', err);
    }
  }, [onMessage]);

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    try {
      const wsUrl = getWebSocketUrl();
      console.log('[WebSocket] Connecting to:', wsUrl);
      
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log('[WebSocket] Connected');
        setError(null);
        
        // Send initial message
        if (!isManager && teamName) {
          ws.current?.send(JSON.stringify({
            type: 'team_join',
            team_name: teamName,
            game_code: gameCode.toUpperCase()
          }));
        }
        
        startHeartbeat();
      };

      ws.current.onmessage = handleMessage;

      ws.current.onerror = (event) => {
        console.error('[WebSocket] Error:', event);
        setError('WebSocket connection error');
        setIsConnected(false);
      };

      ws.current.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setIsConnected(false);
        stopHeartbeat();
        
        // Auto-reconnect after 3 seconds if not manually disconnected
        if (autoConnect) {
          reconnectTimeout.current = setTimeout(() => {
            console.log('[WebSocket] Attempting reconnection...');
            connect();
          }, 3000);
        }
      };
    } catch (err) {
      console.error('[WebSocket] Connection failed:', err);
      setError('Failed to connect to WebSocket');
    }
  }, [gameCode, teamName, isManager, autoConnect, handleMessage, startHeartbeat, stopHeartbeat]);

  const disconnect = useCallback(() => {
    console.log('[WebSocket] Disconnecting...');
    
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }
    
    stopHeartbeat();
    
    if (ws.current) {
      // Send leave message if team
      if (!isManager && teamName && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'team_leave' }));
      }
      
      ws.current.close();
      ws.current = null;
    }
    
    setIsConnected(false);
  }, [isManager, teamName, stopHeartbeat]);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Sending:', message);
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn('[WebSocket] Cannot send message, not connected');
    }
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect]); // Only run on mount/unmount

  return {
    isConnected,
    teams,
    totalTeams,
    error,
    sendMessage,
    connect,
    disconnect
  };
};
