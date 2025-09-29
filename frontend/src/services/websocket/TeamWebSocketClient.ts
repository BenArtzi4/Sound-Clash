/**
 * Team WebSocket Client for Sound Clash
 * Handles WebSocket connections for team members
 */

import {
  ConnectionState,
  WebSocketMessage,
  TeamJoinMessage,
  TeamLeaveMessage,
  PingMessage,
  ConnectionAckMessage,
  TeamJoinedMessage,
  TeamLeftMessage,
  ErrorMessage,
  KickedMessage,
  WebSocketCallbacks,
} from './types';
import { getTeamWebSocketURL, WEBSOCKET_CONFIG } from './config';

export class TeamWebSocketClient {
  private ws: WebSocket | null = null;
  private gameCode: string = '';
  private teamName: string = '';
  private connectionState: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private callbacks: WebSocketCallbacks = {};
  private currentTeams: string[] = [];

  /**
   * Connect to the WebSocket server
   */
  async connect(gameCode: string, teamName: string, callbacks?: WebSocketCallbacks): Promise<boolean> {
    if (this.connectionState === ConnectionState.CONNECTED) {
      console.warn('Already connected');
      return true;
    }

    this.gameCode = gameCode.toUpperCase();
    this.teamName = teamName;
    this.callbacks = callbacks || {};
    this.connectionState = ConnectionState.CONNECTING;

    try {
      const url = getTeamWebSocketURL(this.gameCode);
      console.log(`Connecting to WebSocket: ${url}`);

      this.ws = new WebSocket(url);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.handleError('Connection timeout');
          reject(new Error('Connection timeout'));
        }, WEBSOCKET_CONFIG.connectionTimeout);

        this.ws!.onopen = () => {
          clearTimeout(timeout);
          console.log('WebSocket connected');
          this.handleOpen();
        };

        this.ws!.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws!.onerror = (error) => {
          clearTimeout(timeout);
          console.error('WebSocket error:', error);
          this.handleError('Connection error');
          reject(error);
        };

        this.ws!.onclose = (event) => {
          clearTimeout(timeout);
          console.log('WebSocket closed:', event.code, event.reason);
          this.handleClose();
        };

        // Wait for connection acknowledgment
        const originalOnMessage = this.ws!.onmessage;
        this.ws!.onmessage = (event) => {
          const message = JSON.parse(event.data) as WebSocketMessage;
          if (message.type === 'connection_ack') {
            const ackMessage = message as ConnectionAckMessage;
            if (ackMessage.success) {
              clearTimeout(timeout);
              this.ws!.onmessage = originalOnMessage;
              resolve(true);
            } else {
              clearTimeout(timeout);
              reject(new Error('Connection rejected'));
            }
          } else if (message.type === 'error') {
            const errorMessage = message as ErrorMessage;
            clearTimeout(timeout);
            reject(new Error(errorMessage.message));
          }
        };
      });
    } catch (error) {
      console.error('Failed to connect:', error);
      this.handleError(`Connection failed: ${error}`);
      return false;
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.ws && this.connectionState === ConnectionState.CONNECTED) {
      // Send leave message
      const leaveMessage: TeamLeaveMessage = {
        type: 'team_leave',
      };
      this.send(leaveMessage);

      // Close connection
      this.ws.close();
    }

    this.cleanup();
  }

  /**
   * Send a message to the server
   */
  private send(message: WebSocketMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, cannot send message');
    }
  }

  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    console.log('WebSocket connection established');

    // Send join message
    const joinMessage: TeamJoinMessage = {
      type: 'team_join',
      team_name: this.teamName,
    };
    this.send(joinMessage);

    // Don't set to CONNECTED yet, wait for ack
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;
      console.log('Received message:', message);

      switch (message.type) {
        case 'connection_ack':
          this.handleConnectionAck(message as ConnectionAckMessage);
          break;

        case 'pong':
          // Pong received, connection is alive
          break;

        case 'team_joined':
          this.handleTeamJoined(message as TeamJoinedMessage);
          break;

        case 'team_left':
          this.handleTeamLeft(message as TeamLeftMessage);
          break;

        case 'error':
          this.handleErrorMessage(message as ErrorMessage);
          break;

        case 'kicked':
          this.handleKicked(message as KickedMessage);
          break;

        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }

  /**
   * Handle connection acknowledgment
   */
  private handleConnectionAck(message: ConnectionAckMessage): void {
    if (message.success) {
      this.connectionState = ConnectionState.CONNECTED;
      this.reconnectAttempts = 0;
      console.log(`Connected as ${message.team_name} to game ${message.game_code}`);

      // Start ping timer
      this.startPingTimer();

      // Notify callback
      if (this.callbacks.onConnected) {
        this.callbacks.onConnected();
      }
    } else {
      this.handleError('Connection rejected by server');
    }
  }

  /**
   * Handle team joined notification
   */
  private handleTeamJoined(message: TeamJoinedMessage): void {
    console.log(`Team joined: ${message.team_name}`);
    this.currentTeams = message.teams;

    if (this.callbacks.onTeamsUpdate) {
      this.callbacks.onTeamsUpdate(message.teams);
    }
  }

  /**
   * Handle team left notification
   */
  private handleTeamLeft(message: TeamLeftMessage): void {
    console.log(`Team left: ${message.team_name}`);
    this.currentTeams = message.teams;

    if (this.callbacks.onTeamsUpdate) {
      this.callbacks.onTeamsUpdate(message.teams);
    }
  }

  /**
   * Handle error message from server
   */
  private handleErrorMessage(message: ErrorMessage): void {
    console.error('Server error:', message.message);
    this.handleError(message.message);
  }

  /**
   * Handle kicked notification
   */
  private handleKicked(message: KickedMessage): void {
    console.log('Kicked from game:', message.reason);

    if (this.callbacks.onKicked) {
      this.callbacks.onKicked(message.reason);
    }

    // Disconnect without reconnecting
    this.cleanup();
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(): void {
    console.log('WebSocket connection closed');
    this.cleanup();

    if (this.callbacks.onDisconnected) {
      this.callbacks.onDisconnected();
    }

    // Attempt reconnection if not intentionally disconnected
    if (
      this.connectionState !== ConnectionState.DISCONNECTED &&
      this.reconnectAttempts < WEBSOCKET_CONFIG.maxReconnectAttempts
    ) {
      this.attemptReconnect();
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: string): void {
    console.error('WebSocket error:', error);
    this.connectionState = ConnectionState.ERROR;

    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectTimer) {
      return; // Already attempting reconnect
    }

    this.connectionState = ConnectionState.RECONNECTING;
    this.reconnectAttempts++;

    console.log(
      `Reconnecting... Attempt ${this.reconnectAttempts}/${WEBSOCKET_CONFIG.maxReconnectAttempts}`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.gameCode, this.teamName, this.callbacks);
    }, WEBSOCKET_CONFIG.reconnectInterval);
  }

  /**
   * Start ping timer to keep connection alive
   */
  private startPingTimer(): void {
    this.stopPingTimer();

    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const pingMessage: PingMessage = {
          type: 'ping',
        };
        this.send(pingMessage);
      }
    }, WEBSOCKET_CONFIG.pingInterval);
  }

  /**
   * Stop ping timer
   */
  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.stopPingTimer();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws = null;
    }

    this.connectionState = ConnectionState.DISCONNECTED;
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get current teams
   */
  getCurrentTeams(): string[] {
    return [...this.currentTeams];
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === ConnectionState.CONNECTED;
  }
}
