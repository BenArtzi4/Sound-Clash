// Manager "Next round" / "Start game" action: select_next_song called direct
// from the browser via Supabase PostgREST RPC, same pattern as useBuzzer and
// useManagerActions. Migration 022 moved the song picker + start_round
// composition (plus the manager-token check) into one PL/pgSQL function so
// the FastAPI hop is no longer needed for the most-pressed manager button.
//
// Latency before: ~500-900ms warm (two chained Render -> Frankfurt round-
// trips), 2-30s spike on a cold Render dyno.
// Latency after:  ~150ms (one direct browser -> Supabase RPC). Combined with
// the optimistic "Loading next round..." toast from PR #88 the perceived
// click-to-feedback gap is ~10ms.

import { supabase } from "../lib/supabase";
import { tracedRpc } from "../lib/telemetry";
import { RpcError } from "./useManagerActions";
import type { SelectSongResponse } from "../lib/types";

interface SelectNextSongRow {
  round_id: string;
  round_number: number;
  song_id: string;
  song_title: string;
  song_artist: string;
  youtube_id: string;
  start_time: number;
  is_soundtrack: boolean;
}

export async function selectNextSongDirect(
  gameCode: string,
  managerToken: string,
  songId?: string,
): Promise<SelectSongResponse> {
  const { data, error } = await tracedRpc("select_next_song", { game_code: gameCode }, () =>
    supabase.rpc("select_next_song", {
      p_game_code: gameCode,
      p_manager_token: managerToken,
      // null vs undefined matters: PostgREST drops undefined-valued keys, which
      // would route the call to a 2-arg overload that doesn't exist. Always
      // send p_song_id explicitly so we hit the 3-arg signature.
      p_song_id: songId ?? null,
    }),
  );
  if (error) {
    throw new RpcError(error.message, error.code);
  }
  const row = (Array.isArray(data) ? data[0] : data) as SelectNextSongRow | null;
  if (!row) {
    throw new RpcError("select_next_song returned no row");
  }
  return {
    round_id: row.round_id,
    round_number: row.round_number,
    song: {
      id: row.song_id,
      title: row.song_title,
      artist: row.song_artist,
      youtube_id: row.youtube_id,
      start_time: row.start_time,
      is_soundtrack: row.is_soundtrack,
    },
  };
}
