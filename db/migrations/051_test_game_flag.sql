-- 051_test_game_flag.sql
-- Tell real games from our own test runs (harnesses, post-merge prod passes,
-- manual checks), so durable history and any number built on it count only
-- real play. Plan: GitHub issue #393 (step H-1).
--
--   * game_secrets.is_test: set by POST /games (backend, service role) when the
--     request comes from a headless or non-browser client, or carries the
--     X-Sound-Clash-Test header. game_secrets is operator-only and NOT in the
--     Realtime publication, so no client sees or receives it.
--   * game_history.is_test: copied by archive_game when the game is archived.
--   * mark_game_test(code[, started_at]): service-role-only fix-up for a test
--     game that slipped through (live and/or already archived).
--
-- Old history is deliberately not backfilled here: public totals will count
-- only games archived after this ships (docs/data-model.md, game_history).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION, grants and
-- revokes are naturally re-runnable. Spec: docs/data-model.md,
-- docs/rpc-functions.md, docs/security-rls.md, docs/api-contracts.md.

BEGIN;

-- Defensive role creation (mirrors 006/020/033) so this applies on a bare
-- Postgres too; a no-op on hosted Supabase.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE game_secrets ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE game_history ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- The backend flags a game right after inserting it (the AFTER INSERT trigger
-- from 034 creates the secret row). Column-level UPDATE keeps the service
-- role unable to rewrite manager_token through PostgREST.
GRANT UPDATE (is_test) ON game_secrets TO service_role;

-- ---------------------------------------------------------------------------
-- 2. archive_game: identical to migration 033 except that it also copies
--    game_secrets.is_test into game_history.is_test.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION archive_game(p_game_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at timestamptz;
  v_ended_at   timestamptz;
  v_genres     uuid[];
  v_decades    integer[];
  v_round_cnt  integer;
  v_team_cnt   integer;
  v_is_test    boolean;
  v_history_id uuid;
BEGIN
  -- Load the game. Missing row -> nothing to archive (already swept, or never
  -- existed). Return NULL rather than raising so callers can PERFORM blindly.
  SELECT ag.started_at, ag.ended_at, ag.selected_genres, ag.selected_decades
    INTO v_started_at, v_ended_at, v_genres, v_decades
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Skip games that never played a round.
  SELECT count(*) INTO v_round_cnt
    FROM game_rounds gr
   WHERE gr.game_code = p_game_code;

  IF v_round_cnt = 0 THEN
    RETURN NULL;
  END IF;

  -- Idempotency: already archived this exact game (code + start instant)?
  SELECT gh.id INTO v_history_id
    FROM game_history gh
   WHERE gh.game_code = p_game_code
     AND gh.started_at = v_started_at;

  IF FOUND THEN
    RETURN v_history_id;
  END IF;

  SELECT count(*) INTO v_team_cnt
    FROM game_teams gt
   WHERE gt.game_code = p_game_code;

  -- A game created before migration 051 has no flag: treat it as real.
  SELECT COALESCE(gs.is_test, false) INTO v_is_test
    FROM game_secrets gs
   WHERE gs.game_code = p_game_code;
  v_is_test := COALESCE(v_is_test, false);

  INSERT INTO game_history (
    game_code, started_at, ended_at, round_count,
    selected_genres, selected_decades, team_count, is_test
  )
  VALUES (
    p_game_code, v_started_at, COALESCE(v_ended_at, now()), v_round_cnt,
    v_genres, v_decades, v_team_cnt, v_is_test
  )
  ON CONFLICT ON CONSTRAINT game_history_code_started_key DO NOTHING
  RETURNING id INTO v_history_id;

  -- Lost a concurrent insert race: the row now exists, re-read its id and bail
  -- (the winning caller wrote the children).
  IF v_history_id IS NULL THEN
    SELECT gh.id INTO v_history_id
      FROM game_history gh
     WHERE gh.game_code = p_game_code
       AND gh.started_at = v_started_at;
    RETURN v_history_id;
  END IF;

  -- Teams snapshot (final scores).
  INSERT INTO game_history_teams (game_history_id, name, score, joined_at)
  SELECT v_history_id, gt.name, gt.score, gt.joined_at
    FROM game_teams gt
   WHERE gt.game_code = p_game_code;

  -- Songs snapshot, ordered by round_number, denormalised from songs. A round
  -- whose song was already hard-deleted (song_id NULL) keeps a placeholder so
  -- the ordered list stays contiguous; the NOT NULL columns need a fallback.
  INSERT INTO game_history_songs (
    game_history_id, round_number, song_id,
    song_title, song_artist, youtube_id, start_time
  )
  SELECT v_history_id,
         gr.round_number,
         gr.song_id,
         COALESCE(s.title, '(deleted song)'),
         COALESCE(s.artist, ''),
         COALESCE(s.youtube_id::text, ''),
         COALESCE(s.start_time, 0)
    FROM game_rounds gr
    LEFT JOIN songs s ON s.id = gr.song_id
   WHERE gr.game_code = p_game_code
   ORDER BY gr.round_number;

  RETURN v_history_id;
END $$;

-- ---------------------------------------------------------------------------
-- 3. mark_game_test: flag a test game after the fact. Flags the live secret
--    (so the archive copies it later) and any archived rows with that code,
--    narrowed to one start instant when p_started_at is given (codes are
--    recycled after the TTL). Returns how many rows it flagged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_game_test(p_game_code text, p_started_at timestamptz DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live    integer;
  v_history integer;
BEGIN
  UPDATE game_secrets gs
     SET is_test = true
   WHERE gs.game_code = p_game_code
     AND (p_started_at IS NULL OR EXISTS (
           SELECT 1 FROM active_games ag
            WHERE ag.game_code = gs.game_code AND ag.started_at = p_started_at));
  GET DIAGNOSTICS v_live = ROW_COUNT;

  UPDATE game_history gh
     SET is_test = true
   WHERE gh.game_code = p_game_code
     AND (p_started_at IS NULL OR gh.started_at = p_started_at);
  GET DIAGNOSTICS v_history = ROW_COUNT;

  RETURN v_live + v_history;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Grants: both functions are service-role-only (mirror 020/033: CREATE OR
--    REPLACE can re-trip hosted Supabase's auto-grant to anon).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('archive_game', 'mark_game_test')
  LOOP
    EXECUTE format('REVOKE ALL    ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', fn);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;
