// Resolve a round's song row with bounded backoff retry (F-P1-7). The display's
// reveal panel and the manager's post-refresh player both resolve
// `game_rounds.song_id` back to a `songs` row from an effect whose deps don't
// change again for the rest of the round — so a single transient PostgREST or
// network failure used to blank that round's title/artist (or leave the
// manager's player empty) with no second chance. Retrying inside the fetch
// keeps both call sites' effect keys intact.
//
// The catalog is durable and `song_id` is a foreign key, so a definitive
// "no row" response is authoritative — only errors are retried.

import { deriveIsSoundtrack, type SongGenreSlugEmbed } from "./soundtrack";
import { supabase } from "./supabase";
import { log } from "./telemetry";
import type { Song } from "./types";

// Delay before each retry; ~7.5s across 5 total attempts — long enough to ride
// out a connection blip, comfortably shorter than a round.
export const SONG_FETCH_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchSongById(
  songId: string,
  isCancelled: () => boolean = () => false,
): Promise<Song | null> {
  for (let attempt = 0; ; attempt++) {
    let failure: string;
    try {
      const { data, error } = await supabase
        .from("songs")
        .select("id,title,artist,youtube_id,start_time,song_genres(genres(slug))")
        .eq("id", songId)
        .maybeSingle();
      if (isCancelled()) return null;
      if (!error) {
        if (!data) return null;
        // is_soundtrack is derived from genre membership (migration 028 dropped
        // the column), so compute it from the embedded genre slugs.
        const { song_genres, ...base } = data as unknown as Omit<
          Song,
          "is_soundtrack" | "genres"
        > & {
          song_genres: SongGenreSlugEmbed[] | null;
        };
        return { ...base, is_soundtrack: deriveIsSoundtrack(song_genres) };
      }
      failure = error.message;
    } catch (err) {
      if (isCancelled()) return null;
      failure = err instanceof Error ? err.message : String(err);
    }
    const delayMs = SONG_FETCH_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) {
      log("error", "song_fetch_failed", { song_id: songId, message: failure });
      return null;
    }
    log("warn", "song_fetch_retry", {
      song_id: songId,
      attempt: String(attempt + 1),
      message: failure,
    });
    await sleep(delayMs);
    if (isCancelled()) return null;
  }
}
