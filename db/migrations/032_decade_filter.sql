-- 032_decade_filter.sql
-- Adds an optional release-decade filter to game creation. A host can now pick a
-- set of decades (the 80s = 1980, the 90s = 1990, ...) alongside genres; the song
-- picker then only serves unplayed songs whose genre is selected AND whose
-- release_year (mig 031) falls in one of the chosen decades.
--
-- Storage mirrors selected_genres: a NOT NULL integer[] DEFAULT '{}' on
-- active_games, set once at POST /games. An empty array means "no decade limit"
-- (today's behaviour), so the feature is purely additive and existing games and
-- tests are unaffected.
--
-- The picker change is one predicate added to the shared `eligible` CTE in BOTH
-- select_next_song (mig 028) and peek_next_song (mig 029) -- they must stay in
-- lockstep, or prebuffer (peek) would cue songs the commit (select) then rejects.
-- A song's decade is the integer-division floor: (release_year / 10 * 10). A NULL
-- release_year matches no specific decade, so unknown-year songs are excluded
-- when a decade is chosen and included when none is. Genres stay required;
-- decades stay optional, so no new guard.
--
-- Both functions keep their exact signature and RETURNS shape, so a plain
-- CREATE OR REPLACE suffices (no DROP FUNCTION, PostgREST routing untouched).
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE are re-runnable.

BEGIN;

ALTER TABLE active_games
  ADD COLUMN IF NOT EXISTS selected_decades integer[] NOT NULL DEFAULT '{}';

-- select_next_song: identical to migration 028 except it loads selected_decades
-- and filters the `eligible` CTE by decade.
CREATE OR REPLACE FUNCTION select_next_song(
  p_game_code      text,
  p_manager_token  uuid,
  p_song_id        uuid DEFAULT NULL
)
RETURNS TABLE(
  round_id      uuid,
  round_number  integer,
  song_id       uuid,
  song_title    text,
  song_artist   text,
  youtube_id    text,
  start_time    integer,
  is_soundtrack boolean
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
  SELECT ag.manager_token, ag.ended_at, ag.selected_genres, ag.selected_decades
    INTO v_expected_token, v_game_ended_at, v_genres, v_decades
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

  IF v_genres IS NULL OR cardinality(v_genres) = 0 THEN
    RAISE EXCEPTION 'no_genres_selected' USING ERRCODE = '22023';
  END IF;

  IF p_song_id IS NOT NULL THEN
    PERFORM 1 FROM songs WHERE id = p_song_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_chosen_song := p_song_id;
  ELSE
    WITH played AS (
      SELECT gr.song_id AS sid
        FROM game_rounds gr
       WHERE gr.game_code = p_game_code
         AND gr.song_id IS NOT NULL
    ),
    eligible AS (
      SELECT sg.genre_id AS gid, sg.song_id AS sid
        FROM song_genres sg
        JOIN songs s ON s.id = sg.song_id
       WHERE sg.genre_id = ANY (v_genres)
         AND sg.song_id NOT IN (SELECT played.sid FROM played)
         AND (
               cardinality(v_decades) = 0
               OR (s.release_year / 10 * 10) = ANY (v_decades)
             )
    ),
    chosen_genre AS (
      SELECT eligible.gid
        FROM eligible
       GROUP BY eligible.gid
       ORDER BY random()
       LIMIT 1
    )
    SELECT e.sid INTO v_chosen_song
      FROM eligible e
      JOIN chosen_genre cg ON cg.gid = e.gid
     ORDER BY random()
     LIMIT 1;

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
           ) AS is_soundtrack
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

GRANT EXECUTE ON FUNCTION select_next_song(text, uuid, uuid)
  TO anon, authenticated, service_role;

-- peek_next_song: identical to migration 029 except it loads selected_decades
-- and applies the SAME decade predicate to the `eligible` CTE.
CREATE OR REPLACE FUNCTION peek_next_song(
  p_game_code      text,
  p_manager_token  uuid
)
RETURNS TABLE(
  song_id     uuid,
  youtube_id  text,
  start_time  integer
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
  SELECT ag.manager_token, ag.ended_at, ag.selected_genres, ag.selected_decades
    INTO v_expected_token, v_game_ended_at, v_genres, v_decades
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

  IF v_genres IS NULL OR cardinality(v_genres) = 0 THEN
    RAISE EXCEPTION 'no_genres_selected' USING ERRCODE = '22023';
  END IF;

  WITH played AS (
    SELECT gr.song_id AS sid
      FROM game_rounds gr
     WHERE gr.game_code = p_game_code
       AND gr.song_id IS NOT NULL
  ),
  eligible AS (
    SELECT sg.genre_id AS gid, sg.song_id AS sid
      FROM song_genres sg
      JOIN songs s ON s.id = sg.song_id
     WHERE sg.genre_id = ANY (v_genres)
       AND sg.song_id NOT IN (SELECT played.sid FROM played)
       AND (
             cardinality(v_decades) = 0
             OR (s.release_year / 10 * 10) = ANY (v_decades)
           )
  ),
  chosen_genre AS (
    SELECT eligible.gid
      FROM eligible
     GROUP BY eligible.gid
     ORDER BY random()
     LIMIT 1
  )
  SELECT e.sid INTO v_chosen_song
    FROM eligible e
    JOIN chosen_genre cg ON cg.gid = e.gid
   ORDER BY random()
   LIMIT 1;

  IF v_chosen_song IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT s.id,
           s.youtube_id::text,
           s.start_time
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

GRANT EXECUTE ON FUNCTION peek_next_song(text, uuid)
  TO anon, authenticated, service_role;

COMMIT;
