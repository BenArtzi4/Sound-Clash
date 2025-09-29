/**
 * WebSocket Message Types for Sound Clash
 * Defines all message structures for client-server communication
 */

// Connection states
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

// Base message type
export interface BaseMessage {
  type: string;
}

// Team join message (client -> server)
export interface TeamJoinMessage extends BaseMessage {
  type: 'team_join';
  team_name: string;
}

// Team leave message (client -> server)
export interface TeamLeaveMessage extends BaseMessage {
  type: 'team_leave';
}

// Ping message (client -> server)
export interface PingMessage extends BaseMessage {
  type: 'ping';
}

// Connection acknowledgment (server -> client)
export interface ConnectionAckMessage extends BaseMessage {
  type: 'connection_ack';
  success: boolean;
  team_name: string;
  game_code: string;
  teams_count: number;
}

// Pong response (server -> client)
export interface PongMessage extends BaseMessage {
  type: 'pong';
}

// Team list update (server -> client)
export interface TeamListUpdateMessage extends BaseMessage {
  type: 'team_list_update';
  teams: string[];
  total_teams: number;
}

// Team joined notification (server -> client)
export interface TeamJoinedMessage extends BaseMessage {
  type: 'team_joined';
  team_name: string;
  teams: string[];
  total_teams: number;
}

// Team left notification (server -> client)
export interface TeamLeftMessage extends BaseMessage {
  type: 'team_left';
  team_name: string;
  teams: string[];
  total_teams: number;
}

// Error message (server -> client)
export interface ErrorMessage extends BaseMessage {
  type: 'error';
  message: string;
}

// Kicked notification (server -> client)
export interface KickedMessage extends BaseMessage {
  type: 'kicked';
  reason: string;
}

// Union type of all possible messages
export type WebSocketMessage =
  | TeamJoinMessage
  | TeamLeaveMessage
  | PingMessage
  | ConnectionAckMessage
  | PongMessage
  | TeamListUpdateMessage
  | TeamJoinedMessage
  | TeamLeftMessage
  | ErrorMessage
  | KickedMessage;

// Team information
export interface Team {
  name: string;
  status: 'connected' | 'disconnected';
  joinedAt: string;
}

// WebSocket client configuration
export interface WebSocketConfig {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
}

// WebSocket event callbacks
export interface WebSocketCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onTeamsUpdate?: (teams: string[]) => void;
  onError?: (error: string) => void;
  onKicked?: (reason: string) => void;
}
