-- 006_rls_policies.sql
-- Row-level security and function grants. Two principals: anon (browser) and
-- service_role (FastAPI; bypasses RLS).
--
-- Spec: docs/security-rls.md §2.
--
-- Idempotent: roles created if missing (no-op on Supabase, where they exist
-- natively); policies dropped before re-creation; grants and REVOKEs are
-- naturally idempotent in Postgres.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

ALTER TABLE songs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE genres       ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_genres  ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_teams   ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_rounds  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_songs"        ON songs;
DROP POLICY IF EXISTS "anon_read_genres"       ON genres;
DROP POLICY IF EXISTS "anon_read_song_genres"  ON song_genres;
DROP POLICY IF EXISTS "anon_read_active_games" ON active_games;
DROP POLICY IF EXISTS "anon_read_game_teams"   ON game_teams;
DROP POLICY IF EXISTS "anon_read_game_rounds"  ON game_rounds;

CREATE POLICY "anon_read_songs"        ON songs        FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_genres"       ON genres       FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_song_genres"  ON song_genres  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_active_games" ON active_games FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_game_teams"   ON game_teams   FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_game_rounds"  ON game_rounds  FOR SELECT TO anon USING (true);

-- The anon role needs base-table privilege before RLS even gates anything.
GRANT SELECT ON songs, genres, song_genres, active_games, game_teams, game_rounds TO anon;

-- Function grants: only buzz_in is callable by anon.
REVOKE ALL ON FUNCTION buzz_in(char, uuid)                                       FROM PUBLIC;
REVOKE ALL ON FUNCTION start_round(char, uuid)                                   FROM PUBLIC;
REVOKE ALL ON FUNCTION end_game(char)                                            FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_games()                                   FROM PUBLIC;

-- award_points was retired by migration 016 in favour of award_attempt +
-- end_round; guard the REVOKE so re-applying this migration after 016
-- doesn't fail on a dropped function. Migration 016 issues its own
-- REVOKE for the replacement functions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public' AND p.proname = 'award_points'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION award_points(char, uuid, integer, integer, integer, integer) FROM PUBLIC';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION buzz_in(char, uuid) TO anon;
