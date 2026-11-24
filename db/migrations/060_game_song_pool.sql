-- 060_game_song_pool.sql
-- Custom setlists, phase 1: a per-game song pool and the picker that plays it.
--
-- A host can bring their own list instead of choosing genres. The list is
-- matched against the catalog before the game exists (FastAPI, "Check my
-- list"), and "Create game" saves the result as the game's song pool. During
-- the game, Postgres only chooses the next song from that pool, so no Python
-- enters the round path. Design: docs/planning/2026-11-24-custom-setlist-design.md
-- §5, §8 and §10.
--
--   1. game_setlists (game_code, ready, list_total): one row per custom game.
--      A game with no row here is a normal genre game. list_total is how many
--      lines the host's list had (found or not), for the console line.
--   2. game_song_pool (game_code, song_id, tier): tier 1 = the host's list,
--      tier 2 = more songs by the same artists. A song is in a pool once.
--      Both tables are deleted with the game (FK cascade from active_games),
--      and a song deleted from the catalog leaves every pool with it.
--      Players must never read them (they are the answers): RLS on with no
--      policy, everything revoked from anon/authenticated, and NOT in the
--      supabase_realtime publication. active_games is not changed at all.
--   3. pick_next_pool_song(game_code): from the pool songs not played yet and
--      still available, take the lowest tier, then apply pick_next_song's
--      artist-spacing rule (mig 049/056) and draw at random. The spacing is a
--      preference (rank, not filter), so a list by one artist still plays out.
--      Internal-only, like pick_next_song.
--   4. save_game_setlist(game_code, list ids, fill ids, list_total): the
--      backend's writer on "Create game". Writes the game_setlists row with
--      ready = true and the pool rows in ONE call, so a half-saved pool can
--      never start. Service-role only.
--   5. game_pool_summary(game_code, manager_token): how much of each tier is
--      left, for the host console. Anon-callable, token-gated.
--   6. select_next_song (4-arg) and peek_next_song: after the token check, one
--      lookup by key in game_setlists. Row found and ready = false:
--      setlist_not_ready. Row found: no genre check, pick with
--      pick_next_pool_song, and the guarded p_song_id path (p_expected_round
--      given) accepts only a pool song that is not played and is available.
--      The unguarded explicit override (p_expected_round NULL) is unchanged
--      for custom games too. No row: today's path, unchanged. Bodies are
--      verbatim from migration 057 plus that branch; signatures, return
--      columns, SECURITY DEFINER, search_path and grants are identical, so
--      CREATE OR REPLACE (no DROP). The 3-arg select_next_song wrapper (057)
--      calls the 4-arg one and is left alone.
--
-- No index beyond the primary keys: both tables are read by primary key only
-- (game_setlists by game_code; game_song_pool by game_code, the PK's leading
-- column, or by (game_code, song_id)). The one non-key read is the FK cascade
-- when a catalog song is deleted, which scans game_song_pool; the table only
-- holds the pools of live games (a few hundred rows each), so that stays
-- cheap and an index would only slow every save.
--
-- pick_next_song, buzz_in, award_attempt, release_buzz_lock, start_round,
-- end_round and the active_games table are not touched.
--
-- Additive: two new tables, three new functions, and a branch that only a game
-- with a game_setlists row can enter. Safe to apply before the backend and
-- frontend that use it.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION and
-- re-runnable REVOKE/GRANT. One transaction, so a caller sees the old state or
-- the new one, never a half-applied file.
--
-- Spec: docs/data-model.md, docs/rpc-functions.md §3c, §3cc, §3d, §3i-§3k,
-- docs/security-rls.md §2.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1-2. The pool tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game_setlists (
  game_code  text PRIMARY KEY
             REFERENCES active_games(game_code) ON DELETE CASCADE,
  ready      boolean NOT NULL DEFAULT false,
  list_total integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_song_pool (
  game_code text NOT NULL
            REFERENCES game_setlists(game_code) ON DELETE CASCADE,
  song_id   uuid NOT NULL
            REFERENCES songs(id) ON DELETE CASCADE,
  tier      smallint NOT NULL CHECK (tier IN (1, 2)),
  PRIMARY KEY (game_code, song_id)
);

-- RLS ON with NO policy: anon/authenticated see nothing (PostgREST and
-- Realtime both honour it). The base privileges hosted Supabase auto-grants
-- are revoked too, as for game_secrets (mig 034). The SECURITY DEFINER RPCs
-- below read and write the tables as their owner.
ALTER TABLE game_setlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_song_pool ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_setlists FROM anon, authenticated;
REVOKE ALL ON game_song_pool FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. pick_next_pool_song: the custom-game picker. The played / last_round /
--    artist_history / scored / ranked steps and the weighted draw are
--    pick_next_song's (mig 056), over the chosen tier's songs. Genre balance,
--    artist_left and genre_left are left out: plays is used as it is.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pick_next_pool_song(p_game_code text)
RETURNS uuid
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  WITH played AS (
    SELECT gr.song_id AS sid, gr.round_number AS rn
      FROM game_rounds gr
     WHERE gr.game_code = p_game_code
       AND gr.song_id IS NOT NULL
  ),
  last_round AS (
    SELECT max(played.rn) AS rn FROM played
  ),
  -- Pool songs still playable in this game.
  candidates AS (
    SELECT p.tier, s.id AS sid, s.artist_keys
      FROM game_song_pool p
      JOIN songs s ON s.id = p.song_id
     WHERE p.game_code = p_game_code
       AND s.unavailable_at IS NULL  -- dead-video auto-skip (mig 045)
       AND s.id NOT IN (SELECT played.sid FROM played)
  ),
  -- The host's list first; the same-artist songs once it is used up.
  chosen_songs AS (
    SELECT c.sid, c.artist_keys
      FROM candidates c
     WHERE c.tier = (SELECT min(c2.tier) FROM candidates c2)
  ),
  -- Every artist credited in this game: how many songs credited it and how
  -- many rounds ago it was last heard (1 = the song playing now).
  artist_history AS MATERIALIZED (
    SELECT k.akey, count(*) AS plays, min(lr.rn - p.rn + 1) AS ago
      FROM played p
      CROSS JOIN last_round lr
      JOIN songs s ON s.id = p.sid
      CROSS JOIN LATERAL unnest(s.artist_keys) AS k(akey)
     GROUP BY k.akey
  ),
  scored AS (
    SELECT e.sid,
           -- 9 = none of its artists heard in the last 8 rounds,
           -- otherwise rounds since the most recent of them was heard.
           least(coalesce(min(h.ago), 9), 9) AS spacing,
           -- Songs already credited to its most-played artist.
           coalesce(max(h.plays), 0) AS plays
      FROM chosen_songs e
      LEFT JOIN LATERAL unnest(e.artist_keys) AS k(akey) ON true
      LEFT JOIN artist_history h ON h.akey = k.akey
     GROUP BY e.sid
  ),
  -- Rank, not filter: the best-spaced songs win, and when every song is by
  -- an artist heard just now (a one-artist list), they all rank first.
  ranked AS (
    SELECT s.sid, s.plays,
           rank() OVER (ORDER BY s.spacing DESC) AS rk
      FROM scored s
  )
  -- Weighted draw (Efraimidis-Spirakis): the smallest Exp(1) / weight wins,
  -- so each song wins with probability proportional to 1 / (1 + plays)^2.
  -- 1 - random() is in (0, 1], so ln() never sees 0.
  SELECT r.sid
    FROM ranked r
   WHERE r.rk = 1
   ORDER BY -ln(1 - random()) * (1 + r.plays) * (1 + r.plays)
   LIMIT 1;
$$;

-- Internal-only: called from inside select_next_song / peek_next_song (as
-- their owner). It takes no manager token, so the browser must not reach it.
REVOKE EXECUTE ON FUNCTION pick_next_pool_song(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pick_next_pool_song(text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. save_game_setlist: the backend writes a custom game's pool on "Create
--    game". Ids not in songs are skipped; an id in both arrays is tier 1; an
--    id named twice is stored once. Returns the pool size.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION save_game_setlist(
  p_game_code     text,
  p_list_song_ids uuid[],
  p_fill_song_ids uuid[],
  p_list_total    integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool_size integer;
BEGIN
  PERFORM 1 FROM active_games ag WHERE ag.game_code = p_game_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- ready = true in the same call as the pool rows. ON CONFLICT also makes a
  -- second, concurrent save wait for the first and then refuse.
  INSERT INTO game_setlists (game_code, ready, list_total)
  VALUES (p_game_code, true, p_list_total)
  ON CONFLICT (game_code) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'setlist_exists' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO game_song_pool (game_code, song_id, tier)
  SELECT p_game_code, s.id, min(ids.tier)
    FROM (
      SELECT unnest(p_list_song_ids) AS sid, 1::smallint AS tier
      UNION ALL
      SELECT unnest(p_fill_song_ids), 2::smallint
    ) ids
    JOIN songs s ON s.id = ids.sid
   GROUP BY s.id;
  GET DIAGNOSTICS v_pool_size = ROW_COUNT;

  IF v_pool_size = 0 THEN
    -- The exception undoes this call's game_setlists row: nothing is written.
    RAISE EXCEPTION 'setlist_empty' USING ERRCODE = '22023';
  END IF;

  RETURN v_pool_size;
END $$;

-- Backend-only (POST /games with a list). No token argument: the backend
-- creates the game and saves its pool as service_role.
REVOKE EXECUTE ON FUNCTION save_game_setlist(text, uuid[], uuid[], integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION save_game_setlist(text, uuid[], uuid[], integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. game_pool_summary: the host console's "Your list: N of M left" line.
--    Zero rows for a game with no game_setlists row (a normal genre game).
--    "left" = not played and available, as pick_next_pool_song counts it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION game_pool_summary(
  p_game_code     text,
  p_manager_token uuid
)
RETURNS TABLE(
  list_total  integer,
  list_songs  integer,
  list_left   integer,
  extra_songs integer,
  extra_left  integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_token uuid;
BEGIN
  SELECT gs.manager_token
    INTO v_expected_token
    FROM active_games ag
    LEFT JOIN game_secrets gs ON gs.game_code = ag.game_code
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_expected_token IS NULL
     OR p_manager_token IS NULL
     OR v_expected_token <> p_manager_token THEN
    RAISE EXCEPTION 'manager_token_required' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
    WITH pool AS (
      SELECT gp.tier,
             s.unavailable_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM game_rounds gr
                  WHERE gr.game_code = p_game_code
                    AND gr.song_id = gp.song_id
               ) AS can_play
        FROM game_song_pool gp
        JOIN songs s ON s.id = gp.song_id
       WHERE gp.game_code = p_game_code
    )
    SELECT gsl.list_total,
           (SELECT count(*) FROM pool WHERE pool.tier = 1)::integer,
           (SELECT count(*) FROM pool WHERE pool.tier = 1 AND pool.can_play)::integer,
           (SELECT count(*) FROM pool WHERE pool.tier = 2)::integer,
           (SELECT count(*) FROM pool WHERE pool.tier = 2 AND pool.can_play)::integer
      FROM game_setlists gsl
     WHERE gsl.game_code = p_game_code;
END $$;

REVOKE EXECUTE ON FUNCTION game_pool_summary(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game_pool_summary(text, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6a. select_next_song (guarded, 4-arg): body verbatim from migration 057
--     plus the custom-game branch.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION select_next_song(
  p_game_code     text,
  p_manager_token uuid,
  p_song_id       uuid,
  p_expected_round integer
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
  v_setlist_ready  boolean;
  v_custom         boolean;
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

  -- Custom setlist game (mig 060): one lookup by key. No row = genre game.
  SELECT gsl.ready
    INTO v_setlist_ready
    FROM game_setlists gsl
   WHERE gsl.game_code = p_game_code;
  v_custom := FOUND;

  IF v_custom AND NOT v_setlist_ready THEN
    RAISE EXCEPTION 'setlist_not_ready' USING ERRCODE = 'P0001';
  END IF;

  -- Serialize advances without reversing the round/game row lock order used
  -- by scoring. Re-read the round after waiting for another host's commit.
  PERFORM pg_advisory_xact_lock(194784, hashtext(p_game_code));
  SELECT ag.ended_at, ag.selected_genres, ag.selected_decades, ag.round_number
    INTO v_game_ended_at, v_genres, v_decades, v_round_number
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_game_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'game_ended' USING ERRCODE = 'P0001';
  END IF;

  IF p_expected_round IS NOT NULL AND p_expected_round <> v_round_number THEN
    RAISE EXCEPTION 'stale_round' USING ERRCODE = 'P0001';
  END IF;

  -- A custom game has no genres: its pool is the song source.
  IF NOT v_custom AND (v_genres IS NULL OR cardinality(v_genres) = 0) THEN
    RAISE EXCEPTION 'no_genres_selected' USING ERRCODE = '22023';
  END IF;

  IF p_song_id IS NULL THEN
    IF v_custom THEN
      v_chosen_song := pick_next_pool_song(p_game_code);
    ELSE
      v_chosen_song := pick_next_song(p_game_code, v_genres, v_decades);
    END IF;
    IF v_chosen_song IS NULL THEN
      RAISE EXCEPTION 'no_more_songs' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_expected_round IS NULL THEN
      -- Preserve older clients and deliberate explicit selections.
      PERFORM 1 FROM songs WHERE id = p_song_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0002';
      END IF;
    ELSIF v_custom THEN
      -- A peeked song is committed only while it is still in this game's
      -- pool, unplayed and available.
      IF NOT EXISTS (
        SELECT 1 FROM game_song_pool gp
          JOIN songs s ON s.id = gp.song_id
         WHERE gp.game_code = p_game_code
           AND gp.song_id = p_song_id
           AND s.unavailable_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM game_rounds gr
              WHERE gr.game_code = p_game_code AND gr.song_id = s.id
           )
      ) THEN
        RAISE EXCEPTION 'song_no_longer_eligible' USING ERRCODE = 'P0001';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM songs s
       WHERE s.id = p_song_id
         AND s.unavailable_at IS NULL
         AND (coalesce(cardinality(v_decades), 0) = 0
              OR (s.release_year / 10 * 10) = ANY (v_decades))
         AND EXISTS (
           SELECT 1 FROM song_genres sg
            WHERE sg.song_id = s.id AND sg.genre_id = ANY (v_genres)
         )
         AND NOT EXISTS (
           SELECT 1 FROM game_rounds gr
            WHERE gr.game_code = p_game_code AND gr.song_id = s.id
         )
    ) THEN
      RAISE EXCEPTION 'song_no_longer_eligible' USING ERRCODE = 'P0001';
    END IF;
    v_chosen_song := p_song_id;
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

-- ---------------------------------------------------------------------------
-- 6b. peek_next_song: body verbatim from migration 057 plus the same branch,
--     so the prebuffered candidate stays in lockstep with what
--     select_next_song's random path could pick.
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
  is_soundtrack boolean,
  release_year  integer,
  expected_round integer
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
  v_expected_round integer;
  v_setlist_ready  boolean;
  v_custom         boolean;
BEGIN
  SELECT gs.manager_token, ag.ended_at, ag.selected_genres, ag.selected_decades, ag.round_number
    INTO v_expected_token, v_game_ended_at, v_genres, v_decades, v_expected_round
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

  -- Custom setlist game (mig 060): one lookup by key. No row = genre game.
  SELECT gsl.ready
    INTO v_setlist_ready
    FROM game_setlists gsl
   WHERE gsl.game_code = p_game_code;
  v_custom := FOUND;

  IF v_custom AND NOT v_setlist_ready THEN
    RAISE EXCEPTION 'setlist_not_ready' USING ERRCODE = 'P0001';
  END IF;

  -- A custom game has no genres: its pool is the song source.
  IF NOT v_custom AND (v_genres IS NULL OR cardinality(v_genres) = 0) THEN
    RAISE EXCEPTION 'no_genres_selected' USING ERRCODE = '22023';
  END IF;

  IF v_custom THEN
    v_chosen_song := pick_next_pool_song(p_game_code);
  ELSE
    v_chosen_song := pick_next_song(p_game_code, v_genres, v_decades);
  END IF;

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
           s.release_year,
           v_expected_round
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

-- Grants as migration 057 (CREATE OR REPLACE keeps them; re-asserted so a
-- re-run converges to the same state).
REVOKE EXECUTE ON FUNCTION select_next_song(text, uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION peek_next_song(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION select_next_song(text, uuid, uuid, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION peek_next_song(text, uuid)
  TO anon, authenticated, service_role;

COMMIT;
