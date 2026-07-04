-- 034_game_secrets.sql
-- Move the per-game manager_token out of active_games into a dedicated
-- game_secrets table that anon can NEVER read.
--
-- Why (the D-1 fix): active_games is in the supabase_realtime publication with
-- REPLICA IDENTITY FULL, and anon can SELECT it (players subscribe to game
-- state). Supabase Realtime and PostgREST both send every column of every row
-- the caller may read -- so manager_token was fanned out to every subscribed
-- browser over the WebSocket AND returned by the anon REST hydrate (select *).
-- Any player who knew the 6-char game code could read the host's credential and
-- take over the game (score, kick, end). Moving the token to a table that is
-- (a) NOT in the Realtime publication and (b) has no anon SELECT closes the
-- leak. The SECURITY DEFINER RPCs keep validating it (they run as the table
-- owner, so RLS/GRANTs don't block them).
--
-- Rollout (this migration is applied to prod only after the new backend +
-- frontend deploy): the new backend reads/writes game_secrets; the new frontend
-- no longer selects manager_token. Apply during a quiet moment (no active game)
-- -- see docs/security-rls.md.
--
-- Idempotent: IF NOT EXISTS / IF EXISTS / CREATE OR REPLACE throughout. The
-- backfill is guarded on the source column still existing, so a re-run after
-- step 6 has dropped it is a clean no-op.

-- ---------------------------------------------------------------------------
-- 1. The secret table. Keyed on game_code (active_games' PK) and cascaded with
--    the game, so it inherits the game's 4-hour ephemerality:
--    cleanup_expired_games deletes the active_games row and the FK removes the
--    matching secret. Token defaults to a fresh uuid (same as the old column).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_secrets (
  game_code     text PRIMARY KEY
                REFERENCES active_games(game_code) ON DELETE CASCADE,
  manager_token uuid NOT NULL DEFAULT gen_random_uuid()
);

-- ---------------------------------------------------------------------------
-- 2. Lock it down. RLS ON with NO policies => anon/authenticated see nothing
--    (Realtime + PostgREST both honour RLS). REVOKE the base privileges that
--    hosted-Supabase auto-grants to anon/authenticated as defence-in-depth.
--    The backend uses the service_role key, so it keeps SELECT/INSERT; the
--    SECURITY DEFINER RPCs read the table as its owner regardless of grants.
--    game_secrets is deliberately NOT added to the supabase_realtime
--    publication.
-- ---------------------------------------------------------------------------
ALTER TABLE game_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_secrets FROM anon, authenticated;
GRANT SELECT, INSERT ON game_secrets TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Auto-provision a secret whenever a game is created, in the SAME
--    transaction as the active_games INSERT, so a game always has exactly one
--    secret and the two can never diverge. SECURITY DEFINER so it succeeds no
--    matter which role inserts the game. The token is DB-generated; the backend
--    reads it back (by game_code) to return to the host.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_game_secret() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO game_secrets (game_code)
  VALUES (NEW.game_code)
  ON CONFLICT (game_code) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_game_secret ON active_games;
CREATE TRIGGER trg_create_game_secret
  AFTER INSERT ON active_games
  FOR EACH ROW EXECUTE FUNCTION create_game_secret();

-- ---------------------------------------------------------------------------
-- 4. Backfill existing live games so in-flight sessions keep working. Guarded
--    on the source column still existing so a re-run (after step 6 drops it) is
--    a no-op.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'active_games'
       AND column_name = 'manager_token'
  ) THEN
    INSERT INTO game_secrets (game_code, manager_token)
      SELECT game_code, manager_token FROM active_games
      ON CONFLICT (game_code) DO NOTHING;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Repoint the four token-validating RPCs at game_secrets. Each body is
--    verbatim from its latest definition (award_attempt / release_buzz_lock
--    mig 021; select_next_song / peek_next_song mig 032 / 029) EXCEPT the
--    token-lookup SELECT, which now LEFT JOINs game_secrets. The LEFT JOIN
--    keeps "game not found" (no active_games row => NOT FOUND) distinct from
--    "no secret" (row present, token NULL => manager_token_required).
--    CREATE OR REPLACE preserves the existing EXECUTE grants; re-granted below
--    to keep the migration self-contained.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION award_attempt(
  p_game_code     text,
  p_round_id      uuid,
  p_title         integer,
  p_artist        integer,
  p_wrong_buzz    integer,
  p_manager_token uuid
)
RETURNS TABLE(
  team_id              uuid,
  points_delta         integer,
  team_total_score     integer,
  title_claimed_by     uuid,
  artist_claimed_by    uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id          uuid;
  v_round_ended      timestamptz;
  v_title_claimed    uuid;
  v_artist_claimed   uuid;
  v_free_guess       boolean;
  v_outcome          text;
  v_delta            integer;
  v_score            integer;
  v_new_free_guess   boolean;
  v_expected_token   uuid;
  v_game_ended_at    timestamptz;
BEGIN
  -- Token check happens first, before any reads/writes that could leak
  -- information about a game's state to an unauthenticated caller.
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

  SELECT gr.ended_at, gr.title_claimed_by, gr.artist_claimed_by, gr.free_guess_active
    INTO v_round_ended, v_title_claimed, v_artist_claimed, v_free_guess
    FROM game_rounds gr
   WHERE gr.id = p_round_id AND gr.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_round_ended IS NOT NULL THEN
    RAISE EXCEPTION 'round_already_ended' USING ERRCODE = 'P0001';
  END IF;

  SELECT ag.buzzed_team_id INTO v_team_id
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF v_team_id IS NULL THEN
    RAISE EXCEPTION 'no_buzz_to_score' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_wrong_buzz, 0) > 0
     AND (COALESCE(p_title, 0) > 0 OR COALESCE(p_artist, 0) > 0) THEN
    RAISE EXCEPTION 'wrong_buzz_with_correct' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_title, 0) > 0 AND v_title_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'title_already_claimed' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_artist, 0) > 0 AND v_artist_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'artist_already_claimed' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(p_wrong_buzz, 0) > 0 THEN
    IF v_free_guess THEN
      v_delta := 0;
    ELSE
      v_delta := -p_wrong_buzz;
    END IF;
    v_outcome := 'wrong';
  ELSIF COALESCE(p_title, 0) > 0 AND COALESCE(p_artist, 0) > 0 THEN
    v_delta := p_title + p_artist;
    v_outcome := 'title_artist';
  ELSIF COALESCE(p_title, 0) > 0 THEN
    v_delta := p_title;
    v_outcome := 'title';
  ELSIF COALESCE(p_artist, 0) > 0 THEN
    v_delta := p_artist;
    v_outcome := 'artist';
  ELSE
    v_delta := 0;
    v_outcome := NULL;
  END IF;

  IF v_outcome IN ('title', 'artist', 'title_artist') THEN
    v_new_free_guess := true;
  ELSE
    v_new_free_guess := false;
  END IF;

  IF v_delta <> 0 THEN
    UPDATE game_teams SET score = score + v_delta WHERE id = v_team_id;
  END IF;

  IF COALESCE(p_title, 0) > 0 THEN
    UPDATE game_rounds SET title_claimed_by = v_team_id, title_points = p_title
     WHERE id = p_round_id;
  END IF;
  IF COALESCE(p_artist, 0) > 0 THEN
    UPDATE game_rounds SET artist_claimed_by = v_team_id, artist_points = p_artist
     WHERE id = p_round_id;
  END IF;
  IF COALESCE(p_wrong_buzz, 0) > 0 THEN
    UPDATE game_rounds SET wrong_buzz_penalty = p_wrong_buzz
     WHERE id = p_round_id;
  END IF;

  UPDATE game_rounds SET free_guess_active = v_new_free_guess
   WHERE id = p_round_id;

  IF v_outcome IS NOT NULL THEN
    INSERT INTO game_round_attempts (round_id, game_code, team_id, outcome, points_delta)
    VALUES (p_round_id, p_game_code, v_team_id, v_outcome, v_delta);
  END IF;

  IF COALESCE(p_wrong_buzz, 0) > 0 THEN
    UPDATE active_games
       SET buzzed_team_id = NULL, locked_at = NULL
     WHERE game_code = p_game_code;
  ELSIF v_outcome IN ('title', 'artist', 'title_artist') THEN
    UPDATE active_games
       SET locked_at = now()
     WHERE game_code = p_game_code;
  END IF;

  SELECT gt.score INTO v_score FROM game_teams gt WHERE gt.id = v_team_id;
  SELECT gr.title_claimed_by, gr.artist_claimed_by
    INTO v_title_claimed, v_artist_claimed
    FROM game_rounds gr WHERE gr.id = p_round_id;

  RETURN QUERY SELECT v_team_id, v_delta, COALESCE(v_score, 0),
                      v_title_claimed, v_artist_claimed;
END $$;

CREATE OR REPLACE FUNCTION release_buzz_lock(
  p_game_code     text,
  p_manager_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_token uuid;
  v_game_ended_at  timestamptz;
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

  UPDATE active_games
     SET buzzed_team_id = NULL, locked_at = NULL
   WHERE game_code = p_game_code;
END $$;

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

CREATE OR REPLACE FUNCTION peek_next_song(
  p_game_code     text,
  p_manager_token uuid
)
RETURNS TABLE(
  song_id    uuid,
  youtube_id text,
  start_time integer
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
           s.start_time
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

-- Re-grant EXECUTE (idempotent; CREATE OR REPLACE already preserved these).
GRANT EXECUTE ON FUNCTION award_attempt(text, uuid, integer, integer, integer, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION release_buzz_lock(text, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION select_next_song(text, uuid, uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION peek_next_song(text, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Drop the now-unused column. THIS is the fix: it stops the token being
--    fanned out over Realtime / returned by anon `select *` on active_games.
-- ---------------------------------------------------------------------------
ALTER TABLE active_games DROP COLUMN IF EXISTS manager_token;
