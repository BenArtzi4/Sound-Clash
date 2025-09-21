// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Game Related Types
export interface Game {
  gameCode: string;
  status: 'waiting' | 'active' | 'ended';
  teams: string[];
  settings: GameSettings;
  createdAt: string;
  expiresAt: string;
}

export interface GameSettings {
  genres: string[];
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed';
  roundTime: number;
  maxTeams?: number;
}

export interface Team {
  name: string;
  score: number;
  connected: boolean;
  joinedAt: string;
}

export interface Round {
  id: string;
  songId: string;
  songTitle: string;
  artist: string;
  difficulty: 'easy' | 'medium' | 'hard';
  genre: string;
  buzzWinner?: string;
  answers: {
    song?: boolean;
    artist?: boolean;
    movie?: boolean;
  };
  scores: Record<string, number>;
}

// WebSocket Message Types
export interface WebSocketMessage {
  type: string;
  gameCode: string;
  data?: any;
  timestamp: string;
}

export interface TeamJoinMessage extends WebSocketMessage {
  type: 'team_join';
  data: {
    teamName: string;
  };
}

export interface TeamLeaveMessage extends WebSocketMessage {
  type: 'team_leave';
  data: {
    teamName: string;
  };
}

export interface GameStateMessage extends WebSocketMessage {
  type: 'game_state_update';
  data: {
    status: Game['status'];
    teams: string[];
  };
}

export interface BuzzMessage extends WebSocketMessage {
  type: 'buzz';
  data: {
    teamName: string;
    timestamp: number;
  };
}

// Form Types
export interface JoinGameForm {
  gameCode: string;
  teamName: string;
}

export interface CreateGameForm {
  genres: string[];
  settings?: Partial<GameSettings>;
}

// Error Types
export interface ValidationError {
  field: string;
  message: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: ValidationError[];
}

// Component Props Types
export interface GameContextType {
  gameCode: string | null;
  teamName: string | null;
  isManager: boolean;
  gameStatus: Game['status'];
  teams: string[];
  error: string | null;
  loading: boolean;
}

// Genre Options
export interface GenreOption {
  id: string;
  label: string;
  description: string;
  category?: string;
}

// Utility Types
export type GamePhase = 'landing' | 'joining' | 'creating' | 'waiting' | 'playing' | 'results';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary';
export type ButtonSize = 'small' | 'medium' | 'large';
export type LogoSize = 'small' | 'medium' | 'large';