-- 062_pick_artists.sql
-- Pick artists: the host ticks artists and the game plays every catalog song
-- by them. This file is the database part: the list of names the host picks
-- from, the ready rule, and the save that turns a choice into the game's song
-- pool (migration 060). Design: docs/planning/2026-11-24-host-music-choices.md
-- §3 and §9, plan docs/planning/2026-11-24-pick-artists-plan.md, Task 1.
--
--   1. artist_whole_names (name): a credit that is ONE artist although it
--      holds a separator that song_artist_keys (mig 049) cuts at (a comma, an
--      "&", ...). name is the whole credit, cleaned (lower case, trimmed, not
--      empty; a CHECK refuses anything else). Only a whole credit matches: the
--      same name inside a longer credit is still cut. The table changes only
--      what the artist list shows and counts; songs.artist_keys, the picker
--      and the list matcher keep the cut keys.
--      The ROWS are private catalog data (they name the catalog's artists):
--      they are never committed to git. They are rebuilt from the git-ignored
--      review batch (tools/song-curation/aliases/whole_names.py) and uploaded
--      like songs. The encrypted weekly catalog backup
--      (.github/workflows/catalog-backup.yml) does not dump this table yet;
--      adding it is a follow-up the maintainer approves. This migration
--      creates the empty table.
--      Durable (no foreign key, outside the 4-hour sweep) and closed to
--      players: RLS on with no policy, every base privilege revoked from
--      anon/authenticated, NOT in the supabase_realtime publication.
--      service_role is granted SELECT, INSERT, UPDATE and DELETE explicitly,
--      as in 060 and 061 (the migrations-only `supabase start` stack does not
--      auto-grant; a no-op on hosted Supabase).
--   2. artist_game_rule(): the ready rule's numbers -- 60 songs, 5 artists, 4
--      levels. The ONE place that holds them: the functions below read them
--      from here. Service-role only.
--   3. pickable_credits(): one row per playable song (unavailable_at IS NULL)
--      and each artist it counts for. A song whose lower(btrim(artist)) is a
--      row of artist_whole_names counts for that one name (shown =
--      btrim(artist)). Every other song counts for each value of its
--      artist_keys, cut with song_artist_keys' regular expression (copied
--      below; tests/db/test_pick_artists.py keeps the copy in step), and shown
--      is the piece whose lower(btrim()) is the key (the first such piece when
--      a credit names the same artist twice). It returns song ids, so it is
--      service-role only.
--   4. list_pickable_artists(): the Pick artists tab's list. One row per
--      artist_key: name (the most common shown; a tie goes to the smallest in
--      byte order), kind ('film' when every playable song of the key is in a
--      genre with the slug soundtracks or israeli-soundtracks, else 'he' when
--      the key holds a Hebrew letter, else 'en') and aliases (artist_aliases,
--      mig 061, sorted in byte order; '{}' when none). Ordered by most songs
--      first, then name (byte order). There is NO count column: no song count
--      leaves the server, and the answer holds no song title, song id, video
--      id or start time. ALL names are returned (the server does not cut the
--      list). Anon-callable, no token.
--   5. artist_pick_status(keys): ready plus a coarse level for a choice. Keys
--      are compared after lower(btrim()); a repeat, a NULL and a key that
--      pickable_credits does not have are ignored. NULL or empty: (false, 0,
--      levels, min_artists). More than 200 elements: too_many_artists
--      (22023). ready = artists >= min_artists AND songs >= min_songs, where
--      songs counts DIFFERENT songs (a duet of two chosen artists counts
--      once). level = levels when ready; 0 when no key is known; otherwise
--      greatest(1, least(levels - 1, ceil(levels * least(songs / min_songs,
--      artists / min_artists)))). Anon-callable, no token: the answer is
--      ready, level, levels and min_artists, never a count.
--   6. save_game_artists(game_code, keys): the backend's writer on "Create
--      game" with artists. When the status of keys is not ready:
--      artists_not_enough (22023), checked FIRST, and nothing is written.
--      Otherwise save_game_setlist(game_code, <the songs of the known keys>,
--      '{}', <the number of known keys>): every song in tier 1, the
--      game_setlists row ready = true, in one call. Then the rule is checked
--      again on the pool as saved (its songs, and the chosen artists among
--      them): a song flagged between the reads and the INSERT can leave it
--      below the rule, and then artists_not_enough undoes the whole call. A
--      missing game raises save_game_setlist's game_not_found (P0002).
--      Returns the pool size. Service-role only.
--
-- Performance: the list and the status are read while the host picks, so
-- pickable_credits is set-based -- at most one regexp split per song
-- (LATERAL; skipped for a credit that song_artist_keys does not cut), a join
-- to artist_whole_names, one byte-order sort for the DISTINCT ON -- and
-- the list aggregates it with GROUP BY, never a per-row correlated subquery.
-- pickable_credits runs with jit = off (see its SET clause). Nothing is
-- cached. Target: under 30 ms each on 2,000 songs by 900 artists
-- (measured on the local stack; docs/rpc-functions.md).
--
-- The functions that read tables are PL/pgSQL, whose bodies are not analysed
-- when they are created, so applying this file opens no existing table:
-- it takes no lock on active_games, songs, song_genres, genres or
-- artist_aliases (tests/db/test_pick_artists.py checks pg_locks). Safe to
-- apply with live games. No existing function, table or grant is changed;
-- select_next_song, peek_next_song, save_game_setlist and the round path are
-- untouched (an artist game is a song pool, which they already play).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION and
-- re-runnable REVOKE/GRANT. One transaction, so a caller sees the old state or
-- the new one, never a half-applied file.
--
-- Spec: docs/data-model.md, docs/rpc-functions.md §3m-§3q,
-- docs/security-rls.md §2.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. artist_whole_names
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artist_whole_names (
  name       text PRIMARY KEY
             CHECK (name = lower(btrim(name)) AND name <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS ON with NO policy: anon/authenticated see nothing. The base privileges
-- hosted Supabase auto-grants are revoked too (as for the 060/061 tables).
ALTER TABLE artist_whole_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artist_whole_names FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_whole_names TO service_role;

-- ---------------------------------------------------------------------------
-- 2. artist_game_rule: the only place that holds 60, 5 and 4.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION artist_game_rule()
RETURNS TABLE(min_songs integer, min_artists integer, levels integer)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 60, 5, 4;
$$;

-- ---------------------------------------------------------------------------
-- 3. pickable_credits: (song, artist it counts for, spelling shown).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pickable_credits()
RETURNS TABLE(song_id uuid, artist_key text, shown text)
LANGUAGE plpgsql
STABLE
SET search_path = public
-- The planner takes regexp_split_to_table for 1,000 rows per song, so this
-- query's estimated cost passes the JIT thresholds and LLVM compiles it on
-- every call: measured ~120 ms of compiling for ~15 ms of work on 2,000
-- songs. A planner setting, not a cache.
SET jit = off
AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT ON (s.id, c.akey COLLATE "C")
           s.id, c.akey, c.shown
      FROM songs s
      LEFT JOIN artist_whole_names w ON w.name = lower(btrim(s.artist))
      CROSS JOIN LATERAL (
        -- A whole name: the credit is one artist.
        SELECT w.name AS akey, btrim(s.artist) AS shown, 0::bigint AS pos
         WHERE w.name IS NOT NULL
        UNION ALL
        -- A credit song_artist_keys does not cut (its one key is the whole
        -- credit, cleaned): the one piece is the credit itself, so the split
        -- is skipped. Most credits; the same answer as the branch below.
        SELECT s.artist_keys[1], btrim(s.artist), 1::bigint
         WHERE w.name IS NULL
           AND s.artist_keys = ARRAY[lower(btrim(s.artist))]
        UNION ALL
        -- Any other credit: the pieces of song_artist_keys (migration 049).
        -- The pattern and the flag are a COPY of song_artist_keys'; change
        -- both together (test_shown_pieces_agree_with_artist_keys).
        SELECT lower(btrim(t.piece)), btrim(t.piece), t.pos
          FROM regexp_split_to_table(
                 coalesce(s.artist, ''),
                 '\s+(?:&|featuring|feat\.?|ft\.?|vs\.?)\s+|\s+x\s+(?!&)|\s*,\s*|\s+ו(?=\S)',
                 'i'
               ) WITH ORDINALITY AS t(piece, pos)
         WHERE w.name IS NULL
           AND s.artist_keys IS DISTINCT FROM ARRAY[lower(btrim(s.artist))]
      ) c
     WHERE s.unavailable_at IS NULL  -- playable only (mig 045)
       AND c.akey <> ''
     -- One row per (song, key); a key named twice in a credit keeps the
     -- spelling of its first piece. Byte order sorts fastest and, for a
     -- deterministic collation, groups exactly as the default one does.
     ORDER BY s.id, c.akey COLLATE "C", c.pos;
END $$;

-- ---------------------------------------------------------------------------
-- 4. list_pickable_artists: names, kinds and spellings; no count.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION list_pickable_artists()
RETURNS TABLE(artist_key text, name text, kind text, aliases text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    WITH credits AS MATERIALIZED (
      SELECT pc.song_id, pc.artist_key AS akey, pc.shown
        FROM pickable_credits() pc
    ),
    film_songs AS (
      SELECT DISTINCT sg.song_id
        FROM song_genres sg
        JOIN genres g ON g.id = sg.genre_id
       WHERE g.slug IN ('soundtracks', 'israeli-soundtracks')
    ),
    -- A key has one credits row per song, so count(*) is its song count. It
    -- orders the list and never leaves this function.
    per_key AS (
      SELECT c.akey,
             count(*) AS songs,
             bool_and(f.song_id IS NOT NULL) AS all_film
        FROM credits c
        LEFT JOIN film_songs f ON f.song_id = c.song_id
       GROUP BY c.akey
    ),
    -- The most common spelling of each key; a tie: the smallest in byte order.
    spellings AS (
      SELECT DISTINCT ON (c.akey COLLATE "C") c.akey, c.shown
        FROM credits c
       GROUP BY c.akey, c.shown
       ORDER BY c.akey COLLATE "C", count(*) DESC, c.shown COLLATE "C"
    ),
    alias_lists AS (
      SELECT a.artist_key AS akey,
             array_agg(a.alias ORDER BY a.alias COLLATE "C") AS aliases
        FROM artist_aliases a
       GROUP BY a.artist_key
    )
    SELECT k.akey,
           sp.shown,
           CASE
             WHEN k.all_film THEN 'film'
             WHEN k.akey ~ '[א-ת]' THEN 'he'  -- a Hebrew letter: U+05D0 (alef) to U+05EA (tav)
             ELSE 'en'
           END,
           coalesce(al.aliases, '{}'::text[])
      FROM per_key k
      JOIN spellings sp ON sp.akey = k.akey
      LEFT JOIN alias_lists al ON al.akey = k.akey
     ORDER BY k.songs DESC, sp.shown COLLATE "C", k.akey COLLATE "C";
END $$;

-- ---------------------------------------------------------------------------
-- 5. artist_pick_status: ready plus a coarse level; no count.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION artist_pick_status(p_keys text[])
RETURNS TABLE(ready boolean, level integer, levels integer, min_artists integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule    record;
  v_artists integer := 0;
  v_songs   integer := 0;
  v_ready   boolean;
BEGIN
  SELECT r.min_songs, r.min_artists, r.levels
    INTO v_rule
    FROM artist_game_rule() r;

  IF coalesce(cardinality(p_keys), 0) > 200 THEN
    RAISE EXCEPTION 'too_many_artists' USING ERRCODE = '22023';
  END IF;

  IF coalesce(cardinality(p_keys), 0) > 0 THEN
    -- The known keys and their DIFFERENT songs (a duet counts once).
    SELECT count(DISTINCT pc.artist_key), count(DISTINCT pc.song_id)
      INTO v_artists, v_songs
      FROM pickable_credits() pc
     WHERE pc.artist_key IN (SELECT lower(btrim(u.k)) FROM unnest(p_keys) AS u(k));
  END IF;

  v_ready := v_artists >= v_rule.min_artists AND v_songs >= v_rule.min_songs;

  RETURN QUERY
    SELECT v_ready,
           CASE
             WHEN v_ready THEN v_rule.levels
             WHEN v_artists = 0 THEN 0
             ELSE greatest(1, least(v_rule.levels - 1,
                    ceil(v_rule.levels * least(v_songs::numeric / v_rule.min_songs,
                                               v_artists::numeric / v_rule.min_artists)
                    )::integer))
           END,
           v_rule.levels,
           v_rule.min_artists;
END $$;

-- ---------------------------------------------------------------------------
-- 6. save_game_artists: an artist game's pool, every song in tier 1.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION save_game_artists(p_game_code text, p_keys text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule          record;
  v_ready         boolean;
  v_pair_songs    uuid[];
  v_pair_keys     text[];
  v_song_ids      uuid[];
  v_artists       integer;
  v_pool_size     integer;
  v_saved_artists integer;
BEGIN
  -- The ready rule first (Review Focus 1): a small choice writes nothing,
  -- whatever the game. artist_pick_status raises too_many_artists itself.
  SELECT st.ready INTO v_ready FROM artist_pick_status(p_keys) st;
  IF NOT v_ready THEN
    RAISE EXCEPTION 'artists_not_enough' USING ERRCODE = '22023';
  END IF;

  -- The same known keys as the status: every playable song they have, and
  -- each (song, key) pair for the check on the saved pool below. The two
  -- pair arrays share one ORDER BY, so their elements stay paired.
  SELECT array_agg(pc.song_id ORDER BY pc.song_id, pc.artist_key COLLATE "C"),
         array_agg(pc.artist_key ORDER BY pc.song_id, pc.artist_key COLLATE "C"),
         array_agg(DISTINCT pc.song_id),
         count(DISTINCT pc.artist_key)
    INTO v_pair_songs, v_pair_keys, v_song_ids, v_artists
    FROM pickable_credits() pc
   WHERE pc.artist_key IN (SELECT lower(btrim(u.k)) FROM unnest(p_keys) AS u(k));

  -- game_not_found, setlist_exists and setlist_empty come from here.
  v_pool_size := save_game_setlist(p_game_code, v_song_ids, '{}'::uuid[], v_artists);

  -- The rule again, on the pool as saved. The status, the read above and
  -- save_game_setlist's INSERT each take their own snapshot, so a song
  -- flagged (or deleted) in between is left out of the pool and can take it
  -- below the rule. The raise undoes the whole call: the game_setlists row
  -- and the pool rows.
  SELECT count(DISTINCT c.akey)
    INTO v_saved_artists
    FROM game_song_pool g
    JOIN unnest(v_pair_songs, v_pair_keys) AS c(sid, akey) ON c.sid = g.song_id
   WHERE g.game_code = p_game_code;

  SELECT r.min_songs, r.min_artists INTO v_rule FROM artist_game_rule() r;
  IF v_pool_size < v_rule.min_songs OR v_saved_artists < v_rule.min_artists THEN
    RAISE EXCEPTION 'artists_not_enough' USING ERRCODE = '22023';
  END IF;

  RETURN v_pool_size;
END $$;

-- ---------------------------------------------------------------------------
-- Grants. Hosted Supabase grants EXECUTE on every public function to anon,
-- authenticated and service_role directly, so REVOKE ... FROM PUBLIC alone is
-- not enough (migration 020): the service-role-only functions revoke from
-- anon and authenticated by name.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION artist_game_rule() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION pickable_credits() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION save_game_artists(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION artist_game_rule() TO service_role;
GRANT EXECUTE ON FUNCTION pickable_credits() TO service_role;
GRANT EXECUTE ON FUNCTION save_game_artists(text, text[]) TO service_role;

-- The Pick artists tab calls these two direct from the browser (no token:
-- names, kinds and spellings, or ready plus a level).
REVOKE EXECUTE ON FUNCTION list_pickable_artists() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION artist_pick_status(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_pickable_artists() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION artist_pick_status(text[]) TO anon, authenticated, service_role;

COMMIT;
