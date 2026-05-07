// Thin fetch wrapper for the admin-gated REST endpoints. Mirrors the shapes
// in backend/app/models/games.py without importing from the frontend
// package (tests/e2e/ is its own npm root).

const API_URL = process.env.API_URL ?? "http://localhost:8000";

function adminPassword(): string {
  const v = process.env.ADMIN_PASSWORD;
  if (!v) throw new Error("ADMIN_PASSWORD env var is required for the e2e admin client");
  return v;
}

export interface Genre {
  id: string;
  slug: string;
  name: string;
}

interface CreateGameResponse {
  game_code: string;
  status: string;
  total_rounds: number;
  selected_genres: string[];
  started_at: string;
  expires_at: string;
}

export interface SongPayload {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  start_time: number;
  is_soundtrack: boolean;
  source: string | null;
}

export interface SongCreate {
  title: string;
  artist: string;
  youtube_id: string;
  start_time?: number;
  is_soundtrack?: boolean;
  source?: string | null;
  genre_ids: string[];
}

export interface SongList {
  items: SongPayload[];
  page: number;
  per_page: number;
  total: number;
}

export interface BulkImportSummary {
  inserted: number;
  updated: number;
  total: number;
}

interface AdminResponse {
  status: number;
  text: string;
}

async function adminFetch(method: string, path: string, body?: unknown): Promise<AdminResponse> {
  const headers: Record<string, string> = { "X-Admin-Password": adminPassword() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}

async function adminJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await adminFetch(method, path, body);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${method} ${path} failed: ${r.status} ${r.text}`);
  }
  return JSON.parse(r.text) as T;
}

async function adminPost<T>(path: string, body: unknown): Promise<T> {
  return adminJson<T>("POST", path, body);
}

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

export async function listGenres(): Promise<Genre[]> {
  return publicGet<Genre[]>("/genres");
}

export async function createGame(opts: {
  totalRounds: number;
  genreSlugs: string[];
}): Promise<CreateGameResponse> {
  const all = await listGenres();
  const wanted = opts.genreSlugs.map((slug) => {
    const match = all.find((g) => g.slug === slug);
    if (!match) throw new Error(`unknown genre slug: ${slug}`);
    return match.id;
  });
  return adminPost<CreateGameResponse>("/games", {
    total_rounds: opts.totalRounds,
    selected_genres: wanted,
  });
}

export async function createSong(body: SongCreate): Promise<SongPayload> {
  return adminJson<SongPayload>("POST", "/admin/songs", body);
}

export async function getSong(id: string): Promise<SongPayload> {
  return adminJson<SongPayload>("GET", `/admin/songs/${id}`);
}

export async function updateSong(id: string, body: SongCreate): Promise<SongPayload> {
  return adminJson<SongPayload>("PUT", `/admin/songs/${id}`, body);
}

export async function deleteSong(id: string): Promise<void> {
  const r = await adminFetch("DELETE", `/admin/songs/${id}`);
  if (r.status !== 204) {
    throw new Error(`DELETE /admin/songs/${id} failed: ${r.status} ${r.text}`);
  }
}

export async function getSongStatus(id: string): Promise<number> {
  const r = await adminFetch("GET", `/admin/songs/${id}`);
  return r.status;
}

export async function listSongs(opts: {
  search?: string;
  genre?: string;
  page?: number;
  per_page?: number;
} = {}): Promise<SongList> {
  const params = new URLSearchParams();
  if (opts.search) params.set("search", opts.search);
  if (opts.genre) params.set("genre", opts.genre);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.per_page) params.set("per_page", String(opts.per_page));
  const qs = params.toString();
  return adminJson<SongList>("GET", `/admin/songs${qs ? `?${qs}` : ""}`);
}

export async function bulkImportSongs(csvText: string): Promise<BulkImportSummary> {
  const fd = new FormData();
  fd.append("file", new Blob([csvText], { type: "text/csv" }), "songs.csv");
  // Don't set Content-Type; fetch sets the multipart boundary itself.
  const res = await fetch(`${API_URL}/admin/songs/bulk-import`, {
    method: "POST",
    headers: { "X-Admin-Password": adminPassword() },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /admin/songs/bulk-import failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as BulkImportSummary;
}
