// Manager "peek next song" probe: peek_next_song called direct from the browser
// via Supabase PostgREST RPC, same pattern as useSelectNextSong. Migration 029
// added a read-only twin of select_next_song's random picker that returns a
// candidate unplayed song WITHOUT advancing the round, so the manager console
// can PREBUFFER the next YouTube video into a hidden second player during the
// current round.
//
// Why: production Faro traces show ~89% of "click Next round -> audio playing"
// latency is YouTube's own load->playing buffering (game.song_start
// .load_to_playing, ~1191ms). Because select_next_song picks randomly at click
// time there's nothing to preload in advance; peeking first tells us exactly
// which video to warm up. On the click, the console commits that exact song via
// selectNextSongDirect(..., songId) and resumes the already-buffered player.
//
// Pool exhaustion is not an error here: the RPC returns zero rows, which we map
// to null. The caller simply skips preloading; the real no_more_songs error
// still surfaces from the eventual select_next_song commit.

import { supabase } from "../lib/supabase";
import { tracedRpc } from "../lib/telemetry";
import { RpcError } from "./useManagerActions";

export interface PeekedSong {
  song_id: string;
  youtube_id: string;
  start_time: number;
}

interface PeekNextSongRow {
  song_id: string;
  youtube_id: string;
  start_time: number;
}

export async function peekNextSongDirect(
  gameCode: string,
  managerToken: string,
): Promise<PeekedSong | null> {
  const { data, error } = await tracedRpc("peek_next_song", { game_code: gameCode }, () =>
    supabase.rpc("peek_next_song", {
      p_game_code: gameCode,
      p_manager_token: managerToken,
    }),
  );
  if (error) {
    throw new RpcError(error.message, error.code);
  }
  const row = (Array.isArray(data) ? data[0] : data) as PeekNextSongRow | null | undefined;
  // Zero rows = pool exhausted (or nothing eligible). Not an error; the caller
  // treats null as "nothing to prebuffer".
  if (!row) return null;
  return {
    song_id: row.song_id,
    youtube_id: row.youtube_id,
    start_time: row.start_time,
  };
}
