-- 005_rpc_functions.sql
-- The five PL/pgSQL functions that hold the system's state-transition logic.
--
-- Spec: docs/rpc-functions.md §1–5.
-- Race correctness for buzz_in: docs/realtime-design.md §4.
--
-- All functions: SECURITY DEFINER + explicit search_path so they execute with
-- table-owner privileges and can't be hijacked by search_path manipulation.
-- CREATE OR REPLACE makes this migration idempotent.

-- =============================================================================
-- buzz_in — atomic buzzer claim. The hot path.
-- =============================================================================
CREATE OR REPLACE FUNCTION buzz_in(
  p_game_code char(6),
  p_team_id   uuid
)
RETURNS TABLE(locked boolean, locked_team_id uuid, locked_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE active_games ag
     SET buzzed_team_id = p_team_id,
         locked_at      = now()
   WHERE ag.game_code = p_game_code
     AND ag.status = 'playing'
     AND ag.buzzed_team_id IS NULL
  RETURNING true, ag.buzzed_team_id, ag.locked_at;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, ag.buzzed_team_id, ag.locked_at
      FROM active_games ag
     WHERE ag.game_code = p_game_code;
  END IF;
END $$;

-- =============================================================================
-- start_round — manager advances to next song.
-- =============================================================================
CREATE OR REPLACE FUNCTION start_round(
  p_game_code char(6),
  p_song_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id  uuid;
  v_round_num integer;
  v_status    text;
BEGIN
  SELECT status, round_number + 1 INTO v_status, v_round_num
    FROM active_games WHERE game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'ended' THEN
    RAISE EXCEPTION 'game_already_ended' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO game_rounds (game_code, round_number, song_id)
  VALUES (p_game_code, v_round_num, p_song_id)
  RETURNING id INTO v_round_id;

  UPDATE active_games
     SET status           = 'playing',
         round_number     = v_round_num,
         current_song_id  = p_song_id,
         current_round_id = v_round_id,
         buzzed_team_id   = NULL,
         locked_at        = NULL
   WHERE game_code = p_game_code;

  RETURN v_round_id;
END $$;

-- =============================================================================
-- award_points — manager evaluates the answer.
-- =============================================================================
-- DROP guard so later migrations that rename parameters (e.g. 014's source→wrong_buzz)
-- can be re-applied alongside this file without `cannot change name of input parameter`.
DROP FUNCTION IF EXISTS award_points(char, uuid, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION award_points(
  p_game_code char(6),
  p_round_id  uuid,
  p_title     integer DEFAULT 0,
  p_artist    integer DEFAULT 0,
  p_source    integer DEFAULT 0,
  p_timeout   integer DEFAULT 0
)
RETURNS TABLE(team_id uuid, points_awarded integer, team_total_score integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id     uuid;
  v_total       integer;
  v_round_ended timestamptz;
BEGIN
  SELECT buzzed_team_id, ended_at INTO v_team_id, v_round_ended
    FROM game_rounds WHERE id = p_round_id AND game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_round_ended IS NOT NULL THEN
    RAISE EXCEPTION 'round_already_ended' USING ERRCODE = 'P0001';
  END IF;

  v_total := COALESCE(p_title, 0) + COALESCE(p_artist, 0) + COALESCE(p_source, 0)
             - COALESCE(p_timeout, 0);

  UPDATE game_rounds
     SET title_points    = p_title,
         artist_points   = p_artist,
         source_points   = p_source,
         timeout_penalty = p_timeout,
         ended_at        = now()
   WHERE id = p_round_id;

  IF v_team_id IS NOT NULL AND p_timeout = 0 THEN
    UPDATE game_teams SET score = score + v_total WHERE id = v_team_id;
  END IF;

  UPDATE active_games
     SET buzzed_team_id = NULL, locked_at = NULL
   WHERE game_code = p_game_code;

  RETURN QUERY
  SELECT v_team_id,
         v_total,
         COALESCE((SELECT score FROM game_teams WHERE id = v_team_id), 0);
END $$;

-- =============================================================================
-- end_game — manager ends the game.
-- =============================================================================
CREATE OR REPLACE FUNCTION end_game(p_game_code char(6))
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ended_at timestamptz;
  v_status   text;
BEGIN
  SELECT status, ended_at INTO v_status, v_ended_at
    FROM active_games WHERE game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'ended' THEN
    RAISE EXCEPTION 'game_already_ended' USING ERRCODE = 'P0001';
  END IF;

  UPDATE active_games
     SET status   = 'ended',
         ended_at = now()
   WHERE game_code = p_game_code
   RETURNING ended_at INTO v_ended_at;

  RETURN v_ended_at;
END $$;

-- =============================================================================
-- cleanup_expired_games — pg_cron sweeper, hourly.
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_games()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM active_games
     WHERE expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM deleted;

  RETURN v_count;
END $$;
