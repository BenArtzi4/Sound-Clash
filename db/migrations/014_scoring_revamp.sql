-- 014_scoring_revamp.sql
-- Reshape the scoring contract.
--
-- Why:
--   1. There was no penalty for buzzing in and getting both title and artist
--      wrong: award_points was called with all booleans false, v_total = 0,
--      score unchanged. Optimal play was to slam the buzzer the instant audio
--      played. A real -3 penalty makes the buzzer race meaningful.
--   2. The "source" mechanic (soundtrack-only +5) added a third checkbox, an
--      is_soundtrack lookup on every award call, and ambiguous UX. Drop it
--      from scoring; songs.is_soundtrack stays as a song attribute.
--   3. The "timeout penalty" was wired but inert: award_points only updated
--      a team's score IF v_team_id IS NOT NULL AND p_timeout = 0, so the
--      -2 never landed on any team. Drop it; timeout becomes a pure "end the
--      round, no score change" signal.
--   4. New manager action: bonus. Anytime, host picks any team and grants
--      +4 (configurable). Independent of round/buzz state, hence a separate
--      function and a separate endpoint; no combined "award + bonus".
--
-- What changes:
--   game_rounds: drop source_points, drop timeout_penalty, add wrong_buzz_penalty.
--   award_points: signature renamed (p_source → p_wrong_buzz). New behavior
--     applies wrong_buzz penalty to the buzzed team and rejects mixed states.
--   award_bonus: new function. service-role only (gated at API by manager_token).
--
-- Idempotent: ALTER TABLE uses IF [NOT] EXISTS guards; CREATE OR REPLACE for
-- the functions; explicit DROP FUNCTION IF EXISTS so the param rename works
-- even if the function exists with the old (p_source) parameter names.

-- ---------------------------------------------------------------------------
-- 1. Reshape game_rounds.
-- ---------------------------------------------------------------------------
ALTER TABLE game_rounds DROP COLUMN IF EXISTS source_points;
ALTER TABLE game_rounds DROP COLUMN IF EXISTS timeout_penalty;
ALTER TABLE game_rounds
  ADD COLUMN IF NOT EXISTS wrong_buzz_penalty integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. Replace award_points.
--
--    Inputs:
--      p_title       0 or TITLE_POINTS  (10)
--      p_artist      0 or ARTIST_POINTS (5)
--      p_wrong_buzz  0 or WRONG_BUZZ_PENALTY (3): applied as a deduction
--      p_timeout     0 or 1 (flag)
--
--    Behavior:
--      - p_timeout = 1 → end the round, no score change. Other inputs ignored.
--      - p_wrong_buzz > 0 with p_title > 0 OR p_artist > 0 → reject (mixed state).
--      - team buzzed AND p_wrong_buzz > 0 → score -= p_wrong_buzz, record on round.
--      - team buzzed AND (p_title > 0 OR p_artist > 0) → score += sum, record.
--      - team buzzed AND all zero → end round, no score change (manager declined).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS award_points(char, uuid, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION award_points(
  p_game_code  char(6),
  p_round_id   uuid,
  p_title      integer DEFAULT 0,
  p_artist     integer DEFAULT 0,
  p_wrong_buzz integer DEFAULT 0,
  p_timeout    integer DEFAULT 0
)
RETURNS TABLE(team_id uuid, points_awarded integer, team_total_score integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id     uuid;
  v_round_ended timestamptz;
  v_delta       integer;
BEGIN
  SELECT buzzed_team_id, ended_at INTO v_team_id, v_round_ended
    FROM game_rounds WHERE id = p_round_id AND game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_round_ended IS NOT NULL THEN
    RAISE EXCEPTION 'round_already_ended' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_wrong_buzz, 0) > 0
     AND (COALESCE(p_title, 0) > 0 OR COALESCE(p_artist, 0) > 0) THEN
    RAISE EXCEPTION 'wrong_buzz_with_correct' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_timeout, 0) > 0 THEN
    v_delta := 0;
  ELSIF COALESCE(p_wrong_buzz, 0) > 0 THEN
    v_delta := -p_wrong_buzz;
  ELSE
    v_delta := COALESCE(p_title, 0) + COALESCE(p_artist, 0);
  END IF;

  UPDATE game_rounds
     SET title_points       = COALESCE(p_title, 0),
         artist_points      = COALESCE(p_artist, 0),
         wrong_buzz_penalty = COALESCE(p_wrong_buzz, 0),
         ended_at           = now()
   WHERE id = p_round_id;

  IF v_team_id IS NOT NULL AND COALESCE(p_timeout, 0) = 0 AND v_delta <> 0 THEN
    UPDATE game_teams SET score = score + v_delta WHERE id = v_team_id;
  END IF;

  UPDATE active_games
     SET buzzed_team_id = NULL, locked_at = NULL
   WHERE game_code = p_game_code;

  RETURN QUERY
  SELECT v_team_id,
         v_delta,
         COALESCE((SELECT score FROM game_teams WHERE id = v_team_id), 0);
END $$;

-- ---------------------------------------------------------------------------
-- 3. award_bonus; host-discretion award to a chosen team. service_role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION award_bonus(
  p_game_code char(6),
  p_team_id   uuid,
  p_points    integer DEFAULT 4
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status     text;
  v_team_game  text;
  v_new_total  integer;
BEGIN
  IF COALESCE(p_points, 0) <= 0 THEN
    RAISE EXCEPTION 'bonus_points_non_positive' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM active_games WHERE game_code = p_game_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'ended' THEN
    RAISE EXCEPTION 'game_already_ended' USING ERRCODE = 'P0001';
  END IF;

  SELECT game_code INTO v_team_game FROM game_teams WHERE id = p_team_id;
  IF NOT FOUND OR v_team_game IS DISTINCT FROM p_game_code THEN
    RAISE EXCEPTION 'team_not_in_game' USING ERRCODE = 'P0002';
  END IF;

  UPDATE game_teams
     SET score = score + p_points
   WHERE id = p_team_id
  RETURNING score INTO v_new_total;

  RETURN v_new_total;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Function grants. anon keeps EXECUTE on buzz_in only. award_points and
--    award_bonus stay service_role only (FastAPI gates them with manager_token).
--    REVOKE is naturally idempotent. award_points was retired in migration 016;
--    guard the REVOKE so re-applying this file after 016 doesn't fail.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public' AND p.proname = 'award_points'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION award_points(char, uuid, integer, integer, integer, integer) FROM PUBLIC';
  END IF;
END $$;
REVOKE ALL ON FUNCTION award_bonus(char, uuid, integer)                              FROM PUBLIC;
