-- 047_uniform_song_pick.sql
-- Task 2 of PLAN-2026-07-16-loading-random-decades.md (Option B): make the
-- random song pick uniform PER SONG instead of equal-weight PER GENRE.
--
-- The old pick (migrations 022/029/045) was a two-stage draw: pick ONE genre
-- uniformly, then one song uniformly within it. That deliberately gave every
-- selected genre equal airtime -- but it made per-song probability non-uniform:
--   * small-genre inflation: a 40-song genre selected alongside 200-song Rock
--     got each of its songs ~5x the odds of a Rock song (50% of airtime vs 17%);
--   * multi-genre boost: a song tagged in two selected genres was ~2x as likely
--     as a single-genre song.
--
-- Maintainer decision (2026-07-16): "no song has priority" -- every eligible
-- song equally likely. This migration replaces the pick with a single
-- de-duplicated draw:
--   * `eligible` becomes ONE ROW PER SONG (no genre fan-out), selected via
--     EXISTS against song_genres so a multi-genre song is counted exactly once;
--   * the `chosen_genre` stage is dropped entirely;
--   * a plain `ORDER BY random() LIMIT 1` over the deduped set is uniform by
--     construction -- no counts table needed.
--
-- Accepted trade-off: a 40-song niche genre gets only ~17% of rounds alongside
-- 200-song Rock (proportional to its share of the eligible pool).
--
-- Everything else is copied VERBATIM from migration 045: signatures and RETURNS
-- shapes are unchanged (grants preserved, PostgREST routing untouched, zero
-- frontend change), as are the token/game-state guard clauses, the `p_song_id`
-- override branch (still deliberately unfiltered), the decade filter, the
-- dead-video `unavailable_at IS NULL` skip, the start_round call, the
-- no_more_songs / return-zero-rows behaviour, and the computed is_soundtrack.
--
-- Idempotent: CREATE OR REPLACE with unchanged signatures/return types, so
-- grants are preserved. If anyone DROPs + CREATEs instead, they must re-GRANT
-- anon EXECUTE.

-- ---------------------------------------------------------------------------
-- select_next_song: body verbatim from migration 045; only the `eligible`
-- CTE + pick change (drop the chosen_genre stage; one row per song).
-- ---------------------------------------------------------------------------

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
    WITH played AS (
      SELECT gr.song_id AS sid
        FROM game_rounds gr
       WHERE gr.game_code = p_game_code
         AND gr.song_id IS NOT NULL
    ),
    eligible AS (
      -- Uniform-per-song (mig 047): one row per song, not per (genre,song)
      -- pair. EXISTS matches a song that belongs to ANY selected genre and
      -- counts it once, so multi-genre songs get no boost and every eligible
      -- song is drawn with equal probability by the ORDER BY random() below.
      SELECT s.id AS sid
        FROM songs s
       WHERE EXISTS (
               SELECT 1
                 FROM song_genres sg
                WHERE sg.song_id = s.id
                  AND sg.genre_id = ANY (v_genres)
             )
         AND s.id NOT IN (SELECT played.sid FROM played)
         AND (
               cardinality(v_decades) = 0
               OR (s.release_year / 10 * 10) = ANY (v_decades)
             )
         AND s.unavailable_at IS NULL  -- dead-video auto-skip (mig 045)
    )
    SELECT e.sid INTO v_chosen_song
      FROM eligible e
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

-- ---------------------------------------------------------------------------
-- peek_next_song: body verbatim from migration 045 plus the same uniform pick,
-- keeping the peeked candidate in lockstep with what select_next_song's
-- random path could pick.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION peek_next_song(
  p_game_code     text,
  p_manager_token uuid
)
RETURNS TABLE(
  song_id       uuid,
  youtube_id    text,
  start_time    integer,
  song_title    text,
  song_artist   text,
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

  WITH played AS (
    SELECT gr.song_id AS sid
      FROM game_rounds gr
     WHERE gr.game_code = p_game_code
       AND gr.song_id IS NOT NULL
  ),
  eligible AS (
    -- Uniform-per-song (mig 047): one row per song, not per (genre,song)
    -- pair. Kept byte-for-byte in lockstep with select_next_song's random
    -- path so a peeked candidate is never one the eventual commit would reject.
    SELECT s.id AS sid
      FROM songs s
     WHERE EXISTS (
             SELECT 1
               FROM song_genres sg
              WHERE sg.song_id = s.id
                AND sg.genre_id = ANY (v_genres)
           )
       AND s.id NOT IN (SELECT played.sid FROM played)
       AND (
             cardinality(v_decades) = 0
             OR (s.release_year / 10 * 10) = ANY (v_decades)
           )
       AND s.unavailable_at IS NULL  -- dead-video auto-skip (mig 045)
  )
  SELECT e.sid INTO v_chosen_song
    FROM eligible e
   ORDER BY random()
   LIMIT 1;

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
           ) AS is_soundtrack
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;
