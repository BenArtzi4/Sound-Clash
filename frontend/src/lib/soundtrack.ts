// Soundtrack rounds are derived from genre membership (migration 028 dropped
// the songs.is_soundtrack column). A song plays as a +15 soundtrack round when
// it belongs to a genre whose slug is in SOUNDTRACK_GENRE_SLUGS. This mirrors
// the SQL in select_next_song and SOUNDTRACK_GENRE_SLUGS in
// backend/app/constants.py -- keep the three in sync.
//
// In-game pages (Display, Manager) fetch the current song directly and can no
// longer select the dropped column, so they embed the song's genre slugs
// (`song_genres(genres(slug))`) and compute the flag client-side.

export const SOUNDTRACK_GENRE_SLUGS = ["soundtracks", "israeli-soundtracks"] as const;

// Shape of a `song_genres(genres(slug))` PostgREST embed row.
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
