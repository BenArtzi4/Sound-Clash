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
  sendMessage: (message: any) => void;
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
  const isConnectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);

  // Store callbacks in refs to avoid reconnection when they change
  const onGameStartedRef = useRef(onGameStarted);
  const onRoundStartedRef = useRef(onRoundStarted);
  const onBuzzerLockedRef = useRef(onBuzzerLocked);
  const onRoundCompletedRef = useRef(onRoundCompleted);
  const onGameFinishedRef = useRef(onGameFinished);

  // Update callback refs when they change (without triggering reconnection)
  useEffect(() => {
    onGameStartedRef.current = onGameStarted;
    onRoundStartedRef.current = onRoundStarted;
    onBuzzerLockedRef.current = onBuzzerLocked;
    onRoundCompletedRef.current = onRoundCompleted;
    onGameFinishedRef.current = onGameFinished;
  }, [onGameStarted, onRoundStarted, onBuzzerLocked, onRoundCompleted, onGameFinished]);

  const connect = useCallback(() => {
    // Prevent multiple simultaneous connections
    if (isConnectingRef.current) {
      console.log('[Manager WS] Already connecting, skipping...');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      console.log('[Manager WS] Already connected or connecting, skipping...');
      return;
    }

    if (!shouldConnectRef.current || reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      return;
    }

    isConnectingRef.current = true;

    try {
      const wsUrl = `${WS_URL}/ws/manager/${gameCode}`;
      console.log('[Manager WS] Connecting to:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Manager WS] Connected');
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);
        isConnectingRef.current = false;
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
              onGameStartedRef.current?.();
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
              onRoundStartedRef.current?.(roundInfo);
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
              onBuzzerLockedRef.current?.(buzzInfo);
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
              onRoundCompletedRef.current?.();
              break;

            case 'game_finished':
              setGameState(prev => ({ ...prev, state: 'finished' }));
              onGameFinishedRef.current?.(message);
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
        isConnectingRef.current = false;
        wsRef.current = null;

        // Attempt reconnection
        if (shouldConnectRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          const delay = RECONNECT_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1);
          console.log(`[Manager WS] Reconnecting in ${delay}ms... (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(reconnectAttemptsRef.current);
            connect();
          }, delay);
        }
      };

    } catch (err) {
      console.error('[Manager WS] Connection error:', err);
      setError('Failed to connect to game server');
      isConnectingRef.current = false;
    }
  }, [gameCode]); // Only gameCode - callbacks and reconnectAttempts are now in refs

  // Initial connection - only reconnect when gameCode changes
  useEffect(() => {
    console.log('[Manager WS] useEffect triggered - connecting...');
    shouldConnectRef.current = true;
    connect();

    // Cleanup
    return () => {
      console.log('[Manager WS] useEffect cleanup - disconnecting...');
      shouldConnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      isConnectingRef.current = false;
    };
  }, [gameCode]); // Only reconnect when gameCode changes, NOT when connect function changes

  // Send message function
  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[Manager WS] Sending:', message);
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.error('[Manager WS] Cannot send message - not connected');
    }
  }, []);

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
    sendMessage,
  };
};
