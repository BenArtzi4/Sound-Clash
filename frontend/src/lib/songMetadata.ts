// Resolve a round's song row with bounded backoff retry (F-P1-7). The display's
// reveal panel and the manager's post-refresh player both resolve
// `game_rounds.song_id` back to its song from an effect whose deps don't
// change again for the rest of the round — so a single transient PostgREST or
// network failure used to blank that round's title/artist (or leave the
// manager's player empty) with no second chance. Retrying inside the fetch
// keeps both call sites' effect keys intact.
//
// The browser no longer reads the song catalog tables. Both lookups go through
// game-scoped SECURITY DEFINER RPCs (migration 053): `round_song` returns one
// song only if that game played it, and `game_setlist` returns the songs of
// the game's rounds. Both fall back to the durable game archive once the
// 4-hour sweep has removed the live rows.
//
// The callers only ask for the song_id of a round row they have already seen
// (Realtime INSERT or hydrate), so that round is committed and its song is in
// the game: a definitive "no row" response is authoritative (the song was
// deleted from the catalog since) — only errors are retried.

import { deriveIsSoundtrack } from "./soundtrack";
import { supabase } from "./supabase";
import { log } from "./telemetry";
import type { Song } from "./types";

// Delay before each retry; ~7.5s across 5 total attempts — long enough to ride
// out a connection blip, comfortably shorter than a round.
export const SONG_FETCH_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A row of `round_song` / `game_setlist` (migration 053). `genre_slugs` is the
// song's genre slugs, sorted; is_soundtrack is derived from them (migration 028
// dropped the column).
interface CatalogRow {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
  start_time: number;
  release_year: number | null;
  genre_slugs: string[] | null;
}

function isSoundtrackRow(row: CatalogRow): boolean {
  return deriveIsSoundtrack((row.genre_slugs ?? []).map((slug) => ({ genres: { slug } })));
}

export async function fetchSongById(
  gameCode: string,
  songId: string,
  isCancelled: () => boolean = () => false,
): Promise<Song | null> {
  for (let attempt = 0; ; attempt++) {
    let failure: string;
    try {
      const { data, error } = await supabase.rpc("round_song", {
        p_game_code: gameCode,
        p_song_id: songId,
      });
      if (isCancelled()) return null;
      if (!error) {
        // A RETURNS TABLE function comes back as an array: zero or one row.
        const row = (data as CatalogRow[] | null)?.[0];
        if (!row) return null;
        return {
          id: row.id,
          title: row.title,
          artist: row.artist,
          youtube_id: row.youtube_id,
          start_time: row.start_time,
          release_year: row.release_year,
          is_soundtrack: isSoundtrackRow(row),
        };
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

// Map of song id -> catalog row for the requested ids, or null once every
// attempt failed. One `game_setlist` call returns every song the game played;
// an id with no row (a song deleted from the catalog since) is simply absent.
export async function fetchSongsByIds(
  gameCode: string,
  ids: readonly string[],
  isCancelled: () => boolean = () => false,
): Promise<Map<string, CatalogSong> | null> {
  const wanted = new Set(ids);
  for (let attempt = 0; ; attempt++) {
    let failure: string;
    try {
      const { data, error } = await supabase.rpc("game_setlist", { p_game_code: gameCode });
      if (isCancelled()) return null;
      if (!error && data) {
        const songs = new Map<string, CatalogSong>();
        for (const row of data as CatalogRow[]) {
          if (!wanted.has(row.id) || songs.has(row.id)) continue;
          songs.set(row.id, {
            id: row.id,
            title: row.title,
            artist: row.artist,
            youtube_id: row.youtube_id,
            release_year: row.release_year,
            is_soundtrack: isSoundtrackRow(row),
          });
        }
        return songs;
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
