-- 059_guard_scoring_by_buzz.sql
-- A verdict or release belongs to the buzz observed by the host.
BEGIN;

ALTER TABLE public.active_games ADD COLUMN IF NOT EXISTS buzz_attempt_id integer;

CREATE OR REPLACE FUNCTION public.broadcast_buzz_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.buzz_revision := OLD.buzz_revision + 1;
  NEW.buzz_attempt_id := CASE
    WHEN NEW.buzzed_team_id IS NULL THEN NULL
    WHEN NEW.buzzed_team_id IS DISTINCT FROM OLD.buzzed_team_id
      THEN NEW.buzz_revision
    ELSE COALESCE(OLD.buzz_attempt_id, NEW.buzz_revision)
  END;

  IF OLD.buzzed_team_id IS NULL
     AND NEW.buzzed_team_id IS NOT NULL
     AND NEW.current_round_id IS NOT NULL
     AND NEW.status = 'playing'
     AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object(
          'game_code', NEW.game_code,
          'status', NEW.status,
          'selected_genres', NEW.selected_genres,
          'selected_decades', NEW.selected_decades,
          'round_number', NEW.round_number,
          'current_song_id', NEW.current_song_id,
          'started_at', NEW.started_at,
          'ended_at', NEW.ended_at,
          'expires_at', NEW.expires_at,
          'current_round_id', NEW.current_round_id,
          'buzzed_team_id', NEW.buzzed_team_id,
          'locked_at', NEW.locked_at,
          'buzz_attempt_id', NEW.buzz_attempt_id,
          'buzz_revision', NEW.buzz_revision
        ),
        'buzz_locked',
        'buzz:' || NEW.game_code,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Buzz Broadcast failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END
$$;

-- Backfill locks already held during rollout. The trigger does not rebroadcast them.
UPDATE public.active_games SET buzz_attempt_id = buzz_revision
 WHERE buzzed_team_id IS NOT NULL AND buzz_attempt_id IS NULL;

CREATE OR REPLACE FUNCTION award_attempt(
  p_game_code     text,
  p_round_id      uuid,
  p_correct_title  boolean,
  p_correct_artist boolean,
  p_wrong          boolean,
  p_manager_token  uuid,
  p_buzz_attempt_id integer
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
  v_buzz_attempt_id  integer;
  v_current_round_id uuid;
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

  -- Use the same per-game lock as select_next_song so concurrent host requests
  -- validate after the previous request commits. buzz_in never takes this lock.
  PERFORM pg_advisory_xact_lock(194784, hashtext(p_game_code));

  -- The database derives the point magnitudes. NULL flags act as false.
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

  SELECT ag.buzzed_team_id, ag.buzz_attempt_id, ag.current_round_id, ag.ended_at
    INTO v_team_id, v_buzz_attempt_id, v_current_round_id, v_game_ended_at
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_game_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'game_ended' USING ERRCODE = 'P0001';
  END IF;
  IF v_current_round_id IS DISTINCT FROM p_round_id
     OR v_buzz_attempt_id IS DISTINCT FROM p_buzz_attempt_id
     OR (v_team_id IS NOT NULL AND p_buzz_attempt_id IS NULL) THEN
    RAISE EXCEPTION 'stale_buzz' USING ERRCODE = 'P0001';
  END IF;
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
    SELECT gt.score INTO v_score FROM game_teams gt WHERE gt.id = v_team_id FOR KEY SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_buzz' USING ERRCODE = 'P0001';
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

  -- Keep team, round, then game row ordering. A kick, game end, or other
  -- concurrent lock change must roll back the score and attempt already written.
  IF v_outcome IS NULL THEN
    PERFORM 1 FROM active_games
     WHERE game_code = p_game_code
       AND ended_at IS NULL
       AND current_round_id = p_round_id
       AND buzz_attempt_id = p_buzz_attempt_id
     FOR NO KEY UPDATE;
  ELSE
    UPDATE active_games
       SET buzzed_team_id = CASE WHEN v_wrong_pts > 0 THEN NULL ELSE buzzed_team_id END,
           locked_at = CASE WHEN v_wrong_pts > 0 THEN NULL ELSE now() END
     WHERE game_code = p_game_code
       AND ended_at IS NULL
       AND current_round_id = p_round_id
       AND buzz_attempt_id = p_buzz_attempt_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_buzz' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT v_team_id, v_delta, COALESCE(v_score, 0),
                      v_title_claimed, v_artist_claimed;
END $$;

CREATE OR REPLACE FUNCTION release_buzz_lock(
  p_game_code     text,
  p_manager_token uuid,
  p_buzz_attempt_id integer
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

  PERFORM pg_advisory_xact_lock(194784, hashtext(p_game_code));

  UPDATE active_games
     SET buzzed_team_id = NULL, locked_at = NULL
   WHERE game_code = p_game_code
     AND ended_at IS NULL
     AND buzz_attempt_id IS NOT DISTINCT FROM p_buzz_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_buzz' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- An already-open console has no attempt ID at click time. Its original
-- signature pins the attempt at RPC entry and shares the guarded transaction.
CREATE OR REPLACE FUNCTION award_attempt(
  p_game_code      text,
  p_round_id       uuid,
  p_correct_title  boolean,
  p_correct_artist boolean,
  p_wrong          boolean,
  p_manager_token  uuid
)
RETURNS TABLE(
  team_id           uuid,
  points_delta      integer,
  team_total_score  integer,
  title_claimed_by  uuid,
  artist_claimed_by uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM award_attempt(
    p_game_code, p_round_id, p_correct_title, p_correct_artist, p_wrong, p_manager_token,
    (SELECT ag.buzz_attempt_id FROM active_games ag WHERE ag.game_code = p_game_code)
  );
$$;

CREATE OR REPLACE FUNCTION release_buzz_lock(p_game_code text, p_manager_token uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT release_buzz_lock(
    p_game_code, p_manager_token,
    (SELECT ag.buzz_attempt_id FROM active_games ag WHERE ag.game_code = p_game_code)
  );
$$;

REVOKE ALL ON FUNCTION
  award_attempt(text, uuid, boolean, boolean, boolean, uuid, integer),
  release_buzz_lock(text, uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  award_attempt(text, uuid, boolean, boolean, boolean, uuid, integer),
  release_buzz_lock(text, uuid, integer)
  TO anon, authenticated, service_role;

COMMIT;
