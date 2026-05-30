// Service-role HTTP helpers for the e2e suite. Used by expiration.spec.ts
// to backdate `active_games.expires_at` and run the cleanup function
// directly (the production cron job runs hourly, which is too slow to
// observe from a test).
//
// Both calls go straight to PostgREST with the service-role JWT; no
// supabase-js dependency.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function serviceHeaders(): HeadersInit {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL env var is required");
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY env var is required");
  }
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function setExpiresAtPast(gameCode: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/active_games?game_code=eq.${encodeURIComponent(gameCode)}`,
    {
      method: "PATCH",
      headers: { ...serviceHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ expires_at: "1970-01-01T00:00:00Z" }),
    },
  );
  if (!res.ok) {
    throw new Error(`PATCH active_games failed: ${res.status} ${await res.text()}`);
  }
}

// Ground-truth round type, read straight from the DB via service role so the
// playthrough never has to infer it from transient UI state during a round
// transition. Returns true when the game's current song belongs to a
// soundtrack genre (mirrors select_next_song's derivation).
const SOUNDTRACK_SLUGS = new Set(["soundtracks", "israeli-soundtracks"]);

interface GenreSlugRow {
  genres: { slug: string | null } | null;
}

export async function getCurrentSongId(gameCode: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/active_games?game_code=eq.${encodeURIComponent(
      gameCode,
    )}&select=current_song_id`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) throw new Error(`GET active_games failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ current_song_id: string | null }>;
  return rows[0]?.current_song_id ?? null;
}

export async function songIsSoundtrack(songId: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/songs?id=eq.${encodeURIComponent(
      songId,
    )}&select=song_genres(genres(slug))`,
    { headers: serviceHeaders() },
  );
  if (!res.ok) throw new Error(`GET songs failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ song_genres: GenreSlugRow[] | null }>;
  const slugs = (rows[0]?.song_genres ?? []).map((r) => r.genres?.slug);
  return slugs.some((s) => s != null && SOUNDTRACK_SLUGS.has(s));
}

// Count distinct songs that belong to any of the given genre slugs. Used to
// size the playthrough so it never exhausts the pool: the local real catalog
// has hundreds, the CI seed only a handful.
export async function countSongsInGenreSlugs(slugs: string[]): Promise<number> {
  const slugList = slugs.map((s) => encodeURIComponent(s)).join(",");
  const gRes = await fetch(`${SUPABASE_URL}/rest/v1/genres?slug=in.(${slugList})&select=id`, {
    headers: serviceHeaders(),
  });
  if (!gRes.ok) throw new Error(`GET genres failed: ${gRes.status} ${await gRes.text()}`);
  const genreIds = ((await gRes.json()) as Array<{ id: string }>).map((g) => g.id);
  if (genreIds.length === 0) return 0;
  const idList = genreIds.map((id) => encodeURIComponent(id)).join(",");
  const sgRes = await fetch(
    `${SUPABASE_URL}/rest/v1/song_genres?genre_id=in.(${idList})&select=song_id&limit=10000`,
    { headers: serviceHeaders() },
  );
  if (!sgRes.ok) throw new Error(`GET song_genres failed: ${sgRes.status} ${await sgRes.text()}`);
  const rows = (await sgRes.json()) as Array<{ song_id: string }>;
  return new Set(rows.map((r) => r.song_id)).size;
}

export async function cleanupExpiredGames(): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cleanup_expired_games`, {
    method: "POST",
    headers: serviceHeaders(),
    body: "{}",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`rpc/cleanup_expired_games failed: ${res.status} ${text}`);
  }
  // PostgREST RPC returns the bare scalar; `cleanup_expired_games()`
  // returns the number of deleted rows.
  return Number(text);
}
