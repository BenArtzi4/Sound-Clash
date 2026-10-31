// Manager "peek next song" probe: peek_next_song called direct from the browser
// via Supabase PostgREST RPC, same pattern as useSelectNextSong. Migration 029
// added a read-only twin of select_next_song's random picker that returns a
// candidate unplayed song WITHOUT advancing the round, so the manager console
// knows the next song during the current round.
//
// Why: mobile browsers only allow unmuted playback that starts inside the tap,
// and a load issued after `await select_next_song` is blocked autoplay on iOS.
// Knowing the song first lets the Next-round tap load it on the visible player
// synchronously, with no RPC in front of the load, then commit that exact song
// via selectNextSongDirect(..., songId). (Until 2026-10-31 it also fed a hidden
// second player that prebuffered the song; YouTube's embed rules forbid that,
// see useHostPlayer.ts.)
//
// Pool exhaustion is not an error here: the RPC returns zero rows, which we map
// to null. The caller then falls back to a random pick at the click; the real
// no_more_songs error still surfaces from that select_next_song commit.

import { supabase } from "../lib/supabase";
import { tracedRpc } from "../lib/telemetry";
import { throwOnRpcError } from "../lib/rpcError";

export interface PeekedSong {
  song_id: string;
  youtube_id: string;
  start_time: number;
  // Metadata (migration 038) so the Next-round fast path can render the new
  // song's card in-gesture (I-NextMeta) instead of showing the previous title
  // until select_next_song resolves.
  title: string;
  artist: string;
  is_soundtrack: boolean;
  // Migration 050: shown to the host next to the title, for a year bonus.
  release_year: number | null;
}

interface PeekNextSongRow {
  song_id: string;
  youtube_id: string;
  start_time: number;
  song_title: string;
  song_artist: string;
  is_soundtrack: boolean;
  // Optional: absent until migration 050 is applied.
  release_year?: number | null;
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
  throwOnRpcError(error);
  const row = (Array.isArray(data) ? data[0] : data) as PeekNextSongRow | null | undefined;
  // Zero rows = pool exhausted (or nothing eligible). Not an error; the caller
  // treats null as "no song known in advance".
  if (!row) return null;
  return {
    song_id: row.song_id,
    youtube_id: row.youtube_id,
    start_time: row.start_time,
    title: row.song_title,
    artist: row.song_artist,
    is_soundtrack: row.is_soundtrack,
    release_year: row.release_year ?? null,
  };
}
