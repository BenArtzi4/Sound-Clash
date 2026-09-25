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

// The end-of-game setlist resolves every played song in one batch read. A
// shorter retry than a round-time lookup: the setlist is not time-critical, and
// after this it shows an explicit Retry instead of spinning.
export const SETLIST_FETCH_RETRY_DELAYS_MS: readonly number[] = [300, 900];

export interface CatalogSong {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  release_year: number | null;
  is_soundtrack: boolean;
}

// Map of song id -> catalog row, or null once every attempt failed. An id with
// no row (a song deleted from the catalog since) is simply absent.
export async function fetchSongsByIds(
  ids: readonly string[],
  isCancelled: () => boolean = () => false,
): Promise<Map<string, CatalogSong> | null> {
  for (let attempt = 0; ; attempt++) {
    let failure: string;
    try {
      const { data, error } = await supabase
        .from("songs")
        .select("id,title,artist,youtube_id,release_year,song_genres(genres(slug))")
        .in("id", ids as string[]);
      if (isCancelled()) return null;
      if (!error && data) {
        const rows = data as unknown as (Omit<CatalogSong, "is_soundtrack"> & {
          song_genres: SongGenreSlugEmbed[] | null;
        })[];
        return new Map(
          rows.map(({ song_genres, ...base }) => [
            base.id,
            { ...base, is_soundtrack: deriveIsSoundtrack(song_genres) },
          ]),
        );
      }
      failure = error?.message ?? "no data";
    } catch (err) {
      if (isCancelled()) return null;
      failure = err instanceof Error ? err.message : String(err);
    }
    const delayMs = SETLIST_FETCH_RETRY_DELAYS_MS[attempt];
    if (delayMs === undefined) {
      log("error", "setlist_fetch_failed", { count: String(ids.length), message: failure });
      return null;
    }
    await sleep(delayMs);
    if (isCancelled()) return null;
  }
}
