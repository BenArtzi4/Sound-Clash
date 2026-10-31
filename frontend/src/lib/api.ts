import { env } from "./env";
import { supabase } from "./supabase";
import { tracedFetch } from "./telemetry";
import type {
  ApiErrorBody,
  AwardBonusRequest,
  AwardBonusResponse,
  BulkImportSummary,
  CreateGameResponse,
  EndGameResponse,
  Genre,
  Song,
  SongListResponse,
  SongPoolCell,
  SongWritePayload,
  Team,
  TeamRejoinToken,
} from "./types";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  managerToken?: string;
  adminPassword?: string;
  body?: unknown;
  // Abort the request after this many ms via AbortSignal.timeout. Scoped to the
  // two cold-start-prone Render POSTs (create game, join team) so a request that
  // never returns surfaces as a retryable error instead of hanging the submit
  // button forever. 45s sits above the ~30s cold-start ceiling so it never
  // aborts a legitimate wake. All other calls stay untimed.
  timeoutMs?: number;
  // Marks the request as a test run (X-Sound-Clash-Test: 1), so a game created
  // from a real browser during a check never counts as a real game (mig 051).
  testRun?: boolean;
}

// Collapse per-request identifiers (game codes, team/song ids, query strings)
// to placeholders so the telemetry span's `http.route` groups by endpoint
// rather than fragmenting into one series per game.
function normalizeRoute(method: string, path: string): string {
  const route = path
    .replace(/\?.*$/, "")
    .replace(/\/games\/[^/]+/, "/games/:code")
    .replace(/\/teams\/[^/]+/, "/teams/:id")
    .replace(/\/admin\/songs\/[^/]+/, "/admin/songs/:id");
  return `${method} ${route}`;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body !== undefined && !isFormData) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.managerToken) {
    headers["X-Manager-Token"] = opts.managerToken;
  }
  if (opts.adminPassword) {
    headers["X-Admin-Password"] = opts.adminPassword;
  }
  if (opts.testRun) {
    headers["X-Sound-Clash-Test"] = "1";
  }

  let body: BodyInit | undefined;
  if (opts.body === undefined) {
    body = undefined;
  } else if (isFormData) {
    body = opts.body as FormData;
  } else {
    body = JSON.stringify(opts.body);
  }

  const doFetch = (): Promise<Response> =>
    fetch(`${env.VITE_API_URL}${path}`, {
      method,
      headers,
      body,
      signal: opts.timeoutMs !== undefined ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
  // Trace every REST call except the frequent /health warm-up pings (they'd
  // drown out the meaningful create/join/bonus/end latencies). The route is
  // id-normalized so per-game codes don't explode span cardinality.
  let response: Response;
  try {
    response =
      path === "/health"
        ? await doFetch()
        : await tracedFetch(method, normalizeRoute(method, path), doFetch);
  } catch (err) {
    // AbortSignal.timeout() rejects the fetch with a TimeoutError DOMException
    // (older engines surface AbortError). Convert it to a friendly, retryable
    // ApiError so the caller shows "please try again" and re-enables its submit
    // button instead of propagating a raw DOMException string.
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ApiError("timeout", "This is taking longer than usual. Please try again.", 0);
    }
    throw err;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;

  if (!response.ok) {
    const body = (parsed ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      body.error ?? "internal_error",
      body.message ?? response.statusText,
      response.status,
      body.details,
    );
  }

  return parsed as T;
}

export function getHealth(): Promise<{
  status: string;
  version: string;
  supabase: string;
}> {
  return request("GET", "/health");
}

// Genres are a small, static, anon-readable catalog table, so we fetch them
// DIRECTLY from Supabase (Postgres in Frankfurt, always warm) rather than
// through the Render-hosted `/genres` endpoint. Render's free tier cold-starts
// 2-30s, and the "Host a game" form blocks on this list — a cold backend made
// the genre picker take >5s to appear. Supabase returns the same rows in
// ~150ms whether or not Render is awake. This is the same reasoning that keeps
// the buzzer and the hydrate off Render: no cold start in a user-perceived
// path. The result is memoized for the session, and HomePage prefetches it in
// the background so the picker is usually already in memory by the time the
// host clicks through. (The `/genres` REST endpoint still exists for smoke
// tests and any external caller; the browser just no longer depends on it.)
let cachedGenres: Genre[] | null = null;
let inflightGenres: Promise<Genre[]> | null = null;

export function listGenres(): Promise<Genre[]> {
  if (cachedGenres) return Promise.resolve(cachedGenres);
  if (inflightGenres) return inflightGenres;
  inflightGenres = (async () => {
    try {
      const { data, error } = await supabase.from("genres").select("id,name,slug").order("name");
      if (error) throw new Error(error.message);
      const result = (data ?? []) as Genre[];
      cachedGenres = result;
      return result;
    } finally {
      inflightGenres = null;
    }
  })();
  return inflightGenres;
}

/** The genres an earlier listGenres() already fetched, or null. Home fetches
 * them on landing, so the create page can draw its tiles on the first frame. */
export function getCachedGenres(): Genre[] | null {
  return cachedGenres;
}

// The create page's song count (issue #375): song_pool_counts() (migration 052)
// returns the playable catalog grouped by decade and genre set, about a hundred
// rows, so the page counts any genre + decade mix itself as the host taps
// (lib/songPool.ts) instead of asking the server on every tap. Read direct from
// Supabase like the genres, and memoized for the session the same way.
//
// Resolves null instead of throwing on any failure (the function not yet on
// the database, a network blip): the page then shows no count and blocks
// nothing, exactly as before the count existed. A failure is not cached, so the
// next visit tries again.
let cachedSongPool: SongPoolCell[] | null = null;
let inflightSongPool: Promise<SongPoolCell[] | null> | null = null;

export function loadSongPool(): Promise<SongPoolCell[] | null> {
  if (cachedSongPool) return Promise.resolve(cachedSongPool);
  if (inflightSongPool) return inflightSongPool;
  inflightSongPool = (async () => {
    try {
      const { data, error } = await supabase.rpc("song_pool_counts");
      if (error || !Array.isArray(data)) return null;
      cachedSongPool = data as SongPoolCell[];
      return cachedSongPool;
    } catch {
      return null;
    } finally {
      inflightSongPool = null;
    }
  })();
  return inflightSongPool;
}

// Test-only: reset the genre and song-pool memoization so each test gets a
// clean cache.
export function __resetListGenresCacheForTests(): void {
  cachedGenres = null;
  inflightGenres = null;
  cachedSongPool = null;
  inflightSongPool = null;
}

export function joinTeam(gameCode: string, name: string): Promise<Team> {
  return request("POST", `/games/${gameCode}/teams`, { body: { name }, timeoutMs: 45000 });
}

// Reconnect to an existing team via its per-team rejoin token (issue #183).
// The token comes from a host-shown QR (…/join/<CODE>#rt=<token>); the server
// resolves it back to the SAME game_teams row with its preserved score.
export function rejoinTeam(gameCode: string, token: string): Promise<Team> {
  return request("POST", `/games/${gameCode}/rejoin`, { body: { token } });
}

// Host-only: reveal a team's rejoin token so the console can render a rescue
// QR. Gated by X-Manager-Token — this is the only endpoint that discloses it.
export function getTeamRejoinToken(
  gameCode: string,
  teamId: string,
  managerToken: string,
): Promise<TeamRejoinToken> {
  return request("GET", `/games/${gameCode}/teams/${teamId}/rejoin-token`, {
    managerToken,
  });
}

export function createGame(
  body: {
    selected_genres: string[];
    selected_decades: number[];
  },
  opts: { testRun?: boolean } = {},
): Promise<CreateGameResponse> {
  return request("POST", "/games", { body, timeoutMs: 45000, testRun: opts.testRun });
}

export function awardBonus(
  gameCode: string,
  managerToken: string,
  body: AwardBonusRequest,
): Promise<AwardBonusResponse> {
  return request("POST", `/games/${gameCode}/bonus`, {
    managerToken,
    body,
  });
}

export function endGame(gameCode: string, managerToken: string): Promise<EndGameResponse> {
  return request("POST", `/games/${gameCode}/end`, {
    managerToken,
    body: {},
  });
}

export function kickTeam(gameCode: string, managerToken: string, teamId: string): Promise<void> {
  return request("DELETE", `/games/${gameCode}/teams/${teamId}`, {
    managerToken,
  });
}

// Admin song-catalog wrappers; gated by X-Admin-Password.

export interface ListSongsParams {
  page?: number;
  per_page?: number;
  search?: string;
  genre?: string;
}

function buildQuery(params: ListSongsParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.per_page !== undefined) search.set("per_page", String(params.per_page));
  if (params.search) search.set("search", params.search);
  if (params.genre) search.set("genre", params.genre);
  const q = search.toString();
  return q.length > 0 ? `?${q}` : "";
}

export function listSongs(
  params: ListSongsParams,
  adminPassword: string,
): Promise<SongListResponse> {
  return request("GET", `/admin/songs${buildQuery(params)}`, { adminPassword });
}

export function getSong(id: string, adminPassword: string): Promise<Song> {
  return request("GET", `/admin/songs/${id}`, { adminPassword });
}

export function createSong(body: SongWritePayload, adminPassword: string): Promise<Song> {
  return request("POST", "/admin/songs", { adminPassword, body });
}

export function updateSong(
  id: string,
  body: SongWritePayload,
  adminPassword: string,
): Promise<Song> {
  return request("PUT", `/admin/songs/${id}`, { adminPassword, body });
}

export function deleteSong(id: string, adminPassword: string): Promise<void> {
  return request("DELETE", `/admin/songs/${id}`, { adminPassword });
}

export function bulkImportSongs(file: File, adminPassword: string): Promise<BulkImportSummary> {
  const form = new FormData();
  form.append("file", file);
  return request("POST", "/admin/songs/bulk-import", { adminPassword, body: form });
}
