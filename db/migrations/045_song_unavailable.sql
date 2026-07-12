-- 045_song_unavailable.sql
-- I-Liveness Phase 2 (issue #248): auto-skip confirmed-dead YouTube videos.
--
-- Phase 1 (PR #252) added the report-only admin scan
-- (POST /admin/songs/check-availability). This migration adds the persistence
-- and the skip so a dead video never reaches a round:
--
--   1. songs.unavailable_at (timestamptz, NULL = playable). NULL for every
--      existing row, so RPC behavior is byte-identical until a
--      scan-with-commit writes a verdict -- additive and safe to apply
--      BEFORE the backend deploy (lessons-learned F-P0-4).
--   2. select_next_song / peek_next_song: the random-pick `eligible` CTE
--      gains ONE predicate (AND s.unavailable_at IS NULL). Bodies are
--      otherwise copied verbatim from their latest definitions (migrations
--      034 and 038 respectively). The explicit p_song_id override branch of
--      select_next_song is deliberately NOT filtered -- a host forcing a
--      specific song is a deliberate act.
--   3. set_song_availability(p_flag_ids, p_clear_ids): the service-role-only
--      writer the backend calls when the admin scan runs with commit=true.
--      Flagging sets unavailable_at = now() only where it is currently NULL
--      (keeps the first-noticed timestamp and avoids rewriting rows on every
--      re-scan); clearing sets it back to NULL only where it is currently
--      NOT NULL (a restored/transient video becomes eligible again). Returns
--      the counts of rows actually changed. now() is evaluated in the DB so
--      no timestamp ever crosses the HTTP boundary.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE (signatures and
-- return types unchanged, so grants are preserved) + re-runnable
-- REVOKE/GRANT.

ALTER TABLE songs ADD COLUMN IF NOT EXISTS unavailable_at timestamptz;

COMMENT ON COLUMN songs.unavailable_at IS
  'When the availability scan last confirmed this YouTube video dead (oEmbed 404). NULL = playable; non-NULL songs are skipped by the auto-pickers (mig 045).';

-- ---------------------------------------------------------------------------
-- select_next_song: body verbatim from migration 034 plus the one
-- unavailable_at predicate in the `eligible` CTE.
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
      SELECT sg.genre_id AS gid, sg.song_id AS sid
        FROM song_genres sg
        JOIN songs s ON s.id = sg.song_id
       WHERE sg.genre_id = ANY (v_genres)
         AND sg.song_id NOT IN (SELECT played.sid FROM played)
         AND (
               cardinality(v_decades) = 0
               OR (s.release_year / 10 * 10) = ANY (v_decades)
             )
         AND s.unavailable_at IS NULL  -- dead-video auto-skip (mig 045)
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

-- ---------------------------------------------------------------------------
-- peek_next_song: body verbatim from migration 038 plus the same predicate,
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
    SELECT sg.genre_id AS gid, sg.song_id AS sid
      FROM song_genres sg
      JOIN songs s ON s.id = sg.song_id
     WHERE sg.genre_id = ANY (v_genres)
       AND sg.song_id NOT IN (SELECT played.sid FROM played)
       AND (
             cardinality(v_decades) = 0
             OR (s.release_year / 10 * 10) = ANY (v_decades)
           )
       AND s.unavailable_at IS NULL  -- dead-video auto-skip (mig 045)
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

-- ---------------------------------------------------------------------------
-- set_song_availability: persists scan verdicts. Backend-only (service_role).
-- No DEFAULTs on the parameters (mig-021 lesson: keep PostgREST named-arg
-- routing unambiguous).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_song_availability(
  p_flag_ids  uuid[],
  p_clear_ids uuid[]
)
RETURNS TABLE(flagged integer, cleared integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flagged integer := 0;
  v_cleared integer := 0;
BEGIN
  UPDATE songs
     SET unavailable_at = now()
   WHERE id = ANY (COALESCE(p_flag_ids, '{}'::uuid[]))
     AND unavailable_at IS NULL;
  GET DIAGNOSTICS v_flagged = ROW_COUNT;

  UPDATE songs
     SET unavailable_at = NULL
   WHERE id = ANY (COALESCE(p_clear_ids, '{}'::uuid[]))
     AND unavailable_at IS NOT NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RETURN QUERY SELECT v_flagged, v_cleared;
END $$;

-- Backend-only: hosted Supabase auto-grants EXECUTE on new functions, so
-- revoke per the mig-020 defense-in-depth pattern. The service-role backend
-- (admin scan with commit=true) is the sole caller.
REVOKE EXECUTE ON FUNCTION set_song_availability(uuid[], uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_song_availability(uuid[], uuid[])
  TO service_role;
