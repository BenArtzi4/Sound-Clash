-- 017_free_guess_flag.sql
-- "Free guess" sweetener: after any team scores a correct token in a
-- round, the next award_attempt that round waives the wrong-buzz penalty.
-- The flag is per-round and is consumed (cleared) on every subsequent
-- attempt regardless of outcome.
--
-- Rationale: in the multi-buzz model a team that gets one half of the
-- song right (e.g. the title) often immediately knows the artist too.
-- Letting them re-buzz "for free" rewards being on the right track and
-- speeds up rounds where one team is dominating. See docs/game-rules.md
-- §4 (rewritten in this PR).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION.

-- ---------------------------------------------------------------------------
-- 1. game_rounds.free_guess_active
-- ---------------------------------------------------------------------------
ALTER TABLE game_rounds
  ADD COLUMN IF NOT EXISTS free_guess_active boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. award_attempt: identical to migration 016 except for the free-guess
--    branch on wrong_buzz and the flag-update step at the end.
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
  -- RETURNS TABLE shadows column names; qualify everything.
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
    -- Free-guess sweetener: if the round had a prior correct attempt,
    -- the next wrong is free (delta = 0) but is still recorded so the
    -- attempts log shows the buzz happened.
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

  -- New flag value: true after any correct attempt; false after wrong
  -- (consumes the prior free-guess) and false on the no-op continue case.
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

  -- Always rewrite the flag, even when no other game_rounds column moved,
  -- so the next attempt reads the right value.
  UPDATE game_rounds SET free_guess_active = v_new_free_guess
   WHERE id = p_round_id;

  IF v_outcome IS NOT NULL THEN
    INSERT INTO game_round_attempts (round_id, game_code, team_id, outcome, points_delta)
    VALUES (p_round_id, p_game_code, v_team_id, v_outcome, v_delta);
  END IF;

  UPDATE active_games
     SET buzzed_team_id = NULL, locked_at = NULL
   WHERE game_code = p_game_code;

  SELECT gt.score INTO v_score FROM game_teams gt WHERE gt.id = v_team_id;
  SELECT gr.title_claimed_by, gr.artist_claimed_by
    INTO v_title_claimed, v_artist_claimed
    FROM game_rounds gr WHERE gr.id = p_round_id;

  RETURN QUERY SELECT v_team_id, v_delta, COALESCE(v_score, 0),
                      v_title_claimed, v_artist_claimed;
END $$;

REVOKE ALL ON FUNCTION award_attempt(text, uuid, integer, integer, integer) FROM PUBLIC;
