-- 016_multi_buzz_rounds.sql
-- Reshape rounds so multiple teams can buzz on the same song until both
-- the title and the artist tokens have been claimed (or the manager
-- advances). See docs/game-rules.md §3-§4 (rewritten in the same PR).
--
-- Old model (migrations 005, 011, 014): one buzz per round; award_points
-- both scored AND closed the round. Wrong meant -3 and the round ended.
--
-- New model:
--   * game_rounds gains title_claimed_by / artist_claimed_by (uuid)
--   * a new game_round_attempts table records every buzz evaluation
--   * award_points is replaced by award_attempt: it scores, records the
--     attempt, may claim a token, and clears the buzz lock --- but does
--     NOT set ended_at. The round stays open.
--   * a new end_round function closes the round explicitly. The manager
--     calls it via /games/{code}/end-round (Next Round button). It is
--     idempotent.
--   * start_round defensively closes any still-open prior round before
--     inserting a new one, so a manager who advances mid-round (without
--     pressing End Round) doesn't leave dangling open rounds.
--
-- Idempotent: ADD COLUMN / CREATE TABLE guards, CREATE OR REPLACE on
-- functions, REPLICA IDENTITY and publication membership are guarded.

-- ---------------------------------------------------------------------------
-- 1. game_rounds: add per-token claim columns.
-- ---------------------------------------------------------------------------
ALTER TABLE game_rounds
  ADD COLUMN IF NOT EXISTS title_claimed_by  uuid REFERENCES game_teams(id) ON DELETE SET NULL;
ALTER TABLE game_rounds
  ADD COLUMN IF NOT EXISTS artist_claimed_by uuid REFERENCES game_teams(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. game_round_attempts: one row per buzz evaluation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_round_attempts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      uuid        NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  game_code     text        NOT NULL REFERENCES active_games(game_code) ON DELETE CASCADE,
  team_id       uuid        NOT NULL REFERENCES game_teams(id) ON DELETE CASCADE,
  outcome       text        NOT NULL CHECK (outcome IN ('title','artist','title_artist','wrong')),
  points_delta  integer     NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_round_attempts_round_id  ON game_round_attempts(round_id);
CREATE INDEX IF NOT EXISTS idx_round_attempts_game_code ON game_round_attempts(game_code);

-- Wire into Realtime (mirrors 009_realtime_publication.sql pattern).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename = 'game_round_attempts'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_round_attempts;
  END IF;
END $$;

ALTER TABLE public.game_round_attempts REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- 3. Drop the old award_points; we replace it with award_attempt.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS award_points(char, uuid, integer, integer, integer, integer);

-- ---------------------------------------------------------------------------
-- 4. award_attempt: score one buzz; do NOT close the round.
--
--    Inputs:
--      p_title       0 or 10
--      p_artist      0 or 5
--      p_wrong_buzz  0 or 3 (mutually exclusive with title/artist > 0)
--
--    Behavior:
--      - rejects if round not found, round already ended, no buzz held.
--      - rejects if requested token already claimed by anyone.
--      - applies score delta to the buzzed team.
--      - inserts an attempts row with outcome ('title'|'artist'|'title_artist'|'wrong').
--      - on a correct outcome, marks the corresponding *_claimed_by columns.
--      - clears active_games.buzzed_team_id and locked_at (re-arm buzzers).
--      - leaves game_rounds.ended_at NULL.
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
  v_outcome        text;
  v_delta          integer;
  v_score          integer;
BEGIN
  -- Qualify column refs with the table name. RETURNS TABLE introduces
  -- columns of the same name into the function's namespace; without the
  -- qualifier PL/pgSQL raises "ambiguous column reference".
  SELECT gr.ended_at, gr.title_claimed_by, gr.artist_claimed_by
    INTO v_round_ended, v_title_claimed, v_artist_claimed
    FROM game_rounds gr
   WHERE gr.id = p_round_id AND gr.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_round_ended IS NOT NULL THEN
    RAISE EXCEPTION 'round_already_ended' USING ERRCODE = 'P0001';
  END IF;

  -- The "currently buzzed" team lives on active_games, not game_rounds:
  -- game_rounds.buzzed_team_id is the durable record of *some* buzz
  -- (set by buzz_in, never cleared by award_attempt) and would falsely
  -- report a held lock after a successful prior attempt this round.
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
    v_delta := -p_wrong_buzz;
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
    -- Manager pressed Continue with no toggle and a held buzz: treat as
    -- "no points, just re-arm". This is allowed (manager mis-clicked or
    -- changed their mind); we still record nothing and clear the lock.
    v_delta := 0;
    v_outcome := NULL;
  END IF;

  -- Apply score change.
  IF v_delta <> 0 THEN
    UPDATE game_teams SET score = score + v_delta WHERE id = v_team_id;
  END IF;

  -- Mark token claims.
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

  -- Record the attempt (skip the "no-op continue" case where outcome is NULL).
  IF v_outcome IS NOT NULL THEN
    INSERT INTO game_round_attempts (round_id, game_code, team_id, outcome, points_delta)
    VALUES (p_round_id, p_game_code, v_team_id, v_outcome, v_delta);
  END IF;

  -- Re-arm buzzers.
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

-- ---------------------------------------------------------------------------
-- 5. end_round: close a round. Idempotent; safe to call on already-ended.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION end_round(
  p_game_code text,
  p_round_id  uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ended_at timestamptz;
BEGIN
  SELECT ended_at INTO v_ended_at
    FROM game_rounds WHERE id = p_round_id AND game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_ended_at IS NULL THEN
    UPDATE game_rounds SET ended_at = now()
     WHERE id = p_round_id
    RETURNING ended_at INTO v_ended_at;
  END IF;

  UPDATE active_games
     SET buzzed_team_id = NULL, locked_at = NULL
   WHERE game_code = p_game_code;

  RETURN v_ended_at;
END $$;

REVOKE ALL ON FUNCTION end_round(text, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 6. start_round: defensively close any prior open round before inserting.
-- ---------------------------------------------------------------------------
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

  -- Close any prior round that was left open (e.g. manager advanced
  -- without explicitly calling end_round). Sets ended_at = now() so
  -- award_attempt on the prior round would now fail with
  -- round_already_ended; the new round picks up cleanly.
  UPDATE game_rounds
     SET ended_at = now()
   WHERE game_code = p_game_code
     AND ended_at IS NULL;

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
