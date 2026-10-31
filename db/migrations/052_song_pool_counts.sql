-- 052_song_pool_counts.sql
-- Song counts for the create-game page (issue #375).
--
-- The create page lets a host pick genres and decades, and nothing told them
-- how many songs that mix holds. Six genre + decade pairs hold no song at all
-- (Hip-Hop + 60s / 80s, Electronic + 60s, Israeli Rap/Hip-Hop + 60s / 70s /
-- 80s on the 2026-10 catalog): the game was created, and its first Start
-- failed with no_more_songs ("all songs have been played"). The page now shows
-- "N songs in this mix" as the host picks, and blocks Create at 0.
--
-- song_pool_counts() returns the playable catalog grouped by decade and genre
-- set: one row per (decade, the sorted ids of every genre the song is in),
-- with how many songs share it. Every song lands in exactly one row, so the
-- page counts any mix exactly, without a round trip per tap:
--
--   songs in (genres G, decades D) = sum of song_count over the rows where
--     D is empty or decade is in D, and genre_ids shares an id with G.
--
-- That is pick_next_song's `eligible` set (mig 049) for a game with nothing
-- played yet: the song is in a selected genre, passes the decade filter
-- (release_year / 10 * 10 in the selected decades, mig 032; a NULL year
-- matches no decade) and the dead-video skip (unavailable_at IS NULL, mig 045).
-- A song in two selected genres counts once, as the picker serves it once.
-- Soundtrack rounds (mig 028) are a property of a genre, not a filter, so they
-- need nothing here. If pick_next_song's eligibility ever changes, change this
-- function with it.
--
-- On the 2026-10-31 catalog: 102 rows (about 8 KB), 1715 songs. Checked
-- read-only on prod against the picker's predicate for every genre x decade
-- pair: 102 selections, 0 mismatches.
--
-- Read-only and anon-callable. SECURITY INVOKER: anon already reads songs,
-- song_genres and genres in full (mig 006 policies), so the function needs no
-- privilege of its own and exposes nothing new (no titles, no ids of songs).
-- Hosted Supabase auto-grants EXECUTE on new functions to anon/authenticated;
-- the grants below make that explicit, as migration 029 did for peek_next_song.
--
-- Idempotent: CREATE OR REPLACE (new function, no prior signature) plus
-- re-runnable REVOKE/GRANT.

CREATE OR REPLACE FUNCTION song_pool_counts()
RETURNS TABLE(
  decade     integer,  -- release_year / 10 * 10; NULL when the year is unknown
  genre_ids  uuid[],   -- every genre the songs are in, sorted
  song_count integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT per_song.decade, per_song.genre_ids, count(*)::integer
    FROM (
      SELECT (s.release_year / 10 * 10)::integer AS decade,
             array_agg(sg.genre_id ORDER BY sg.genre_id) AS genre_ids
        FROM songs s
        JOIN song_genres sg ON sg.song_id = s.id
       WHERE s.unavailable_at IS NULL  -- dead-video auto-skip, as pick_next_song (mig 045)
       GROUP BY s.id
    ) per_song
   GROUP BY per_song.decade, per_song.genre_ids
   ORDER BY per_song.decade NULLS LAST, per_song.genre_ids;
$$;

REVOKE EXECUTE ON FUNCTION song_pool_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION song_pool_counts() TO anon, authenticated, service_role;
