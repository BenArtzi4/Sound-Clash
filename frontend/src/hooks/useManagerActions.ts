// Manager hot-path actions: award_attempt + release_buzz_lock called direct
// from the browser via Supabase PostgREST RPC, the same way useBuzzer calls
// buzz_in. Migration 021 moved the manager-token check into the PL/pgSQL
// functions so the FastAPI hop on these two actions is no longer needed.
// Latency goes from ~400-600ms (browser -> Render US-West -> Supabase
// Frankfurt -> back) to ~150ms (browser -> Supabase direct).

import { supabase } from "../lib/supabase";
import type { AttemptResponse } from "../lib/types";

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

// PostgREST surfaces RpcError as { code, message, details, hint }; the
// PL/pgSQL `RAISE EXCEPTION '<code>' USING ERRCODE = '<sqlstate>'` lands as
// `message = '<code>'` (e.g. 'manager_token_required', 'no_buzz_to_score').
// We surface that string so callers can branch / toast on it.
export class RpcError extends Error {
  readonly sqlstate: string | undefined;
  constructor(message: string, sqlstate?: string) {
    super(message);
    this.name = "RpcError";
    this.sqlstate = sqlstate;
  }
}

export async function awardAttemptDirect(
  gameCode: string,
  managerToken: string,
  roundId: string,
  flags: AttemptFlags,
): Promise<AttemptResponse> {
  const { data, error } = await supabase.rpc("award_attempt", {
    p_game_code: gameCode,
    p_round_id: roundId,
    p_title: flags.title_correct ? TITLE_POINTS : 0,
    p_artist: flags.artist_correct ? ARTIST_POINTS : 0,
    p_wrong_buzz: flags.wrong_buzz ? WRONG_BUZZ_PENALTY : 0,
    p_manager_token: managerToken,
  });
  if (error) {
    throw new RpcError(error.message, error.code);
  }
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

export async function releaseBuzzLockDirect(gameCode: string, managerToken: string): Promise<void> {
  const { error } = await supabase.rpc("release_buzz_lock", {
    p_game_code: gameCode,
    p_manager_token: managerToken,
  });
  if (error) {
    throw new RpcError(error.message, error.code);
  }
}
