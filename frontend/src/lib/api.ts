import { env } from "./env";
import type {
  ApiErrorBody,
  AttemptRequest,
  AttemptResponse,
  AwardBonusRequest,
  AwardBonusResponse,
  BulkImportSummary,
  CreateGameResponse,
  EndGameResponse,
  EndRoundResponse,
  Genre,
  SelectSongResponse,
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

  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    method,
    headers,
    body,
  });

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

export function listGenres(): Promise<Genre[]> {
  return request("GET", "/genres");
}

export function joinTeam(gameCode: string, name: string): Promise<Team> {
  return request("POST", `/games/${gameCode}/teams`, { body: { name } });
}

export function createGame(body: { selected_genres: string[] }): Promise<CreateGameResponse> {
  return request("POST", "/games", { body });
}

export function selectSong(
  gameCode: string,
  managerToken: string,
  songId?: string,
): Promise<SelectSongResponse> {
  return request("POST", `/games/${gameCode}/select-song`, {
    managerToken,
    body: songId ? { song_id: songId } : {},
  });
}

export function awardAttempt(
  gameCode: string,
  managerToken: string,
  body: AttemptRequest,
): Promise<AttemptResponse> {
  return request("POST", `/games/${gameCode}/attempt`, {
    managerToken,
    body,
  });
}

export function endRound(
  gameCode: string,
  managerToken: string,
  roundId: string,
): Promise<EndRoundResponse> {
  return request("POST", `/games/${gameCode}/end-round`, {
    managerToken,
    body: { round_id: roundId },
  });
}

export function continueRound(gameCode: string, managerToken: string): Promise<void> {
  return request("POST", `/games/${gameCode}/continue`, {
    managerToken,
    body: {},
  });
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
