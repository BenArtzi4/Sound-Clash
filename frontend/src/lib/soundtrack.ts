// Soundtrack rounds are derived from genre membership (migration 028 dropped
// the songs.is_soundtrack column). A song plays as a +15 soundtrack round when
// it belongs to a genre whose slug is in SOUNDTRACK_GENRE_SLUGS. This mirrors
// the SQL in select_next_song and SOUNDTRACK_GENRE_SLUGS in
// backend/app/constants.py -- keep the three in sync.
//
// In-game pages (Display, Manager) and the end-of-game setlist get their songs
// from the game-scoped round_song / game_setlist RPCs (migration 053), which
// return each song's genre slugs; lib/songMetadata.ts computes the flag from
// them here.

export const SOUNDTRACK_GENRE_SLUGS = ["soundtracks", "israeli-soundtracks"] as const;

// One genre of a song, in the shape of a `song_genres(genres(slug))` PostgREST
// embed row (lib/songMetadata.ts maps the RPCs' slug arrays into it).
export interface SongGenreSlugEmbed {
  genres: { slug: string | null } | null;
}

export function deriveIsSoundtrack(
  songGenres: ReadonlyArray<SongGenreSlugEmbed | null> | null | undefined,
): boolean {
  const soundtrackSlugs: ReadonlySet<string> = new Set(SOUNDTRACK_GENRE_SLUGS);
  return (songGenres ?? []).some((sg) => {
    const slug = sg?.genres?.slug;
    return slug != null && soundtrackSlugs.has(slug);
  });
}
