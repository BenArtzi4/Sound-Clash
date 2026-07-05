-- 038_peek_next_song_metadata.sql
-- Smoothness (Phase 2 carryover, I-NextMeta): make peek_next_song also return the
-- candidate song's title / artist / is_soundtrack, so the manager's Next-round
-- FAST PATH can render the new song's metadata in-gesture.
--
-- Today peek_next_song returns only (song_id, youtube_id, start_time) -- enough to
-- prebuffer the video, but not to label it. So on the prebuffered fast path the
-- audio is already playing while the song card still shows the PREVIOUS title
-- until select_next_song resolves (~150ms later). The peeked metadata is already
-- in the browser's preloadRef; returning title/artist/is_soundtrack here lets the
-- console setCurrentSong(...) synchronously on the click, before awaiting the RPC.
--
-- is_soundtrack is COMPUTED the same way select_next_song computes it (mig 028):
-- EXISTS over song_genres -> genres with slug IN ('soundtracks','israeli-soundtracks').
-- Keeping it identical means the peeked card and the committed round agree on the
-- soundtrack layout (single "Correct +15" button vs the title/artist split).
--
-- The RETURNS TABLE gains columns, so CREATE OR REPLACE is not allowed (Postgres
-- 42P13 "cannot change return type"): DROP then CREATE. The name has a single
-- signature (text, uuid), so the drop is unambiguous. Re-GRANT after (the drop
-- clears the old grant). The picker CTE, the token/game-state gate, and the
-- zero-rows-on-pool-exhaustion contract are unchanged from mig 034.
--
-- Idempotent: DROP ... IF EXISTS then CREATE; re-runnable.

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

-- The DROP cleared grants; restore them (anon-callable, token-gated in-body).
GRANT EXECUTE ON FUNCTION peek_next_song(text, uuid)
  TO anon, authenticated, service_role;
