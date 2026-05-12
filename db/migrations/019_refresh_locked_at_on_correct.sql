-- 019_refresh_locked_at_on_correct.sql
-- Refresh active_games.locked_at on a correct attempt.
--
-- Migration 018 keeps the buzz lock held on the answering team after a
-- Correct Song / Correct Artist, so that team retains the floor for the
-- other token until the manager presses Continue or Wrong. The clients
-- (team + display) derive the 10-second answer countdown purely from
-- active_games.locked_at, so without this change the timer keeps counting
-- down from the original buzz instead of restarting -- the team that just
-- earned the floor for the other half effectively gets no fresh window.
--
-- This migration makes award_attempt set locked_at = now() on the
-- title / artist / title_artist branches (buzzed_team_id is unchanged --
-- the same team keeps control). The wrong-buzz branch still clears both,
-- and the no-op continue branch still leaves the lock untouched.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Body is identical to migration
-- 018 except for the lock-side UPDATE at the end.

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

  -- Lock-side update:
  --   * wrong  -> re-arm the room (clear the lock).
  --   * title / artist / title_artist -> keep the same team on the floor,
  --     but refresh locked_at so their answer countdown restarts for the
  --     remaining token.
  --   * no-op continue -> leave the lock untouched.
  IF COALESCE(p_wrong_buzz, 0) > 0 THEN
    UPDATE active_games
       SET buzzed_team_id = NULL, locked_at = NULL
     WHERE game_code = p_game_code;
  ELSIF v_outcome IN ('title', 'artist', 'title_artist') THEN
    UPDATE active_games
       SET locked_at = now()
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
