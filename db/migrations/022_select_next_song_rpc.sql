-- 022_select_next_song_rpc.sql
-- Move the "Next round" / "Start game" hot path off the Render FastAPI hop
-- and onto a single direct browser -> Supabase RPC, mirroring PR #87's
-- pattern for award_attempt / release_buzz_lock.
--
-- Before: handleNextRound in the manager console did TWO chained HTTP
-- requests through FastAPI on Render (US-West) to Supabase (Frankfurt):
--   1. POST /games/{code}/end-round  -> RPC end_round
--   2. POST /games/{code}/select-song -> python pick_random_song +
--      RPC start_round
-- Each hop is ~150-300ms warm and a 2-30s spike on Render cold starts. So
-- the click feels stuck for ~500-900ms.
--
-- After: one direct supabase.rpc("select_next_song", ...). The PL/pgSQL
-- function does the token check, picks a random unplayed song (or accepts
-- a manually-specified one), and delegates round creation to the existing
-- start_round() function (which already defensively closes any still-open
-- prior round, so a separate end_round call is unnecessary). Latency drops
-- to ~150ms; with the optimistic toast (PR #88) the perceived click ->
-- feedback gap is ~10ms.
--
-- Security model: same as migration 021. The function takes p_manager_token
-- as a *required* argument (NOT a DEFAULT, so PostgREST never picks this
-- signature for callers that meant a different overload). The function
-- (SECURITY DEFINER) reads active_games.manager_token under definer
-- privileges, raises 'manager_token_required' (sqlstate 28000) on mismatch,
-- and only then performs any work. UUID equality on a fixed 16-byte type
-- is not a timing-attack vector. p_song_id IS allowed to have a DEFAULT
-- because there is no existing select_next_song overload to clash with --
-- the function name is brand new in this migration.
--
-- Backwards compatibility: the FastAPI POST /games/{code}/select-song
-- endpoint stays in place. Once the new frontend has shipped and is stable
-- on prod, a follow-up cleanup migration can drop the FastAPI route, the
-- _start_round_blocking helper, and backend/app/services/song_picker.py.
-- Keeping both paths means one-revert rollback if the new path misbehaves.
--
-- Idempotent: CREATE OR REPLACE on the function; GRANT EXECUTE is naturally
-- idempotent.

CREATE OR REPLACE FUNCTION select_next_song(
  p_game_code      text,
  p_manager_token  uuid,
  p_song_id        uuid DEFAULT NULL  -- NULL = pick randomly; non-NULL = manual pick
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
  source        text
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
  -- 1. Token + game-state gate. Same shape as award_attempt in migration 021.
  --    Token check happens before any reads that could leak game state.
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

  -- 2. Pick the song.
  IF p_song_id IS NOT NULL THEN
    -- Manual pick: caller supplied an exact song. Validate it exists; the
    -- "no repeats" check is intentionally skipped to match the legacy REST
    -- path (see docs/game-rules.md §11 -- Restart-song flow).
    PERFORM 1 FROM songs WHERE id = p_song_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_chosen_song := p_song_id;
  ELSE
    -- Random pick. Mirrors backend/app/services/song_picker.py:
    --   * exclude songs already used in this game's game_rounds
    --   * bucket eligible candidates by genre
    --   * pick a random eligible genre (equal weight per genre, so small
    --     genres aren't drowned out by large ones), then a random song
    --     within that genre. A song that belongs to several selected genres
    --     lands in multiple buckets, weighting it proportionally to its
    --     genre-overlap -- same as the Python picker.
    -- CTE columns are aliased away from "song_id" / "genre_id" because
    -- those names collide with the function's RETURNS TABLE output and
    -- with v_genres -- PL/pgSQL would raise "column reference ... is
    -- ambiguous". We use sid/gid throughout the picker query.
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

  -- 3. Delegate round creation to start_round() (migration 016). It already
  --    closes any still-open prior round defensively, advances round_number,
  --    sets current_round_id / current_song_id, and clears the buzz lock --
  --    so we don't need a separate end_round call. Its signature is
  --    (char(6), uuid); cast the text game code accordingly.
  v_round_id := start_round(p_game_code::char(6), v_chosen_song);

  SELECT ag.round_number INTO v_round_number
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  -- songs.youtube_id is char(11) in the schema; the RETURNS TABLE declares
  -- it as `text` (so the JSON over PostgREST renders cleanly with no
  -- right-padding), so cast it explicitly here.
  RETURN QUERY
    SELECT v_round_id,
           v_round_number,
           s.id,
           s.title,
           s.artist,
           s.youtube_id::text,
           s.start_time,
           s.is_soundtrack,
           s.source
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

-- Migration 020 explicitly revokes anon/authenticated EXECUTE on the backend-
-- only RPC list it enumerates, but that loop runs once and doesn't catch new
-- functions added later. select_next_song is anon-callable by design (token
-- check is in the function body, same as buzz_in / award_attempt), so we
-- grant EXECUTE explicitly to the three roles the browser and any future
-- internal callers need.
GRANT EXECUTE ON FUNCTION select_next_song(text, uuid, uuid)
  TO anon, authenticated, service_role;
