import { vi } from "vitest";
import type { ActiveGame, GameRound, PostgresChangePayload, Team } from "../lib/types";

export type ChangeListener<T> = (payload: PostgresChangePayload<T>) => void;
export type TableName = "active_games" | "game_teams" | "game_rounds";

interface State {
  listeners: Record<TableName, ChangeListener<unknown>[]>;
  subscribeCallbacks: Array<(status: string) => void | Promise<void>>;
  hydrate: { game: ActiveGame | null; teams: Team[]; rounds: GameRound[] };
  // When set, the active_games hydrate read resolves with this error (the
  // shape PostgREST returns on failure) so tests can exercise a failed
  // snapshot. Cleared by setHydrateError(null) / resetSupabaseMock().
  hydrateError: { message: string; code?: string } | null;
  rpcResponse: RpcResult;
  // Map of song id -> row served by the game-scoped song RPCs (migration 053):
  // rpc("round_song") resolves one id (the manager-refresh and TV-reveal code
  // paths re-resolve currentRound.song_id back to a song record) and
  // rpc("game_setlist") returns every stored song (the end-of-game setlist).
  // The mock does not scope songs to a game; tests assert the game code the
  // caller passed instead.
  songsById: Record<
    string,
    {
      id: string;
      title: string;
      artist: string;
      youtube_id: string;
      start_time: number;
      is_soundtrack: boolean;
      release_year: number | null;
    }
  >;
  // When > 0, the next N rpc("round_song") lookups resolve with songFetchError
  // instead of a row so tests can exercise the bounded backoff retry in
  // lib/songMetadata.ts. songFetchAttempts counts every lookup.
  songFetchFailuresRemaining: number;
  songFetchError: { message: string; code?: string };
  songFetchAttempts: number;
  // Same idea for the setlist's batch lookup (rpc("game_setlist")): the next N
  // batch reads fail, and songBatchAttempts counts them all.
  songBatchFailuresRemaining: number;
  songBatchAttempts: number;
}

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

// The catalog tables the browser must not read directly since migration 053
// (it goes through round_song / game_setlist). The mock refuses them so a
// regression to a direct read fails the tests instead of passing silently.
const CATALOG_TABLES: ReadonlySet<string> = new Set(["songs", "song_genres"]);

const state: State = {
  listeners: { active_games: [], game_teams: [], game_rounds: [] },
  subscribeCallbacks: [],
  hydrate: { game: null, teams: [], rounds: [] },
  hydrateError: null,
  rpcResponse: { data: [], error: null },
  songsById: {},
  songFetchFailuresRemaining: 0,
  songFetchError: { message: "song fetch failed" },
  songFetchAttempts: 0,
  songBatchFailuresRemaining: 0,
  songBatchAttempts: 0,
};

export const channelMock = {
  on: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
};

channelMock.on.mockImplementation(
  (_event: string, opts: { table: TableName }, cb: ChangeListener<unknown>) => {
    state.listeners[opts.table].push(cb);
    return channelMock;
  },
);

channelMock.subscribe.mockImplementation((cb: (status: string) => void) => {
  state.subscribeCallbacks.push(cb);
  return channelMock;
});

function buildSelect(table: TableName) {
  if (CATALOG_TABLES.has(table)) {
    throw new Error(
      `supabaseMock: the browser must not read "${table}" directly; use the round_song / game_setlist RPCs (migration 053)`,
    );
  }
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      if (table === "active_games") {
        if (state.hydrateError) return { data: null, error: state.hydrateError };
        return { data: state.hydrate.game, error: null };
      }
      return { data: null, error: null };
    }),
    single: vi.fn(async () => ({ data: null, error: null })),
    then<T>(onfulfilled?: (value: { data: unknown; error: unknown }) => T): Promise<T> {
      const data =
        table === "game_teams"
          ? state.hydrate.teams
          : table === "game_rounds"
            ? state.hydrate.rounds
            : state.hydrate.game;
      return Promise.resolve({ data, error: null }).then(onfulfilled);
    },
  };
  return builder;
}

