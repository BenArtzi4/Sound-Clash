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
  // PostgREST RPC returns the bare scalar — `cleanup_expired_games()`
  // returns the number of deleted rows.
  return Number(text);
}
