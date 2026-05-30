-- 028_derive_is_soundtrack_from_genre.sql
-- Soundtrack-ness was stored twice: as the songs.is_soundtrack boolean AND as
-- membership in the Soundtracks / Israeli Soundtracks genres. The two drifted
-- (28 songs sat in a soundtrack genre with is_soundtrack=false, so they played
-- as normal rounds). Genre membership is already a superset of the boolean, so
-- we collapse to a single source of truth:
--
--   a song is a soundtrack  <=>  it belongs to a genre whose slug is in
--                                ('soundtracks', 'israeli-soundtracks').
--
-- This migration:
--   1. Drops songs.is_soundtrack.
--   2. Re-issues select_next_song with the SAME signature and RETURNS shape as
--      migration 027; the only change is that the is_soundtrack column is now
--      COMPUTED via EXISTS over song_genres -> genres instead of read from the
--      dropped column. Because the RETURNS TABLE shape is unchanged, no DROP
--      FUNCTION is needed (CREATE OR REPLACE suffices) and PostgREST routing is
--      untouched.
--
-- Idempotent: DROP COLUMN IF EXISTS + CREATE OR REPLACE are both re-runnable.
-- The new function body no longer references songs.is_soundtrack, so dropping
-- the column before replacing the function is safe.

BEGIN;

-- Step 1: drop the redundant per-song boolean.
ALTER TABLE songs DROP COLUMN IF EXISTS is_soundtrack;

-- Step 2: re-issue select_next_song. Body is identical to migration 027 except
-- the final SELECT derives is_soundtrack from genre membership.
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
  v_chosen_song    uuid;
  v_round_id       uuid;
  v_round_number   integer;
BEGIN
  SELECT ag.manager_token, ag.ended_at, ag.selected_genres
    INTO v_expected_token, v_game_ended_at, v_genres
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
       WHERE sg.genre_id = ANY (v_genres)
         AND sg.song_id NOT IN (SELECT played.sid FROM played)
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

COMMIT;
