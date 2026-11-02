-- 054_revoke_anon_catalogue_reads.sql
-- The anon key can no longer read the song catalog.
--
-- Why: the anon key ships in the site's JS, and migration 006 gave anon
-- `SELECT ... USING (true)` on songs and song_genres, so anyone holding the key
-- could download the whole catalog (title, artist, youtube_id, start_time,
-- release_year, genres) in one request per table. Migration 053 moved every
-- browser read of these tables to game-scoped SECURITY DEFINER functions
-- (game_setlist, round_song) and made song_pool_counts SECURITY DEFINER. Faro
-- showed no direct `rest/v1/songs` reads for the 24 hours before this was
-- applied, so no open page still reads the tables.
--
-- This is the CONTRACT step after 053:
--   * drop the policies anon_read_songs and anon_read_song_genres;
--   * REVOKE SELECT on songs and song_genres from anon and authenticated (the
--     REVOKE turns a read into "permission denied", not an empty list; hosted
--     Supabase also auto-grants every table to authenticated, which no client
--     here uses).
-- genres keeps its policy and grant: the create page and the e2e fixtures
-- read the genre names, and they are not the catalog.
--
-- What still reads songs / song_genres, and why it keeps working:
--   * game_setlist, round_song, song_pool_counts, select_next_song,
--     peek_next_song, archive_game, set_song_availability: SECURITY DEFINER,
--     so they read as the function owner. pick_next_song is SECURITY INVOKER
--     but anon cannot execute it (mig 048); it runs only inside the DEFINER
--     functions above, as their owner.
--   * FastAPI, the admin API, the dead-video scan, the catalog backup and the
--     e2e fixtures use the service_role key, which bypasses RLS and keeps its
--     grants.
--   * Realtime publishes only active_games, game_teams and game_rounds
--     (mig 009), never the catalog.
--
-- Only SELECT is revoked. Writes were never possible for anon: RLS has no
-- INSERT / UPDATE / DELETE policy on these tables.
--
-- Rollback: the down script restores migration 006's two policies and its
-- anon grant in one command (kept with the private plan, not in this folder,
-- so a full replay never undoes this migration).
--
-- Idempotent: DROP POLICY IF EXISTS; REVOKE of a privilege a role does not
-- hold is a no-op. On a full replay (CI runs every migration twice) 006
-- recreates the policies and the grant, and this file removes them again, so
-- the end state is the same. Roles are created if missing, as in 006 / 020 /
-- 033, for a bare Postgres such as the db test container. One transaction, so
-- a reader sees the old state or the new one.
--
-- Spec: docs/security-rls.md §2, docs/data-model.md.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

DROP POLICY IF EXISTS "anon_read_songs"       ON songs;
DROP POLICY IF EXISTS "anon_read_song_genres" ON song_genres;

REVOKE SELECT ON songs, song_genres FROM anon, authenticated;

COMMIT;
