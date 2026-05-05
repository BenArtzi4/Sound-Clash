import { env } from "./env";
import type {
  ApiErrorBody,
  AwardPointsRequest,
  AwardPointsResponse,
  CreateGameResponse,
  EndGameResponse,
  Genre,
  SelectSongResponse,
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
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.managerToken) {
    headers["X-Manager-Token"] = opts.managerToken;
  }
  if (opts.adminPassword) {
    headers["X-Admin-Password"] = opts.adminPassword;
  }

  const response = await fetch(`${env.VITE_API_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

export function createGame(body: {
  total_rounds: number;
  selected_genres: string[];
}): Promise<CreateGameResponse> {
  return request("POST", "/games", { body });
}

export function selectSong(gameCode: string, managerToken: string): Promise<SelectSongResponse> {
  return request("POST", `/games/${gameCode}/select-song`, {
    managerToken,
    body: {},
  });
}

export function awardPoints(
  gameCode: string,
  managerToken: string,
  body: AwardPointsRequest,
): Promise<AwardPointsResponse> {
  return request("POST", `/games/${gameCode}/award-points`, {
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
