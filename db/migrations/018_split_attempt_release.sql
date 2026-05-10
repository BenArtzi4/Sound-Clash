-- 018_split_attempt_release.sql
-- Decouple "score the attempt" from "release the buzz lock". Before this
-- migration, award_attempt always cleared active_games.buzzed_team_id /
-- locked_at, so as soon as the manager scored a Correct Song the room
-- re-armed for the next buzzer. The new flow keeps the lock held on the
-- answering team after Correct Song / Correct Artist (so they get a
-- chance at the other token without anyone cutting in) and only releases
-- it on Wrong or via the new explicit Continue action.
--
-- Two changes:
--   1. award_attempt: only clear the buzz lock on the wrong_buzz branch.
--   2. New release_buzz_lock(text) RPC: idempotent unlock used by the new
--      POST /games/{code}/continue endpoint.
--
-- Idempotent: CREATE OR REPLACE FUNCTION on both functions.

-- ---------------------------------------------------------------------------
-- 1. award_attempt: identical to migration 017 except the lock-clearing
--    UPDATE is now scoped to the wrong_buzz branch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION award_attempt(
  p_game_code  text,
  p_round_id   uuid,
  p_title      integer DEFAULT 0,
  p_artist     integer DEFAULT 0,
  p_wrong_buzz integer DEFAULT 0
)
RETURNS TABLE(
  team_id              uuid,
  points_delta         integer,
  team_total_score     integer,
  title_claimed_by     uuid,
  artist_claimed_by    uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id        uuid;
  v_round_ended    timestamptz;
  v_title_claimed  uuid;
  v_artist_claimed uuid;
  v_free_guess     boolean;
  v_outcome        text;
  v_delta          integer;
  v_score          integer;
  v_new_free_guess boolean;
BEGIN
  SELECT gr.ended_at, gr.title_claimed_by, gr.artist_claimed_by, gr.free_guess_active
    INTO v_round_ended, v_title_claimed, v_artist_claimed, v_free_guess
    FROM game_rounds gr
   WHERE gr.id = p_round_id AND gr.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_round_ended IS NOT NULL THEN
    RAISE EXCEPTION 'round_already_ended' USING ERRCODE = 'P0001';
  END IF;

  SELECT ag.buzzed_team_id INTO v_team_id
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'no_buzz_to_score' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_wrong_buzz, 0) > 0
     AND (COALESCE(p_title, 0) > 0 OR COALESCE(p_artist, 0) > 0) THEN
    RAISE EXCEPTION 'wrong_buzz_with_correct' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_title, 0) > 0 AND v_title_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'title_already_claimed' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_artist, 0) > 0 AND v_artist_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'artist_already_claimed' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_wrong_buzz, 0) > 0 THEN
    IF v_free_guess THEN
      v_delta := 0;
    ELSE
      v_delta := -p_wrong_buzz;
    END IF;
    v_outcome := 'wrong';
  ELSIF COALESCE(p_title, 0) > 0 AND COALESCE(p_artist, 0) > 0 THEN
    v_delta := p_title + p_artist;
    v_outcome := 'title_artist';
  ELSIF COALESCE(p_title, 0) > 0 THEN
    v_delta := p_title;
    v_outcome := 'title';
  ELSIF COALESCE(p_artist, 0) > 0 THEN
    v_delta := p_artist;
    v_outcome := 'artist';
  ELSE
    v_delta := 0;
    v_outcome := NULL;
  END IF;

  IF v_outcome IN ('title', 'artist', 'title_artist') THEN
    v_new_free_guess := true;
  ELSE
    v_new_free_guess := false;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE game_teams SET score = score + v_delta WHERE id = v_team_id;
  END IF;

  IF COALESCE(p_title, 0) > 0 THEN
    UPDATE game_rounds SET title_claimed_by = v_team_id, title_points = p_title
     WHERE id = p_round_id;
  END IF;
  IF COALESCE(p_artist, 0) > 0 THEN
    UPDATE game_rounds SET artist_claimed_by = v_team_id, artist_points = p_artist
     WHERE id = p_round_id;
  END IF;
  IF COALESCE(p_wrong_buzz, 0) > 0 THEN
    UPDATE game_rounds SET wrong_buzz_penalty = p_wrong_buzz
     WHERE id = p_round_id;
  END IF;

  UPDATE game_rounds SET free_guess_active = v_new_free_guess
   WHERE id = p_round_id;

  IF v_outcome IS NOT NULL THEN
    INSERT INTO game_round_attempts (round_id, game_code, team_id, outcome, points_delta)
    VALUES (p_round_id, p_game_code, v_team_id, v_outcome, v_delta);
  END IF;

  -- Only the wrong-buzz path re-arms the room. Title/artist correct
  -- attempts leave buzzed_team_id in place so the answering team retains
  -- the floor for any remaining token; Continue is the explicit unlock.
  IF COALESCE(p_wrong_buzz, 0) > 0 THEN
    UPDATE active_games
       SET buzzed_team_id = NULL, locked_at = NULL
     WHERE game_code = p_game_code;
  END IF;

  SELECT gt.score INTO v_score FROM game_teams gt WHERE gt.id = v_team_id;
  SELECT gr.title_claimed_by, gr.artist_claimed_by
    INTO v_title_claimed, v_artist_claimed
    FROM game_rounds gr WHERE gr.id = p_round_id;

  RETURN QUERY SELECT v_team_id, v_delta, COALESCE(v_score, 0),
                      v_title_claimed, v_artist_claimed;
END $$;

REVOKE ALL ON FUNCTION award_attempt(text, uuid, integer, integer, integer) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. release_buzz_lock: clears buzzed_team_id / locked_at without scoring.
--    Used by POST /games/{code}/continue. No-op if no buzz is currently
--    held; never raises.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_buzz_lock(p_game_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE active_games
     SET buzzed_team_id = NULL, locked_at = NULL
   WHERE game_code = p_game_code;
END $$;

REVOKE ALL ON FUNCTION release_buzz_lock(text) FROM PUBLIC;
