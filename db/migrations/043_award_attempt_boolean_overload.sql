-- 043_award_attempt_boolean_overload.sql
-- Scoring authority in the DB (Phase 7, T7.1 / D-7). Today award_attempt takes
-- the point MAGNITUDES as client integers (p_title=10 / p_artist=5 /
-- p_wrong_buzz=3) and does arithmetic on whatever the browser sends -- a
-- tampered client could POST p_title:999. This migration makes the DB the sole
-- authority for how much a claim is worth: a new overload takes BOOLEAN flags
-- and derives the magnitudes (10 / 5 / 3) server-side, so the wire can no longer
-- carry a point value at all.
--
-- ROLLOUT: dual overload, NOT a DROP+replace (mig-021 lesson). We ADD the
-- boolean signature ALONGSIDE the existing integer one from mig 036; both
-- coexist. PostgREST routes by the named-argument set, and the two overloads
-- have DISTINCT parameter names (p_correct_title/p_correct_artist/p_wrong vs
-- p_title/p_artist/p_wrong_buzz) AND distinct types, so resolution is
-- unambiguous. Per the mig-021 lesson the new boolean args carry NO DEFAULTs.
-- This makes 043 backward-compatible and safe to apply to prod at ANY time,
-- decoupled from the frontend deploy: a still-loaded old tab keeps hitting the
-- integer overload; a freshly deployed tab hits the boolean one. A later mig 044
-- DROPs the now-dead integer overload once no old clients remain (mirrors
-- mig-023 retiring the legacy overloads after the direct-RPC path stabilised).
--
-- Behaviour is byte-identical to mig 036 (Design 1): the derived magnitudes are
-- exactly 10 / 5 / 3, soundtrack stays emergent as both-flags -> 10+5=15 (two
-- independent claims, unchanged), all guard/validation logic, the free-guess
-- -3 waiver (mig 017), the single combined game_rounds UPDATE (mig 036), the
-- attempts-row insert, and the buzz-lock handling (mig 018/019) are unchanged.
-- The *_points columns now store DB-computed values (identical numbers).
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION award_attempt(
  p_game_code     text,
  p_round_id      uuid,
  p_correct_title  boolean,
  p_correct_artist boolean,
  p_wrong          boolean,
  p_manager_token  uuid
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
  -- Server-derived point magnitudes. The client sends only booleans, so these
  -- can no longer be inflated from the wire (T7.1). Everything below is the
  -- mig-036 body with p_title -> v_title_pts, p_artist -> v_artist_pts,
  -- p_wrong_buzz -> v_wrong_pts.
  v_title_pts        integer;
  v_artist_pts       integer;
  v_wrong_pts        integer;
BEGIN
  -- Token check happens first, before any reads/writes that could leak
  -- information about a game's state to an unauthenticated caller.
  SELECT gs.manager_token, ag.ended_at
    INTO v_expected_token, v_game_ended_at
    FROM active_games ag
    LEFT JOIN game_secrets gs ON gs.game_code = ag.game_code
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

  -- Derive the point magnitudes server-side (the whole point of T7.1). NULL
  -- flags are treated as false, mirroring the integer overload's COALESCE(...,0).
  v_title_pts  := CASE WHEN COALESCE(p_correct_title,  false) THEN 10 ELSE 0 END;
  v_artist_pts := CASE WHEN COALESCE(p_correct_artist, false) THEN  5 ELSE 0 END;
  v_wrong_pts  := CASE WHEN COALESCE(p_wrong,          false) THEN  3 ELSE 0 END;

  -- Snapshot the round's current claim + free-guess state up front. These serve
  -- both the validation below and, when the combined write is skipped, the
  -- return values (unchanged claims).
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

  IF v_wrong_pts > 0
     AND (v_title_pts > 0 OR v_artist_pts > 0) THEN
    RAISE EXCEPTION 'wrong_buzz_with_correct' USING ERRCODE = 'P0001';
  END IF;

  IF v_title_pts > 0 AND v_title_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'title_already_claimed' USING ERRCODE = 'P0001';
  END IF;
  IF v_artist_pts > 0 AND v_artist_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'artist_already_claimed' USING ERRCODE = 'P0001';
  END IF;

  IF v_wrong_pts > 0 THEN
    IF v_free_guess THEN
      v_delta := 0;
    ELSE
      v_delta := -v_wrong_pts;
    END IF;
    v_outcome := 'wrong';
  ELSIF v_title_pts > 0 AND v_artist_pts > 0 THEN
    v_delta := v_title_pts + v_artist_pts;
    v_outcome := 'title_artist';
  ELSIF v_title_pts > 0 THEN
    v_delta := v_title_pts;
    v_outcome := 'title';
  ELSIF v_artist_pts > 0 THEN
    v_delta := v_artist_pts;
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

  -- Apply the score change and read back the new total in one statement on the
  -- scoring path; only fall back to a plain read when the score is unchanged
  -- (wrong-with-free-guess, or a no-op continue).
  IF v_delta <> 0 THEN
    UPDATE game_teams SET score = score + v_delta WHERE id = v_team_id
    RETURNING score INTO v_score;
  ELSE
    SELECT gt.score INTO v_score FROM game_teams gt WHERE gt.id = v_team_id;
  END IF;

  -- One combined game_rounds write. Each column keeps its current value unless
  -- this attempt changes it (CASE ELSE gr.<col>); free_guess_active is always
  -- recomputed. The whole statement is skipped when nothing changes, so a no-op
  -- Continue emits no ROUND_CHANGE. RETURNING feeds the return row without a
  -- second SELECT. The `gr` alias qualifies column reads so they are never
  -- ambiguous with the same-named RETURNS TABLE output columns.
  IF v_title_pts > 0
     OR v_artist_pts > 0
     OR v_wrong_pts > 0
     OR v_new_free_guess IS DISTINCT FROM COALESCE(v_free_guess, false) THEN
    UPDATE game_rounds gr
       SET title_claimed_by   = CASE WHEN v_title_pts > 0  THEN v_team_id ELSE gr.title_claimed_by END,
           title_points       = CASE WHEN v_title_pts > 0  THEN v_title_pts   ELSE gr.title_points END,
           artist_claimed_by  = CASE WHEN v_artist_pts > 0 THEN v_team_id ELSE gr.artist_claimed_by END,
           artist_points      = CASE WHEN v_artist_pts > 0 THEN v_artist_pts  ELSE gr.artist_points END,
           wrong_buzz_penalty = CASE WHEN v_wrong_pts > 0 THEN v_wrong_pts ELSE gr.wrong_buzz_penalty END,
           free_guess_active  = v_new_free_guess
     WHERE gr.id = p_round_id
    RETURNING gr.title_claimed_by, gr.artist_claimed_by
      INTO v_title_claimed, v_artist_claimed;
  END IF;

  IF v_outcome IS NOT NULL THEN
    INSERT INTO game_round_attempts (round_id, game_code, team_id, outcome, points_delta)
    VALUES (p_round_id, p_game_code, v_team_id, v_outcome, v_delta);
  END IF;

  IF v_wrong_pts > 0 THEN
    UPDATE active_games
       SET buzzed_team_id = NULL, locked_at = NULL
     WHERE game_code = p_game_code;
  ELSIF v_outcome IN ('title', 'artist', 'title_artist') THEN
    UPDATE active_games
       SET locked_at = now()
     WHERE game_code = p_game_code;
  END IF;

  RETURN QUERY SELECT v_team_id, v_delta, COALESCE(v_score, 0),
                      v_title_claimed, v_artist_claimed;
END $$;

-- Grant EXECUTE on the NEW boolean overload (browser-callable via anon; the
-- manager_token is validated in-body, same as the integer overload). The
-- integer overload from mig 036 keeps its own grant and stays live until mig 044.
GRANT EXECUTE ON FUNCTION award_attempt(text, uuid, boolean, boolean, boolean, uuid)
  TO anon, authenticated, service_role;
