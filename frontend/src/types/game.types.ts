/**
 * Game-specific TypeScript types for Sound Clash
 * Defines all interfaces for game state, teams, rounds, and WebSocket events
 */

// Role types for different screen types
export type Role = 'team' | 'manager' | 'display';

// Game states
export type GameState = 'waiting' | 'playing' | 'finished';

// Round states
export type RoundState = 'not_started' | 'song_playing' | 'buzzer_locked' | 'evaluating' | 'completed';

// Buzzer states for team screens
export type BuzzerState = 'enabled' | 'disabled' | 'you_buzzed' | 'other_buzzed' | 'locked';

// Team information
export interface Team {
  name: string;
  score: number;
  connected: boolean;
}

// Component lock status (song name and artist/content)
export interface ComponentLockStatus {
  song_name: boolean;
  artist_content: boolean;
}

// Round information
export interface RoundInfo {
  round_number: number;
  song_name: string;
  artist_or_content: string;
  youtube_id: string;
  is_soundtrack: boolean;
  locked_components: ComponentLockStatus;
  state: RoundState;
}

// Game information
export interface GameInfo {
  code: string;
  state: GameState;
  teams: Team[];
  current_round?: RoundInfo;
  rounds_played: number;
}

// WebSocket connection status
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

// Base WebSocket message
export interface WSMessage {
  type: string;
  [key: string]: any;
}

// Client -> Server: Buzz pressed
export interface BuzzPressedMessage extends WSMessage {
  type: 'buzz_pressed';
  team_name: string;
}

// Client -> Server: Evaluate answer (manager only)
export interface EvaluateAnswerMessage extends WSMessage {
  type: 'evaluate_answer';
  team_name: string;
  approved_song_name: boolean;
  approved_artist_content: boolean;
  wrong_answer: boolean;
}

// Client -> Server: Game control actions (manager only)
export interface GameControlMessage extends WSMessage {
  type: 'start_round' | 'restart_song' | 'skip_round' | 'next_round' | 'end_game';
}

// Server -> Client: Game started
export interface GameStartedMessage extends WSMessage {
  type: 'game_started';
}

// Server -> Client: Round started
export interface RoundStartedMessage extends WSMessage {
  type: 'round_started';
  song_name: string;
  artist_or_content: string;
  youtube_id: string;
  is_soundtrack: boolean;
  round_number: number;
}

// Server -> Client: Buzzer locked
export interface BuzzerLockedMessage extends WSMessage {
  type: 'buzzer_locked';
  team_name: string;
  timestamp: number;
}

// Server -> Client: Answer evaluated
export interface AnswerEvaluatedMessage extends WSMessage {
  type: 'answer_evaluated';
  team_name: string;
  points_awarded: number;
  locked_components: ComponentLockStatus;
  scores: Array<{ team_name: string; score: number }>;
}

// Server -> Client: Round completed
export interface RoundCompletedMessage extends WSMessage {
  type: 'round_completed';
  correct_song: string;
  correct_artist_content: string;
}

// Server -> Client: Game ended
export interface GameEndedMessage extends WSMessage {
  type: 'game_ended';
  winner: string;
  final_scores: Array<{ team_name: string; score: number }>;
  rounds_played: number;
}

// Server -> Client: Team list update
export interface TeamListUpdateMessage extends WSMessage {
  type: 'team_list_update';
  teams: string[];
  total_teams: number;
}

// Server -> Client: Error
export interface ErrorMessage extends WSMessage {
  type: 'error';
  message: string;
}

// Union type for all WebSocket messages
export type WebSocketMessage =
  | BuzzPressedMessage
  | EvaluateAnswerMessage
  | GameControlMessage
  | GameStartedMessage
  | RoundStartedMessage
  | BuzzerLockedMessage
  | AnswerEvaluatedMessage
  | RoundCompletedMessage
  | GameEndedMessage
  | TeamListUpdateMessage
  | ErrorMessage;

// Game API responses
export interface GameStatusResponse {
  exists: boolean;
  state: GameState;
  teams_count: number;
}

export interface CreateGameResponse {
  game_code: string;
  genres: string[];
}

// Genre categories for game creation
export interface GenreCategory {
  name: string;
  genres: string[];
}

export const GENRE_CATEGORIES: GenreCategory[] = [
  {
    name: 'Israeli Music',
    genres: ['Israeli Rock', 'Israeli Pop', 'Hafla', 'Israeli Classics']
  },
  {
    name: 'Musical Styles',
    genres: ['Rock', 'Pop', 'Hip-Hop', 'Electronic', 'Country', 'R&B']
  },
  {
    name: 'Decades',
    genres: ['60s-70s', '80s', '90s', '2000s', '2010s', '2020s']
  },
  {
    name: 'Media/Soundtracks',
    genres: ['Movie Soundtracks', 'TV Themes', 'Disney', 'Video Games']
  }
];
