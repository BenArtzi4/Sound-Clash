-- 048_balanced_genre_turns.sql
-- Balanced genre turns: share the rounds evenly between the selected genres.
--
-- Migration 047 made the random pick uniform PER SONG, so each genre's share of
-- rounds became its share of the eligible pool. With the 2026-10 catalog that
-- let a big genre drown the rest: in a Mizrahit + Israeli Pop + Israeli Rap game
-- limited to the 2010s + 2020s (117 / 42 / 42 eligible songs) Mizrahit took ~58%
-- of rounds, with runs of 8 in a row. A player reported exactly that.
--
-- Maintainer decision (2026-10-01): "balanced turns". The pick is two-stage
-- again -- a genre first, then a uniformly random unplayed song inside it --
-- but the genre is no longer drawn uniformly at random (which still let luck
-- open gaps of 8+ songs in a 30-round game). Instead:
--
--   * count the songs already played in this game per selected genre (a song
--     tagged in several selected genres counts for each of them);
--   * only genres that still have an eligible song take part ("alive");
--   * a genre may go next unless it is already MORE than one song ahead of the
--     least-played alive genre (count <= min + 1); pick uniformly among those.
--
-- Result: genre counts never drift more than 2 apart, yet it is not a fixed
-- rotation, so players cannot predict the next genre (the field is narrowed to
-- one genre in only ~2-11% of rounds, vs 13-33% for a strict rotation). A genre
-- that runs out simply drops out of "alive" and the others keep sharing.
--
-- Accepted trade-off (the one 047 avoided): songs in small genres come up more
-- often ACROSS games, because a 31-song genre now gets the same airtime as a
-- 250-song one. A song tagged in two selected genres is reachable through both,
-- but playing it also counts as a turn for both, so genre balance holds.
--
-- Shape: the pick moves into one internal helper, pick_next_song, which both
-- select_next_song (random path) and peek_next_song call -- they must agree, or
-- the prebuffered video would not be the song that plays. The helper is not
-- browser-callable (revoked per the mig-020 pattern); the two SECURITY DEFINER
-- RPCs call it as their owner. Everything else in both RPCs is VERBATIM from
-- migration 047: signatures and RETURNS shapes (so grants and PostgREST routing
-- are untouched and the frontend needs no change), the token/game-state guards,
-- the unfiltered p_song_id override, the decade filter, the dead-video skip,
-- start_round, the no_more_songs / zero-rows behaviour and is_soundtrack.
--
-- Idempotent: CREATE OR REPLACE throughout (unchanged signatures, so grants are
-- preserved) plus a re-runnable REVOKE/GRANT on the new helper.

-- ---------------------------------------------------------------------------
-- pick_next_song: the shared balanced-turns picker. Returns NULL when no
-- eligible song is left.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pick_next_song(
  p_game_code text,
  p_genres    uuid[],
  p_decades   integer[]
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  WITH played AS (
    SELECT gr.song_id AS sid
      FROM game_rounds gr
     WHERE gr.game_code = p_game_code
       AND gr.song_id IS NOT NULL
  ),
  -- (genre, song) pairs still playable in this game. A multi-genre song
  -- appears once per selected genre it belongs to.
  eligible AS (
    SELECT sg.genre_id AS gid, s.id AS sid
      FROM songs s
      JOIN song_genres sg
        ON sg.song_id = s.id
       AND sg.genre_id = ANY (p_genres)
     WHERE s.id NOT IN (SELECT played.sid FROM played)
       AND (
             coalesce(cardinality(p_decades), 0) = 0
             OR (s.release_year / 10 * 10) = ANY (p_decades)
           )
       AND s.unavailable_at IS NULL  -- dead-video auto-skip (mig 045)
  ),
  -- Turns each selected genre has already had: songs played in this game that
  -- belong to it (a song in two selected genres counts for both).
  turns AS (
    SELECT g.gid, count(sg.song_id) AS n
      FROM (SELECT DISTINCT unnest(p_genres) AS gid) g
      LEFT JOIN song_genres sg
        ON sg.genre_id = g.gid
       AND sg.song_id IN (SELECT played.sid FROM played)
     GROUP BY g.gid
  ),
  alive AS (
    SELECT t.gid, t.n
      FROM turns t
     WHERE EXISTS (SELECT 1 FROM eligible e WHERE e.gid = t.gid)
  ),
  chosen_genre AS (
    SELECT a.gid
      FROM alive a
     WHERE a.n <= (SELECT min(a2.n) FROM alive a2) + 1
     ORDER BY random()
     LIMIT 1
  )
  SELECT e.sid
    FROM eligible e
    JOIN chosen_genre c ON c.gid = e.gid
   ORDER BY random()
   LIMIT 1;
$$;

-- Internal helper: hosted Supabase auto-grants EXECUTE on new functions, so
-- revoke per the mig-020 defense-in-depth pattern. Only the two SECURITY
-- DEFINER pickers below call it, as their owner.
REVOKE EXECUTE ON FUNCTION pick_next_song(text, uuid[], integer[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pick_next_song(text, uuid[], integer[])
  TO service_role;

-- ---------------------------------------------------------------------------
-- select_next_song: body verbatim from migration 047; only the random path
-- now delegates to pick_next_song.
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
           ) AS is_soundtrack
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

-- ---------------------------------------------------------------------------
-- peek_next_song: body verbatim from migration 047; the pick delegates to the
-- same pick_next_song, so a peeked candidate is always one select_next_song's
-- random path could have chosen at this point of the game.
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
           ) AS is_soundtrack
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;