// A round_song / game_setlist row (migration 053), built from a stored song.
// The RPCs return the song's genre slugs and the page derives is_soundtrack
// from them, so reproduce a slug from the stored flag: tests keep setting
// is_soundtrack directly.
function catalogRow(row: State["songsById"][string]) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    youtube_id: row.youtube_id,
    start_time: row.start_time,
    release_year: row.release_year,
    genre_slugs: [row.is_soundtrack ? "soundtracks" : "rock"],
  };
}

function roundSong(args: Record<string, unknown> | undefined): RpcResult {
  state.songFetchAttempts += 1;
  if (state.songFetchFailuresRemaining > 0) {
    state.songFetchFailuresRemaining -= 1;
    return { data: null, error: state.songFetchError };
  }
  const songId = typeof args?.p_song_id === "string" ? args.p_song_id : "";
  const row = state.songsById[songId];
  // Zero rows (not an error) for a song that game didn't play.
  return { data: row ? [catalogRow(row)] : [], error: null };
}

function gameSetlist(): RpcResult {
  state.songBatchAttempts += 1;
  if (state.songBatchFailuresRemaining > 0) {
    state.songBatchFailuresRemaining -= 1;
    return { data: null, error: { message: "song batch failed" } };
  }
  const rows = Object.values(state.songsById).map((row, i) => ({
    round_number: i + 1,
    ...catalogRow(row),
  }));
  return { data: rows, error: null };
}

async function rpcImpl(fn: string, args?: Record<string, unknown>): Promise<RpcResult> {
  if (fn === "round_song") return roundSong(args);
  if (fn === "game_setlist") return gameSetlist();
  return state.rpcResponse;
}

export const supabaseMock = {
  channel: vi.fn(() => channelMock),
  removeChannel: vi.fn(),
  from: vi.fn((table: TableName) => buildSelect(table)),
  rpc: vi.fn(rpcImpl),
};

export function resetSupabaseMock(): void {
  state.listeners = { active_games: [], game_teams: [], game_rounds: [] };
  state.subscribeCallbacks = [];
  state.hydrate = { game: null, teams: [], rounds: [] };
  state.hydrateError = null;
  state.rpcResponse = { data: [], error: null };
  state.songsById = {};
  state.songFetchFailuresRemaining = 0;
  state.songFetchError = { message: "song fetch failed" };
  state.songFetchAttempts = 0;
  state.songBatchFailuresRemaining = 0;
  state.songBatchAttempts = 0;
  supabaseMock.channel.mockClear();
  supabaseMock.removeChannel.mockClear();
  supabaseMock.from.mockClear();
  supabaseMock.rpc.mockClear();
  // Re-assert the routing implementations (a test may have replaced them).
  supabaseMock.from.mockImplementation((table: TableName) => buildSelect(table));
  supabaseMock.rpc.mockImplementation(rpcImpl);
  channelMock.on.mockClear();
  channelMock.subscribe.mockClear();
  channelMock.unsubscribe.mockClear();
  channelMock.on.mockImplementation(
    (_event: string, opts: { table: TableName }, cb: ChangeListener<unknown>) => {
      state.listeners[opts.table].push(cb);
      return channelMock;
    },
  );
  channelMock.subscribe.mockImplementation((cb: (status: string) => void) => {
    state.subscribeCallbacks.push(cb);
    return channelMock;
  });
}

export function setHydrate(data: {
  game?: ActiveGame | null;
  teams?: Team[];
  rounds?: GameRound[];
}): void {
  state.hydrate = {
    game: data.game === undefined ? state.hydrate.game : data.game,
    teams: data.teams ?? state.hydrate.teams,
    rounds: data.rounds ?? state.hydrate.rounds,
  };
}

