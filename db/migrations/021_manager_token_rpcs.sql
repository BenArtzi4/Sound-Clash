-- 021_manager_token_rpcs.sql
-- Move the manager-token gate from FastAPI into the PL/pgSQL functions so
-- the browser can call award_attempt / release_buzz_lock directly via
-- Supabase PostgREST RPC, mirroring the buzzer hot-path.
--
-- Before this migration the host's "Correct Song" click took two cross-
-- continent round-trips (Render US-West <-> Supabase Frankfurt): one for
-- require_manager_token's SELECT, then one for the RPC. Plus the Render
-- hop itself. Total: ~400-600ms, with a 2-30s spike on Render cold starts.
-- After this migration the click is one direct browser -> Supabase RPC
-- (~150ms) and the FastAPI hop is gone for these two actions.
--
-- Security model: the new signatures take p_manager_token as their last
-- argument. The function (SECURITY DEFINER) reads active_games.manager_token
-- under definer privileges, raises 'manager_token_required' on mismatch,
-- and only then performs the score / lock changes. UUID equality on a
-- fixed 16-byte type is not a timing-attack vector -- Postgres's '=' does
-- not branch on value -- so secrets.compare_digest equivalence is not
-- needed here.
--
-- Migration 020 revoked anon EXECUTE on the old 5-arg signatures; that
-- revoke stays in place. This migration is *additive*: it leaves the old
-- overloads alone (still locked to service_role) and creates new
-- tokenised overloads next to them, explicitly granted to anon /
-- authenticated / service_role. PostgREST routes by named-parameter set,
-- so the currently-deployed FastAPI (which calls the 5-arg signature)
-- keeps working until the new backend deploys; the new browser code
-- targets the 6-arg signature. A future migration should drop the orphan
-- 5-arg overloads once Render has rebuilt and the old code is gone.
--
-- Idempotent:
--   * CREATE OR REPLACE on the new signatures.
--   * GRANT EXECUTE is naturally idempotent.

-- ---------------------------------------------------------------------------
-- 1. award_attempt with p_manager_token.
--    Body is identical to migration 019 except for the token-check block
--    inserted at the top.
-- ---------------------------------------------------------------------------
-- IMPORTANT: p_manager_token has NO DEFAULT. A DEFAULT here would make this
-- 6-arg overload eligible to match 5-arg calls from the still-deployed
-- FastAPI (which sends {p_game_code, p_round_id, p_title, p_artist,
-- p_wrong_buzz} with no token), and Postgres would raise 42725
-- "function ... is not unique" because both overloads could match. Forcing
-- the caller to pass the token keeps the two signatures cleanly distinct.
CREATE OR REPLACE FUNCTION award_attempt(
  p_game_code     text,
  p_round_id      uuid,
  p_title         integer,
  p_artist        integer,
  p_wrong_buzz    integer,
  p_manager_token uuid
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
  v_team_id          uuid;
  v_round_ended      timestamptz;
  v_title_claimed    uuid;
  v_artist_claimed   uuid;
  v_free_guess       boolean;
  v_outcome          text;
  v_delta            integer;
  v_score            integer;
  v_new_free_guess   boolean;
  v_expected_token   uuid;
  v_game_ended_at    timestamptz;
BEGIN
  -- Token check happens first, before any reads/writes that could leak
  -- information about a game's state to an unauthenticated caller.
  SELECT ag.manager_token, ag.ended_at
    INTO v_expected_token, v_game_ended_at
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_game_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'game_ended' USING ERRCODE = 'P0001';
  END IF;

  IF v_expected_token IS NULL
     OR p_manager_token IS NULL
     OR v_expected_token <> p_manager_token THEN
    RAISE EXCEPTION 'manager_token_required' USING ERRCODE = '28000';
  END IF;

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

-- ---------------------------------------------------------------------------
-- 2. release_buzz_lock with p_manager_token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_buzz_lock(
  p_game_code     text,
  p_manager_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_token uuid;
  v_game_ended_at  timestamptz;
BEGIN
  SELECT ag.manager_token, ag.ended_at
    INTO v_expected_token, v_game_ended_at
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_game_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'game_ended' USING ERRCODE = 'P0001';
  END IF;

  IF v_expected_token IS NULL
     OR p_manager_token IS NULL
     OR v_expected_token <> p_manager_token THEN
    RAISE EXCEPTION 'manager_token_required' USING ERRCODE = '28000';
  END IF;

  UPDATE active_games
     SET buzzed_team_id = NULL, locked_at = NULL
   WHERE game_code = p_game_code;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The old un-tokenised overloads stay in place for now. They remain locked
--    down to service_role only (per migration 020), so the new anon-callable
--    overloads above don't widen anything they leave behind. Keeping them
--    around lets this migration be applied *before* the new backend deploys:
--    the currently-running FastAPI keeps calling the 5-arg signature and
--    works exactly as before. A follow-up migration (post-merge, once Render
--    has rebuilt and the old code is gone) should DROP the orphans:
--      DROP FUNCTION IF EXISTS award_attempt(text, uuid, integer, integer, integer);
--      DROP FUNCTION IF EXISTS release_buzz_lock(text);
--
-- 4. Grants. The browser calls these with the anon key; service_role keeps
--    EXECUTE so any future internal callers (cron, FastAPI fallbacks) work.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION award_attempt(text, uuid, integer, integer, integer, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION release_buzz_lock(text, uuid)
  TO anon, authenticated, service_role;
