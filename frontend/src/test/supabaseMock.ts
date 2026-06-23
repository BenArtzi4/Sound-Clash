import { vi } from "vitest";
import type { ActiveGame, GameRound, PostgresChangePayload, Team } from "../lib/types";

export type ChangeListener<T> = (payload: PostgresChangePayload<T>) => void;
export type TableName = "active_games" | "game_teams" | "game_rounds";

interface State {
  listeners: Record<TableName, ChangeListener<unknown>[]>;
  subscribeCallbacks: Array<(status: string) => void | Promise<void>>;
  hydrate: { game: ActiveGame | null; teams: Team[]; rounds: GameRound[] };
  rpcResponse: { data: unknown; error: { message: string; code?: string } | null };
  // Map of song id -> row used by from("songs").maybeSingle() lookups so the
  // manager-refresh code path (re-resolves currentRound.song_id back to a
  // song record) can be exercised in unit tests.
  songsById: Record<
    string,
    {
      id: string;
      title: string;
      artist: string;
      youtube_id: string;
      start_time: number;
      is_soundtrack: boolean;
    }
  >;
}

const state: State = {
  listeners: { active_games: [], game_teams: [], game_rounds: [] },
  subscribeCallbacks: [],
  hydrate: { game: null, teams: [], rounds: [] },
  rpcResponse: { data: [], error: null },
  songsById: {},
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

function buildSelect(table: TableName | "songs") {
  let pendingId: string | null = null;
  let pendingInIds: string[] | null = null;
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      if (table === "songs" && column === "id" && typeof value === "string") {
        pendingId = value;
      }
      return builder;
    }),
    // Batch lookup used by SongExport: from("songs").select(...).in("id", ids).
    in: vi.fn((column: string, values: readonly unknown[]) => {
      if (table === "songs" && column === "id") {
        pendingInIds = (values as string[]).slice();
      }
      return builder;
    }),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => {
      if (table === "active_games") {
        return { data: state.hydrate.game, error: null };
      }
      if (table === "songs" && pendingId !== null) {
        const row = state.songsById[pendingId];
        if (!row) return { data: null, error: null };
        // The in-game pages no longer select the dropped is_soundtrack column;
        // they embed genre slugs (`song_genres(genres(slug))`) and derive it.
        // Reproduce that shape from the stored flag so tests keep setting
        // is_soundtrack directly.
        const song_genres = row.is_soundtrack
          ? [{ genres: { slug: "soundtracks" } }]
          : [{ genres: { slug: "rock" } }];
        return { data: { ...row, song_genres }, error: null };
      }
      return { data: null, error: null };
    }),
    single: vi.fn(async () => ({ data: null, error: null })),
    then<T>(onfulfilled?: (value: { data: unknown; error: unknown }) => T): Promise<T> {
      if (table === "songs" && pendingInIds !== null) {
        const rows: { id: string; title: string; artist: string; youtube_id: string }[] = [];
        for (const id of pendingInIds) {
          const row = state.songsById[id];
          if (row) {
            rows.push({
              id: row.id,
              title: row.title,
              artist: row.artist,
              youtube_id: row.youtube_id,
            });
          }
        }
        return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
      }
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

export const supabaseMock = {
  channel: vi.fn(() => channelMock),
  removeChannel: vi.fn(),
  from: vi.fn((table: TableName | "songs") => buildSelect(table)),
  rpc: vi.fn(async () => state.rpcResponse),
};

export function resetSupabaseMock(): void {
  state.listeners = { active_games: [], game_teams: [], game_rounds: [] };
  state.subscribeCallbacks = [];
  state.hydrate = { game: null, teams: [], rounds: [] };
  state.rpcResponse = { data: [], error: null };
  state.songsById = {};
  supabaseMock.channel.mockClear();
  supabaseMock.removeChannel.mockClear();
  supabaseMock.from.mockClear();
  supabaseMock.rpc.mockClear();
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
}): void {
  state.songsById[song.id] = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    youtube_id: song.youtube_id,
    start_time: song.start_time ?? 0,
    is_soundtrack: song.is_soundtrack ?? false,
  };
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
    expires_at: "2026-05-05T16:00:00.000Z",
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