export function setHydrateError(error: { message: string; code?: string } | null): void {
  state.hydrateError = error;
}

export function setRpcResponse(response: {
  data: unknown;
  error: { message: string; code?: string } | null;
}): void {
  state.rpcResponse = response;
}

export function setSongFetch(song: {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  start_time?: number;
  is_soundtrack?: boolean;
  release_year?: number | null;
}): void {
  state.songsById[song.id] = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    youtube_id: song.youtube_id,
    start_time: song.start_time ?? 0,
    is_soundtrack: song.is_soundtrack ?? false,
    release_year: song.release_year ?? null,
  };
}

export function setSongBatchFailures(count: number): void {
  state.songBatchFailuresRemaining = count;
}

export function getSongBatchAttempts(): number {
  return state.songBatchAttempts;
}

export function setSongFetchFailures(
  count: number,
  error: { message: string; code?: string } = { message: "song fetch failed" },
): void {
  state.songFetchFailuresRemaining = count;
  state.songFetchError = error;
}

export function getSongFetchAttempts(): number {
  return state.songFetchAttempts;
}

export async function fireSubscribed(): Promise<void> {
  for (const cb of state.subscribeCallbacks) {
    await cb("SUBSCRIBED");
  }
}

export async function fireStatus(status: string): Promise<void> {
  for (const cb of state.subscribeCallbacks) {
    await cb(status);
  }
}

export function fireGame(payload: PostgresChangePayload<ActiveGame>): void {
  state.listeners.active_games.forEach((cb) => cb(payload as PostgresChangePayload<unknown>));
}

export function fireTeam(payload: PostgresChangePayload<Team>): void {
  state.listeners.game_teams.forEach((cb) => cb(payload as PostgresChangePayload<unknown>));
}

export function fireRound(payload: PostgresChangePayload<GameRound>): void {
  state.listeners.game_rounds.forEach((cb) => cb(payload as PostgresChangePayload<unknown>));
}

export function makeActiveGame(overrides: Partial<ActiveGame> = {}): ActiveGame {
  return {
    game_code: "ABCDEF",
    status: "waiting",
    selected_genres: [],
    selected_decades: [],
    round_number: 0,
    current_song_id: null,
    current_round_id: null,
    buzzed_team_id: null,
    locked_at: null,
    started_at: "2026-05-05T12:00:00.000Z",
    ended_at: null,
    // Far future on both clocks a test can run under (the real one, and a
    // server clock pinned to 2026-05-05 by an observed commit_timestamp): the
    // manager console renders expiry state from this field, so a stale
    // near-past default would put every page test into the warning-banner
    // state. Tests that exercise expiry set an explicit value.
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-1",
    game_code: "ABCDEF",
    name: "Alice",
    score: 0,
    joined_at: "2026-05-05T12:00:01.000Z",
    ...overrides,
  };
}

export function makeRound(overrides: Partial<GameRound> = {}): GameRound {
  return {
    id: "round-1",
    game_code: "ABCDEF",
    round_number: 1,
    song_id: null,
    started_at: "2026-05-05T12:00:30.000Z",
    buzzed_team_id: null,
    title_points: 0,
    artist_points: 0,
    wrong_buzz_penalty: 0,
    title_claimed_by: null,
    artist_claimed_by: null,
    free_guess_active: false,
    ended_at: null,
    ...overrides,
  };
}

export function makePayload<T>(
  table: TableName,
  eventType: "INSERT" | "UPDATE" | "DELETE",
  rows: { new?: T; old?: Partial<T> },
  commitTimestamp = "2026-05-05T12:00:00.000Z",
): PostgresChangePayload<T> {
  return {
    schema: "public",
    table,
    commit_timestamp: commitTimestamp,
    eventType,
    new: (rows.new ?? {}) as T | Record<string, never>,
    old: (rows.old ?? {}) as Partial<T> | Record<string, never>,
    errors: null,
  };
}
