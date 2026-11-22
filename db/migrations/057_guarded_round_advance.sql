-- 057_guarded_round_advance.sql
-- A peek belongs to the round from which it was requested. The guarded
-- select_next_song overload accepts it only while that round is still current.
-- Migrate before publishing the frontend that calls the new signature.

BEGIN;

CREATE OR REPLACE FUNCTION select_next_song(
  p_game_code     text,
  p_manager_token uuid,
  p_song_id       uuid,
  p_expected_round integer
)
RETURNS TABLE(
  round_id      uuid,
  round_number  integer,
  song_id       uuid,
  song_title    text,
  song_artist   text,
  youtube_id    text,
  start_time    integer,
  is_soundtrack boolean,
  release_year  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_token uuid;
  v_game_ended_at  timestamptz;
  v_genres         uuid[];
  v_decades        integer[];
  v_chosen_song    uuid;
  v_round_id       uuid;
  v_round_number   integer;
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

  -- Serialize advances without reversing the round/game row lock order used
  -- by scoring. Re-read the round after waiting for another host's commit.
  PERFORM pg_advisory_xact_lock(194784, hashtext(p_game_code));
  SELECT ag.ended_at, ag.selected_genres, ag.selected_decades, ag.round_number
    INTO v_game_ended_at, v_genres, v_decades, v_round_number
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_game_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'game_ended' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_round IS NOT NULL AND p_expected_round <> v_round_number THEN
    RAISE EXCEPTION 'stale_round' USING ERRCODE = 'P0001';
  END IF;

  IF v_genres IS NULL OR cardinality(v_genres) = 0 THEN
    RAISE EXCEPTION 'no_genres_selected' USING ERRCODE = '22023';
  END IF;

  IF p_song_id IS NULL THEN
    v_chosen_song := pick_next_song(p_game_code, v_genres, v_decades);
    IF v_chosen_song IS NULL THEN
      RAISE EXCEPTION 'no_more_songs' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_expected_round IS NULL THEN
      -- Preserve older clients and deliberate explicit selections.
      PERFORM 1 FROM songs WHERE id = p_song_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0002';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM songs s
       WHERE s.id = p_song_id
         AND s.unavailable_at IS NULL
         AND (coalesce(cardinality(v_decades), 0) = 0
              OR (s.release_year / 10 * 10) = ANY (v_decades))
         AND EXISTS (
           SELECT 1 FROM song_genres sg
            WHERE sg.song_id = s.id AND sg.genre_id = ANY (v_genres)
         )
         AND NOT EXISTS (
           SELECT 1 FROM game_rounds gr
            WHERE gr.game_code = p_game_code AND gr.song_id = s.id
         )
    ) THEN
      RAISE EXCEPTION 'song_no_longer_eligible' USING ERRCODE = 'P0001';
    END IF;
    v_chosen_song := p_song_id;
  END IF;

  v_round_id := start_round(p_game_code::char(6), v_chosen_song);

  SELECT ag.round_number INTO v_round_number
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  RETURN QUERY
    SELECT v_round_id,
           v_round_number,
           s.id,
           s.title,
           s.artist,
           s.youtube_id::text,
           s.start_time,
           EXISTS (
             SELECT 1
               FROM song_genres sg
               JOIN genres g ON g.id = sg.genre_id
              WHERE sg.song_id = s.id
                AND g.slug IN ('soundtracks', 'israeli-soundtracks')
           ) AS is_soundtrack,
           s.release_year
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

-- The original signature retains the existing manual-override semantics.
CREATE OR REPLACE FUNCTION select_next_song(
  p_game_code     text,
  p_manager_token uuid,
  p_song_id       uuid DEFAULT NULL
)
RETURNS TABLE(
  round_id      uuid,
  round_number  integer,
  song_id       uuid,
  song_title    text,
  song_artist   text,
  youtube_id    text,
  start_time    integer,
  is_soundtrack boolean,
  release_year  integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM select_next_song(p_game_code, p_manager_token, p_song_id, NULL::integer);
$$;

DROP FUNCTION IF EXISTS peek_next_song(text, uuid);

CREATE FUNCTION peek_next_song(
  p_game_code     text,
  p_manager_token uuid
)
RETURNS TABLE(
  song_id       uuid,
  youtube_id    text,
  start_time    integer,
  song_title    text,
  song_artist   text,
  is_soundtrack boolean,
  release_year  integer,
  expected_round integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_token uuid;
  v_game_ended_at  timestamptz;
  v_genres         uuid[];
  v_decades        integer[];
  v_chosen_song    uuid;
  v_expected_round integer;
BEGIN
  SELECT gs.manager_token, ag.ended_at, ag.selected_genres, ag.selected_decades, ag.round_number
    INTO v_expected_token, v_game_ended_at, v_genres, v_decades, v_expected_round
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

  IF v_genres IS NULL OR cardinality(v_genres) = 0 THEN
    RAISE EXCEPTION 'no_genres_selected' USING ERRCODE = '22023';
  END IF;

  v_chosen_song := pick_next_song(p_game_code, v_genres, v_decades);

  IF v_chosen_song IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT s.id,
           s.youtube_id::text,
           s.start_time,
           s.title,
           s.artist,
           EXISTS (
             SELECT 1
               FROM song_genres sg
               JOIN genres g ON g.id = sg.genre_id
              WHERE sg.song_id = s.id
                AND g.slug IN ('soundtracks', 'israeli-soundtracks')
           ) AS is_soundtrack,
           s.release_year,
           v_expected_round
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

REVOKE EXECUTE ON FUNCTION select_next_song(text, uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION peek_next_song(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION select_next_song(text, uuid, uuid, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION peek_next_song(text, uuid)
  TO anon, authenticated, service_role;

COMMIT;
