-- 029_peek_next_song.sql
-- Read-only "peek" companion to select_next_song (mig 028), added to let the
-- manager browser PREBUFFER the next YouTube video during the current round.
--
-- Why this exists: production Faro traces show that ~89% of "click Next round
-- -> audio playing" latency (~1191ms of ~1335ms) is YouTube's own
-- load->playing buffering, captured by the span game.song_start.load_to_playing.
-- select_next_song picks a *random* unplayed song at click time, so the browser
-- can't know what to prebuffer in advance. peek_next_song runs the SAME random
-- picker but WITHOUT advancing the round (no start_round, no game_rounds insert,
-- no active_games mutation), returning a candidate song the browser can cue into
-- a hidden second player. On the actual click, the browser commits that exact
-- song via select_next_song(..., p_song_id => <peeked id>) and resumes the
-- already-buffered player, so load_to_playing collapses to a near-instant resume.
--
-- Security model: identical to select_next_song / award_attempt. SECURITY
-- DEFINER, reads active_games.manager_token under definer privileges, and
-- validates the supplied token BEFORE any game-state read could leak, raising
-- the same errors (game_not_found / game_ended / manager_token_required /
-- no_genres_selected). It performs no writes, so a forged call (which the token
-- check rejects anyway) could at worst learn a candidate song id -- and the host
-- already sees the full catalog. Anon-callable by design, same as
-- select_next_song; migration 020's REVOKE loop pre-dates this function, so we
-- GRANT EXECUTE explicitly to the three roles below.
--
-- Pool exhaustion is NOT an error here: when no unplayed song remains, the
-- function returns ZERO rows. The browser treats "no row" as "nothing to
-- prebuffer" and simply skips preloading; the real no_more_songs error still
-- surfaces from the eventual select_next_song commit. Raising here would spam
-- the host with a spurious error mid-round.
--
-- Idempotent: the defensive `DROP FUNCTION IF EXISTS` below makes this
-- re-runnable even after a later migration changes peek_next_song's RETURNS
-- shape (migration 038 adds song_title/song_artist/is_soundtrack). Without the
-- drop, re-applying this migration would fail with 42P13 "cannot change return
-- type of existing function" once 038 had run. Mirrors how the establishing
-- select_next_song migration (022) drops-first for the same reason.
DROP FUNCTION IF EXISTS peek_next_song(text, uuid);

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
  v_chosen_song    uuid;
BEGIN
  -- 1. Token + game-state gate. Identical shape to select_next_song (mig 028);
  --    token check happens before any read that could leak game state.
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

  -- 2. Pick a candidate the SAME way select_next_song's random branch does:
  --    exclude already-played songs, bucket eligible candidates by genre, pick
  --    a random eligible genre then a random song within it. READ ONLY -- no
  --    round is created, so calling peek repeatedly never advances the game.
  --    (The eventual commit re-runs the picker only if the browser passes no
  --    p_song_id; normally it commits this exact id, so the buffered video and
  --    the started round always agree.)
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

  -- 3. Pool exhausted: return no rows (NOT an error). See header.
  IF v_chosen_song IS NULL THEN
    RETURN;
  END IF;

  -- songs.youtube_id is char(11); the RETURNS TABLE declares it text so the
  -- PostgREST JSON has no char(n) right-padding -- cast explicitly.
  RETURN QUERY
    SELECT s.id,
           s.youtube_id::text,
           s.start_time
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

-- Anon-callable by design (in-function token check is the gate), same as
-- select_next_song. Migration 020's REVOKE loop enumerates a fixed list that
-- pre-dates this function, so grant EXECUTE explicitly.
GRANT EXECUTE ON FUNCTION peek_next_song(text, uuid)
  TO anon, authenticated, service_role;
