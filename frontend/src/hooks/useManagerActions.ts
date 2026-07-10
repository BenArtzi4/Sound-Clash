// Manager hot-path actions: award_attempt + release_buzz_lock called direct
// from the browser via Supabase PostgREST RPC, the same way useBuzzer calls
// buzz_in. Migration 021 moved the manager-token check into the PL/pgSQL
// functions so the FastAPI hop on these two actions is no longer needed.
// Latency goes from ~400-600ms (browser -> Render US-West -> Supabase
// Frankfurt -> back) to ~150ms (browser -> Supabase direct).

import { supabase } from "../lib/supabase";
import { tracedRpc } from "../lib/telemetry";
import { RpcError, throwOnRpcError } from "../lib/rpcError";
import type { AttemptResponse } from "../lib/types";

// Re-exported so existing importers (`import { RpcError } from
// "./useManagerActions"`) keep resolving to the same class; the definition and
// the shared throwOnRpcError helper now live in lib/rpcError.
export { RpcError };

const TITLE_POINTS = 10;
const ARTIST_POINTS = 5;
const WRONG_BUZZ_PENALTY = 3;

export interface AttemptFlags {
  title_correct: boolean;
  artist_correct: boolean;
  wrong_buzz: boolean;
}

interface AwardAttemptRow {
  team_id: string | null;
  points_delta: number;
  team_total_score: number;
  title_claimed_by: string | null;
  artist_claimed_by: string | null;
}

export async function awardAttemptDirect(
  gameCode: string,
  managerToken: string,
  roundId: string,
  flags: AttemptFlags,
): Promise<AttemptResponse> {
  const { data, error } = await tracedRpc("award_attempt", { game_code: gameCode }, () =>
    supabase.rpc("award_attempt", {
      p_game_code: gameCode,
      p_round_id: roundId,
      p_title: flags.title_correct ? TITLE_POINTS : 0,
      p_artist: flags.artist_correct ? ARTIST_POINTS : 0,
      p_wrong_buzz: flags.wrong_buzz ? WRONG_BUZZ_PENALTY : 0,
      p_manager_token: managerToken,
    }),
  );
  throwOnRpcError(error);
  // RETURNS TABLE comes back as an array; we read the single row.
  const row = (Array.isArray(data) ? data[0] : data) as AwardAttemptRow | null;
  if (!row) {
    throw new RpcError("award_attempt returned no row");
  }
  return {
    round_id: roundId,
    team_id: row.team_id,
    points_awarded: row.points_delta,
    team_total_score: row.team_total_score,
    title_claimed_by: row.title_claimed_by,
    artist_claimed_by: row.artist_claimed_by,
  };
}

// The expiry banner's "Keep playing +1h" (T4.8 / migration 039). Not a hot
// path, but it's a PL/pgSQL function like the rest of the manager actions, so
// it rides the same direct browser -> Supabase RPC route. Returns the new
// expires_at; the Realtime UPDATE on active_games is what actually moves the
// countdown for every client.
export async function extendGameDirect(gameCode: string, managerToken: string): Promise<string> {
  const { data, error } = await tracedRpc("extend_game", { game_code: gameCode }, () =>
    supabase.rpc("extend_game", {
      p_game_code: gameCode,
      p_manager_token: managerToken,
    }),
  );
  throwOnRpcError(error);
  // RETURNS timestamptz comes back as a bare JSON string.
  if (typeof data !== "string") {
    throw new RpcError("extend_game returned no timestamp");
  }
  return data;
}

export async function releaseBuzzLockDirect(gameCode: string, managerToken: string): Promise<void> {
  const { error } = await tracedRpc("release_buzz_lock", { game_code: gameCode }, () =>
    supabase.rpc("release_buzz_lock", {
      p_game_code: gameCode,
      p_manager_token: managerToken,
    }),
  );
  throwOnRpcError(error);
}
