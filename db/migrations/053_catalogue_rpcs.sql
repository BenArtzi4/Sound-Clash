-- 053_catalogue_rpcs.sql
-- Game-scoped song metadata for the browser, so the song catalog no longer has
-- to be anon-readable.
--
-- Why: the anon key ships in the site's JS, and RLS `anon_read_songs` /
-- `anon_read_song_genres` (mig 006, USING (true)) let anyone holding it read
-- the whole catalog (title, artist, youtube_id, start_time, release_year,
-- genres) in one request. The browser only ever needs the songs of the game
-- it is in:
--   * the host's score panel (after a refresh) and the TV's reveal resolve the
--     current round's song_id to its row;
--   * the end-of-game setlist (host console and team phones) resolves every
--     played song_id.
-- This migration gives the browser two SECURITY DEFINER functions that return
-- exactly that and nothing more. It is the EXPAND step only: it drops no
-- policy and revokes no grant. A later migration (054) removes anon's SELECT
-- on songs / song_genres once no browser still reads them directly.
--
-- game_setlist(p_game_code) -> one row per played round, in round order:
--   round_number, id, title, artist, youtube_id, start_time, release_year,
--   genre_slugs (the song's genre slugs, sorted; the frontend derives
--   is_soundtrack from them, as lib/soundtrack.ts did from the old embed).
-- Which game a code means:
--   * the live game, when active_games still has the code (end_game keeps the
--     rows until the sweep, so an ended game is still "live" here);
--   * otherwise the most recent game_history archive with that code (mig 033;
--     codes are recycled after the 4h TTL, so a code can have several), so a
--     host or phone tab left open past the cleanup_expired_games sweep still
--     gets its setlist. The archive only says WHICH songs played; the row
--     itself comes from the durable catalog, like the live path, so it carries
--     release_year and genres (the archive has neither).
-- A round whose song was deleted from the catalog since (song_id SET NULL by
-- the FK) has no row, which is how the setlist already treated it.
--
-- round_song(p_game_code, p_song_id) -> the same columns minus round_number,
-- for one song, and only when that game played it. It is game_setlist
-- filtered to one id, so a round's song is returned for its own game
-- whenever the setlist would list it. The browser asks only for the song_id of
-- a round row it has already seen (Realtime INSERT or hydrate read), so that
-- round is committed and the song is always found: the frontend treats "no
-- row" as final, without a retry.
--
-- Inputs: a NULL, unknown or wrong game code, or a song that game did not play,
-- returns zero rows. Neither function raises for "not found", writes anything,
-- or needs a token: knowing the game code is the auth, as for buzz_in and the
-- anon-readable live tables.
--
-- song_pool_counts() (mig 052) was SECURITY INVOKER and read songs /
-- song_genres with anon's own privileges. Recreated here as SECURITY DEFINER
-- (owner's privileges, search_path pinned), so the create page's song count
-- keeps working once 054 revokes those reads. Body, output and grants are
-- identical to 052; it still returns counts only, never a song id or title.
--
-- Grants follow migration 052: REVOKE EXECUTE FROM PUBLIC, then GRANT it to
-- anon, authenticated and service_role. Hosted Supabase auto-grants EXECUTE on
-- new public functions; the explicit grants make it the same on every stack.
--
-- Idempotent: the two new functions are dropped (IF EXISTS) and recreated, as
-- migration 039 does, so a later migration that changes their return shape
-- can't make a re-run of this file fail with 42P13; song_pool_counts keeps its
-- signature, so CREATE OR REPLACE. Grants are re-runnable. One transaction, so
-- a caller sees the old state or the new one, never a missing function.
--
-- Spec: docs/rpc-functions.md §3g-§3h, docs/security-rls.md §2,
-- docs/api-contracts.md §3.3-§3.4.

BEGIN;

-- ---------------------------------------------------------------------------
-- game_setlist
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS round_song(text, uuid);
DROP FUNCTION IF EXISTS game_setlist(text);

CREATE FUNCTION game_setlist(p_game_code text)
RETURNS TABLE(
  round_number integer,
  id           uuid,
  title        text,
  artist       text,
  youtube_id   text,
  start_time   integer,
  release_year integer,
  genre_slugs  text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH played AS (
    -- The live game (ended or not) while its rows exist.
    SELECT gr.round_number, gr.song_id
      FROM game_rounds gr
     WHERE gr.game_code = p_game_code
    UNION ALL
    -- Swept: the most recent archived game with this code. Skipped whenever
    -- the code is live, so a recycled code never mixes two games.
    SELECT ghs.round_number, ghs.song_id
      FROM game_history_songs ghs
     WHERE NOT EXISTS (SELECT 1 FROM active_games ag WHERE ag.game_code = p_game_code)
       AND ghs.game_history_id = (
             SELECT gh.id
               FROM game_history gh
              WHERE gh.game_code = p_game_code
              ORDER BY gh.started_at DESC
              LIMIT 1
           )
  )
  SELECT p.round_number,
         s.id,
         s.title,
         s.artist,
         s.youtube_id::text,
         s.start_time,
         s.release_year,
         ARRAY(
           SELECT g.slug
             FROM song_genres sg
             JOIN genres g ON g.id = sg.genre_id
            WHERE sg.song_id = s.id
            ORDER BY g.slug
         )
    FROM played p
    JOIN songs s ON s.id = p.song_id
   WHERE p_game_code IS NOT NULL
   ORDER BY p.round_number;
$$;

REVOKE EXECUTE ON FUNCTION game_setlist(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game_setlist(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- round_song
-- ---------------------------------------------------------------------------

CREATE FUNCTION round_song(p_game_code text, p_song_id uuid)
RETURNS TABLE(
  id           uuid,
  title        text,
  artist       text,
  youtube_id   text,
  start_time   integer,
  release_year integer,
  genre_slugs  text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT gs.id, gs.title, gs.artist, gs.youtube_id, gs.start_time,
         gs.release_year, gs.genre_slugs
    FROM game_setlist(p_game_code) gs
   WHERE gs.id = p_song_id
   ORDER BY gs.round_number
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION round_song(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION round_song(text, uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- song_pool_counts: SECURITY INVOKER (mig 052) -> SECURITY DEFINER.
-- Body verbatim from 052.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION song_pool_counts()
RETURNS TABLE(
  decade     integer,  -- release_year / 10 * 10; NULL when the year is unknown
  genre_ids  uuid[],   -- every genre the songs are in, sorted
  song_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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

COMMIT;
