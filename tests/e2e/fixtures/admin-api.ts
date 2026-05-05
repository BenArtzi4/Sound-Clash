// Thin fetch wrapper for the admin-gated REST endpoints. Mirrors the shapes
// in backend/app/models/games.py without importing from the frontend
// package (tests/e2e/ is its own npm root).

const API_URL = process.env.API_URL ?? "http://localhost:8000";

function adminPassword(): string {
  const v = process.env.ADMIN_PASSWORD;
  if (!v) throw new Error("ADMIN_PASSWORD env var is required for the e2e admin client");
  return v;
}

interface Genre {
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

async function adminPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": adminPassword(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as T;
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
