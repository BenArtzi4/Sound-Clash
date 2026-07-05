-- 036_award_attempt_collapse_writes.sql
-- Perf (Phase 3, I-Award1UPDATE): collapse award_attempt's per-round writes into
-- one game_rounds UPDATE and fold the trailing SELECTs into RETURNING.
--
-- Before (mig 034 body): a single "Correct Song" click ran up to FOUR writes to
-- game_rounds -- one for the title claim, a redundant standalone free_guess_active
-- write (fired on EVERY call even when the value was unchanged), plus separate
-- artist / wrong_buzz writes on the relevant paths -- then two trailing SELECTs to
-- re-read the team score and the token-claim columns for the return row. Each
-- game_rounds UPDATE is a separate Realtime ROUND_CHANGE fanned out to every
-- client (game_rounds is published with REPLICA IDENTITY FULL), and the SELECTs
-- are extra round-trips inside the hot manager click.
--
-- After: one combined UPDATE computes every changed column from branch vars via
-- CASE, writes game_rounds at most ONCE per attempt, and RETURNs the resulting
-- claim columns straight into the locals -- so a Correct Song emits ONE
-- ROUND_CHANGE instead of two, and the no-op "Continue" (no toggles, no wrong,
-- free_guess unchanged) emits ZERO game_rounds writes instead of one. The team
-- score read folds into the score UPDATE's RETURNING on the scoring path.
--
-- Behavior is preserved exactly: the CASE ELSE branches keep each unset column at
-- its current value, and the write is skipped only when nothing would change
-- (no title/artist/wrong AND free_guess_active already equals its new value), in
-- which case the claim columns are unchanged and the values read at the top of the
-- function are still the correct return values. All the guard/validation logic,
-- the free-guess flag rules (mig 017), the wrong-buzz -3 waiver, the attempts-row
-- insert, and the buzz-lock handling (mig 018/019: wrong clears, correct refreshes
-- locked_at, no-op leaves it untouched) are unchanged.
--
-- Signature is IDENTICAL to mig 034's 6-arg tokenised award_attempt (no DEFAULTs;
-- adding one would make the overload ambiguous -- see the mig-021 lesson). The
-- token lookup still LEFT JOINs game_secrets (mig 034). CREATE OR REPLACE keeps
-- PostgREST routing and the anon EXECUTE grant intact.
--
-- Idempotent: CREATE OR REPLACE.

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
  IF COALESCE(p_title, 0) > 0
     OR COALESCE(p_artist, 0) > 0
     OR COALESCE(p_wrong_buzz, 0) > 0
     OR v_new_free_guess IS DISTINCT FROM COALESCE(v_free_guess, false) THEN
    UPDATE game_rounds gr
       SET title_claimed_by   = CASE WHEN COALESCE(p_title, 0) > 0  THEN v_team_id ELSE gr.title_claimed_by END,
           title_points       = CASE WHEN COALESCE(p_title, 0) > 0  THEN p_title   ELSE gr.title_points END,
           artist_claimed_by  = CASE WHEN COALESCE(p_artist, 0) > 0 THEN v_team_id ELSE gr.artist_claimed_by END,
           artist_points      = CASE WHEN COALESCE(p_artist, 0) > 0 THEN p_artist  ELSE gr.artist_points END,
           wrong_buzz_penalty = CASE WHEN COALESCE(p_wrong_buzz, 0) > 0 THEN p_wrong_buzz ELSE gr.wrong_buzz_penalty END,
           free_guess_active  = v_new_free_guess
     WHERE gr.id = p_round_id
    RETURNING gr.title_claimed_by, gr.artist_claimed_by
      INTO v_title_claimed, v_artist_claimed;
  END IF;

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

  RETURN QUERY SELECT v_team_id, v_delta, COALESCE(v_score, 0),
                      v_title_claimed, v_artist_claimed;
END $$;

-- Re-grant EXECUTE (idempotent; CREATE OR REPLACE already preserved it).
GRANT EXECUTE ON FUNCTION award_attempt(text, uuid, integer, integer, integer, uuid)
  TO anon, authenticated, service_role;
