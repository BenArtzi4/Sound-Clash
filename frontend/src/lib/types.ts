// Database row shapes; mirror docs/data-model.md and the SQL in
// db/migrations/{002_durable_tables,003_ephemeral_tables}.sql.

export type GameStatus = "waiting" | "playing" | "ended";

export interface ActiveGame {
  game_code: string;
  status: GameStatus;
  selected_genres: string[];
  selected_decades: number[];
  round_number: number;
  current_song_id: string | null;
  current_round_id: string | null;
  buzzed_team_id: string | null;
  locked_at: string | null;
  started_at: string;
  ended_at: string | null;
  expires_at: string;
}

export interface Team {
  id: string;
  game_code: string;
  name: string;
  score: number;
  joined_at: string;
}

export interface GameRound {
  id: string;
  game_code: string;
  round_number: number;
  song_id: string | null;
  started_at: string;
  buzzed_team_id: string | null;
  title_points: number;
  artist_points: number;
  wrong_buzz_penalty: number;
  title_claimed_by: string | null;
  artist_claimed_by: string | null;
  free_guess_active: boolean;
  ended_at: string | null;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  start_time: number;
  // Original release year of the song (mig 031). Null when unknown / not yet
  // backfilled; optional because the `select_next_song` RPC returns
  // Song-shaped rows without it.
  release_year?: number | null;
  is_soundtrack: boolean;
  // Optional because the `select_next_song` RPC returns Song-shaped rows
  // without joined genres. The admin list/get/create/update endpoints
  // populate it; in-game callers can ignore it.
  genres?: Genre[];
}

export interface Genre {
  id: string;
  name: string;
  slug: string;
}

// The `buzz_in` RPC return row.
export interface BuzzResult {
  locked: boolean;
  locked_team_id: string | null;
  locked_at: string | null;
}

// Realtime postgres_changes payload; see docs/api-contracts.md §4.2.
export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface PostgresChangePayload<TRow> {
  schema: "public";
  table: string;
  commit_timestamp: string;
  eventType: RealtimeEventType;
  new: TRow | Record<string, never>;
  old: Partial<TRow> | Record<string, never>;
  errors: string[] | null;
}

// Reduced UI state; see docs/realtime-design.md §5.
export interface GameState {
  game: ActiveGame;
  teams: Map<string, Team>;
  rounds: GameRound[];
  currentRound: GameRound | null;
}

export type GameAction =
  | { type: "HYDRATE"; game: ActiveGame; teams: Team[]; rounds: GameRound[] }
  | { type: "GAME_CHANGE"; payload: PostgresChangePayload<ActiveGame> }
  | { type: "TEAM_CHANGE"; payload: PostgresChangePayload<Team> }
  | { type: "ROUND_CHANGE"; payload: PostgresChangePayload<GameRound> }
  | { type: "GAME_DELETED" };

// REST error envelope; backend/app/middleware error mapping.
export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export interface CreateGameResponse {
  game_code: string;
  status: GameStatus;
  selected_genres: string[];
  selected_decades: number[];
  started_at: string;
  expires_at: string;
  manager_token: string;
}

export interface SelectSongResponse {
  round_id: string;
  round_number: number;
  song: Song;
}

export interface AttemptResponse {
  round_id: string;
  team_id: string | null;
  points_awarded: number;
  team_total_score: number;
  title_claimed_by: string | null;
  artist_claimed_by: string | null;
}

export interface AwardBonusRequest {
  team_id: string;
  points?: number;
}

export interface AwardBonusResponse {
  team_id: string;
  points_awarded: number;
  team_total_score: number;
}

export interface EndGameResponse {
  game_code: string;
  status: GameStatus;
  ended_at: string;
}

// GET /games/{code}/teams/{id}/rejoin-token — the host-only reveal of a team's
// rejoin token (issue #183). Never sent to players.
export interface TeamRejoinToken {
  team_id: string;
  rejoin_token: string;
}

// Admin song-catalog payloads. Mirrors backend/app/models/songs.py.
export interface SongWritePayload {
  title: string;
  artist: string;
  youtube_id: string;
  start_time: number;
  release_year: number | null;
  genre_ids: string[];
}

export interface SongListResponse {
  items: Song[];
  page: number;
  per_page: number;
  total: number;
}

export interface BulkImportSummary {
  inserted: number;
  updated: number;
  total: number;
}
