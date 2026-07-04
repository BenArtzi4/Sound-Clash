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
  SongWritePayload,
  Team,
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
    });
  // Trace every REST call except the frequent /health warm-up pings (they'd
  // drown out the meaningful create/join/bonus/end latencies). The route is
  // id-normalized so per-game codes don't explode span cardinality.
  const response =
    path === "/health"
      ? await doFetch()
      : await tracedFetch(method, normalizeRoute(method, path), doFetch);

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

// Test-only: reset the genre memoization so each test gets a clean cache.
export function __resetListGenresCacheForTests(): void {
  cachedGenres = null;
  inflightGenres = null;
}

export function joinTeam(gameCode: string, name: string): Promise<Team> {
  return request("POST", `/games/${gameCode}/teams`, { body: { name } });
}

export function createGame(body: {
  selected_genres: string[];
  selected_decades: number[];
}): Promise<CreateGameResponse> {
  return request("POST", "/games", { body });
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
