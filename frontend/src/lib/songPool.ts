// How many songs a genre + decade mix holds, for the create page (issue #375).
//
// The cells come from song_pool_counts() (migration 052): every playable song
// sits in exactly one cell, keyed by its decade and the full set of genres it
// is in. A song is in the mix when its decade is one of the picked decades (any
// decade, when none is picked) and it shares a genre with the picked genres.
// That is the picker's own rule (pick_next_song, migrations 032/045/049): a
// song with an unknown year matches no decade, and a song in two picked genres
// counts once. Dead videos are already left out of the cells.

import type { SongPoolCell } from "./types";

// A game usually runs 20 to 30 rounds; below this a host hears a heads-up.
export const SMALL_MIX = 20;

export function countSongsInMix(
  cells: readonly SongPoolCell[],
  genres: ReadonlySet<string>,
  decades: ReadonlySet<number>,
): number {
  let total = 0;
  for (const cell of cells) {
    if (decades.size > 0 && (cell.decade === null || !decades.has(cell.decade))) continue;
    if (!cell.genre_ids.some((id) => genres.has(id))) continue;
    total += cell.song_count;
  }
  return total;
}

export type MixTone = "empty" | "small" | "ok";

/** The line under the mix: "312 songs in this mix", or why it can't start. */
export function describeMix(count: number): { text: string; tone: MixTone } {
  if (count === 0) {
    // Short enough for one line in the phone's sticky bar (360 px wide).
    return { text: "No songs in this mix. Try more genres or years.", tone: "empty" };
  }
  const songs = `${count.toLocaleString("en-US")} ${count === 1 ? "song" : "songs"}`;
  if (count < SMALL_MIX) {
    const rounds = count === 1 ? "1 round" : `${count} rounds`;
    return { text: `Only ${songs} in this mix, enough for ${rounds}.`, tone: "small" };
  }
  return { text: `${songs} in this mix`, tone: "ok" };
}
