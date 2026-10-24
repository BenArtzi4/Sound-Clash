-- 050_next_song_release_year.sql
-- Host-only song year: select_next_song and peek_next_song also return the
-- song's release_year, so the manager console can show it next to the title.
-- The host may ask the teams for the year and award it with the existing Bonus
-- button; nothing about scoring changes. Players and the Display never see it.
--
-- Today both RPCs return title / artist / is_soundtrack but not the year, and
-- the console renders the new round's card from those rows (peek in-gesture on
-- the fast path, then the select_next_song row; mig 038). Fetching the year in a
-- second read would flash the card without it for a round-trip, so the year
-- rides on the same rows instead.
--
-- The RETURNS TABLE gains a column, so CREATE OR REPLACE is not allowed
-- (Postgres 42P13 "cannot change return type"): DROP then CREATE, as migrations
-- 025, 027 and 038 did. Each name has a single signature, so the drops are
-- unambiguous. The new column goes LAST, so every existing column keeps its
-- position and the frontend's existing reads are unaffected. Bodies are
-- VERBATIM from migration 048 apart from the extra output column (the pick still
-- delegates to pick_next_song, rewritten in 049). Re-GRANT after each CREATE:
-- the drop clears the old grants.
--
-- One transaction, so a live game's next RPC sees either the old function or
-- the new one, never neither.
--
-- Idempotent: DROP ... IF EXISTS then CREATE; re-runnable.

BEGIN;

-- ---------------------------------------------------------------------------
-- select_next_song
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS select_next_song(text, uuid, uuid);

CREATE FUNCTION select_next_song(
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
  SELECT gs.manager_token, ag.ended_at, ag.selected_genres, ag.selected_decades
    INTO v_expected_token, v_game_ended_at, v_genres, v_decades
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

  IF p_song_id IS NOT NULL THEN
    -- Manual pick: deliberately NOT filtered by unavailable_at. The host
    -- explicitly chose this song (e.g. the prebuffered peek commit or a
    -- restart); trusting that choice can never surprise-skip a round.
    PERFORM 1 FROM songs WHERE id = p_song_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_chosen_song := p_song_id;
  ELSE
    -- Balanced genre turns (mig 048), shared with peek_next_song.
    v_chosen_song := pick_next_song(p_game_code, v_genres, v_decades);

    IF v_chosen_song IS NULL THEN
      RAISE EXCEPTION 'no_more_songs' USING ERRCODE = '22023';
    END IF;
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

-- The DROP cleared grants; restore them (anon-callable, token-gated in-body).
GRANT EXECUTE ON FUNCTION select_next_song(text, uuid, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- peek_next_song
-- ---------------------------------------------------------------------------

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
BEGIN
  SELECT gs.manager_token, ag.ended_at, ag.selected_genres, ag.selected_decades
    INTO v_expected_token, v_game_ended_at, v_genres, v_decades
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
           s.release_year
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

-- The DROP cleared grants; restore them (anon-callable, token-gated in-body).
GRANT EXECUTE ON FUNCTION peek_next_song(text, uuid)
  TO anon, authenticated, service_role;

COMMIT;
