import { useState, useEffect, useRef, useCallback } from 'react';

interface Team {
  name: string;
  score: number;
  connected: boolean;
}

interface RoundInfo {
  round_number: number;
  song: {
    id: number;
    title: string;
    artist: string;
    youtube_id: string;
    start_time: number;
  };
}

interface BuzzInfo {
  team_name: string;
  reaction_time_ms: number;
  timestamp: string;
}

interface GameState {
  state: 'waiting' | 'playing' | 'finished';
  teams: Team[];
  currentRound: RoundInfo | null;
  buzzedTeam: BuzzInfo | null;
}

interface UseManagerWebSocketProps {
  gameCode: string;
  onGameStarted?: () => void;
  onRoundStarted?: (round: RoundInfo) => void;
  onBuzzerLocked?: (buzz: BuzzInfo) => void;
  onRoundCompleted?: () => void;
  onGameFinished?: (result: any) => void;
}

interface UseManagerWebSocketReturn {
  isConnected: boolean;
  gameState: GameState;
  error: string | null;
  reconnectAttempts: number;
}

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8002';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

export const useManagerWebSocket = ({
  gameCode,
  onGameStarted,
  onRoundStarted,
  onBuzzerLocked,
  onRoundCompleted,
  onGameFinished,
}: UseManagerWebSocketProps): UseManagerWebSocketReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  const [gameState, setGameState] = useState<GameState>({
    state: 'waiting',
    teams: [],
    currentRound: null,
    buzzedTeam: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldConnectRef = useRef(true);

  const connect = useCallback(() => {
    if (!shouldConnectRef.current || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }

    try {
      const wsUrl = `${WS_URL}/ws/manager/${gameCode}`;
      console.log('[Manager WS] Connecting to:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Manager WS] Connected');
        setIsConnected(true);
        setError(null);
        setReconnectAttempts(0);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[Manager WS] Received:', message);

          switch (message.type) {
            case 'manager_connected':
              setGameState(prev => ({
                ...prev,
                state: message.game_state,
                teams: message.teams?.map((name: string) => ({
                  name,
                  score: 0,
                  connected: true
                })) || []
              }));
              break;

            case 'team_joined':
              setGameState(prev => ({
                ...prev,
                teams: message.teams?.map((name: string) => ({
                  name,
                  score: prev.teams.find(t => t.name === name)?.score || 0,
                  connected: true
                })) || prev.teams
              }));
              break;

            case 'team_left':
              setGameState(prev => ({
                ...prev,
                teams: message.teams?.map((name: string) => ({
                  name,
                  score: prev.teams.find(t => t.name === name)?.score || 0,
                  connected: true
                })) || prev.teams
              }));
              break;

            case 'game_started':
              setGameState(prev => ({ ...prev, state: 'playing' }));
              onGameStarted?.();
              break;

            case 'round_started':
              const roundInfo: RoundInfo = {
                round_number: message.round_number,
                song: message.song
              };
              setGameState(prev => ({
                ...prev,
                currentRound: roundInfo,
                buzzedTeam: null
              }));
              onRoundStarted?.(roundInfo);
              break;

            case 'buzzer_locked':
              const buzzInfo: BuzzInfo = {
                team_name: message.team_name,
                reaction_time_ms: message.reaction_time_ms,
                timestamp: message.timestamp
              };
              setGameState(prev => ({
                ...prev,
                buzzedTeam: buzzInfo
              }));
              onBuzzerLocked?.(buzzInfo);
              break;

            case 'round_completed':
              // Update team scores
              if (message.team_scores) {
                setGameState(prev => ({
                  ...prev,
                  teams: prev.teams.map(team => ({
                    ...team,
                    score: message.team_scores[team.name] || team.score
                  })),
                  buzzedTeam: null
                }));
              }
              onRoundCompleted?.();
              break;

            case 'game_finished':
              setGameState(prev => ({ ...prev, state: 'finished' }));
              onGameFinished?.(message);
              break;

            case 'error':
              setError(message.message || 'Unknown error');
              break;

            case 'pong':
              // Heartbeat response
              break;

            default:
              console.log('[Manager WS] Unknown message type:', message.type);
          }
        } catch (err) {
          console.error('[Manager WS] Failed to parse message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('[Manager WS] Error:', event);
        setError('WebSocket connection error');
      };

      ws.onclose = () => {
        console.log('[Manager WS] Disconnected');
        setIsConnected(false);
        wsRef.current = null;

        // Attempt reconnection
        if (shouldConnectRef.current && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts);
          console.log(`[Manager WS] Reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, delay);
        }
      };

    } catch (err) {
      console.error('[Manager WS] Connection error:', err);
      setError('Failed to connect to game server');
    }
  }, [gameCode, reconnectAttempts, onGameStarted, onRoundStarted, onBuzzerLocked, onRoundCompleted, onGameFinished]);

  // Initial connection
  useEffect(() => {
    shouldConnectRef.current = true;
    connect();

    // Cleanup
    return () => {
      shouldConnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  // Heartbeat
  useEffect(() => {
    if (!isConnected || !wsRef.current) return;

    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 10000); // Every 10 seconds

    return () => clearInterval(interval);
  }, [isConnected]);

  return {
    isConnected,
    gameState,
    error,
    reconnectAttempts,
  };
};
