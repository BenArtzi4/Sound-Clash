import { describe, expect, it } from "vitest";
import { countSongsInMix, describeMix, SMALL_MIX } from "./songPool";
import type { SongPoolCell } from "./types";

// The same rules the DB test pins against select_next_song
// (tests/db/test_song_pool_counts.py::test_count_matches_what_the_picker_serves).
const CELLS: SongPoolCell[] = [
  { decade: 1960, genre_ids: ["rock"], song_count: 1 },
  { decade: 1980, genre_ids: ["rock"], song_count: 5 },
  { decade: 1980, genre_ids: ["pop", "rock"], song_count: 2 },
  { decade: 2000, genre_ids: ["hip-hop", "pop"], song_count: 1 },
  { decade: null, genre_ids: ["pop"], song_count: 4 },
  { decade: 1950, genre_ids: ["hip-hop"], song_count: 3 },
];

const genres = (...ids: string[]) => new Set(ids);
const decades = (...ds: number[]) => new Set(ds);

describe("countSongsInMix", () => {
  it("counts every song of the genres when no decade is picked (any year)", () => {
    expect(countSongsInMix(CELLS, genres("rock"), decades())).toBe(8);
    expect(countSongsInMix(CELLS, genres("pop"), decades())).toBe(7);
  });

  it("counts a song in two picked genres once", () => {
    // rock 8 + pop's 1 + 4 that are not rock = 13, not 8 + 7 = 15.
    expect(countSongsInMix(CELLS, genres("rock", "pop"), decades())).toBe(13);
  });

  it("keeps only the picked decades, and a song with no year matches none", () => {
    expect(countSongsInMix(CELLS, genres("rock"), decades(1980))).toBe(7);
    expect(countSongsInMix(CELLS, genres("pop"), decades(1980, 2000))).toBe(3);
    // Every chip on still drops the unknown-year and pre-1960 songs.
    const everyChip = decades(1960, 1970, 1980, 1990, 2000, 2010, 2020);
    expect(countSongsInMix(CELLS, genres("pop"), everyChip)).toBe(3);
    expect(countSongsInMix(CELLS, genres("hip-hop"), everyChip)).toBe(1);
  });

  it("is 0 for a mix with no songs and for no genre", () => {
    expect(countSongsInMix(CELLS, genres("hip-hop"), decades(1980))).toBe(0);
    expect(countSongsInMix(CELLS, genres("electronic"), decades())).toBe(0);
    expect(countSongsInMix(CELLS, genres(), decades())).toBe(0);
    expect(countSongsInMix([], genres("rock"), decades())).toBe(0);
  });
});

describe("describeMix", () => {
  it("names an empty mix as a problem", () => {
    expect(describeMix(0)).toEqual({
      text: "No songs in this mix. Try more genres or years.",
      tone: "empty",
    });
  });

  it("warns below a game's worth of songs", () => {
    expect(describeMix(1)).toEqual({
      text: "Only 1 song in this mix, enough for 1 round.",
      tone: "small",
    });
    expect(describeMix(SMALL_MIX - 1).tone).toBe("small");
  });

  it("states the count, with a thousands separator", () => {
    expect(describeMix(SMALL_MIX)).toEqual({ text: "20 songs in this mix", tone: "ok" });
    expect(describeMix(1715).text).toBe("1,715 songs in this mix");
  });
});
