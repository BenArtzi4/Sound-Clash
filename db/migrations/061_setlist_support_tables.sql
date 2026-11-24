-- 061_setlist_support_tables.sql
-- Custom setlists, phase 1: the artist alias table and the song demand queue.
--
-- Two durable tables for the backend's list matcher, and the writer of the
-- second. Design: docs/planning/2026-11-24-custom-setlist-design.md §7 (the
-- alias table) and §13 point 5 (the Demand Queue).
--
--   1. artist_aliases (alias, artist_key): a spelling a host may type, mapped
--      to one catalog artist. alias is the primary key and is stored cleaned
--      (lower case, trimmed, not empty; a CHECK refuses anything else), so the
--      matcher looks a cleaned spelling up by key. artist_key is a value that
--      appears in songs.artist_keys (the STORED generated column of migration
--      049). That cannot be a foreign key (artist_keys is an array), and no
--      trigger enforces it: the offline verify tool checks it. The index on
--      artist_key answers "which spellings point at this artist".
--      The ROWS are private catalog data (they name the catalog's artists):
--      they are never committed to git and are uploaded like songs. The
--      encrypted weekly catalog backup (.github/workflows/catalog-backup.yml)
--      dumps only genres, songs and song_genres today; adding artist_aliases
--      to it before the first alias upload is a follow-up the maintainer
--      approves. Until then nothing can be lost: no alias row exists yet.
--      This migration creates the empty table.
--   2. song_demand (line_key, raw_line, request_count, first_requested_at,
--      last_requested_at, status): the list lines that matched no catalog
--      song, one row per cleaned line, so the maintainer sees which songs
--      hosts ask for and the catalog lacks. status is the maintainer's review
--      state; a new request never changes it.
--      Both tables are durable (no foreign key to active_games, so the 4-hour
--      sweep never reaches them) and closed to players: RLS on with no policy,
--      every base privilege revoked from anon/authenticated, and NOT in the
--      supabase_realtime publication. service_role is granted SELECT, INSERT,
--      UPDATE and DELETE explicitly, as migrations 030 and 033 do: the backend
--      reads artist_aliases through PostgREST, and the migrations-only
--      `supabase start` stack does not auto-grant (a no-op on hosted Supabase,
--      whose bootstrap already grants it).
--   3. record_song_demand(keys, lines): the backend's writer, after "Create
--      game" with a list. One INSERT: a new key gets a row with its line; a
--      known key gets request_count + 1 and a new last_requested_at, and keeps
--      its first raw_line, first_requested_at and status. A key named twice in
--      one call counts once and its first line wins, because one
--      INSERT ... ON CONFLICT DO UPDATE cannot touch a row twice. The rows go
--      in key order, so two concurrent calls lock shared rows in the same
--      order. Arrays of unequal length raise demand_arrays_unequal; NULL or
--      empty arrays record nothing. Returns the rows touched. Service-role
--      only.
--
-- Additive: two new tables and one new function. Nothing references an
-- existing table, so applying it takes no lock on active_games, songs or any
-- other existing table (unlike migration 060, whose foreign keys do). Safe to
-- apply with live games.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE
-- OR REPLACE FUNCTION and re-runnable REVOKE/GRANT. One transaction, so a
-- caller sees the old state or the new one, never a half-applied file.
--
-- Spec: docs/data-model.md, docs/rpc-functions.md §3l, docs/security-rls.md §2.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1-2. The tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS artist_aliases (
  alias      text PRIMARY KEY
             CHECK (alias = lower(btrim(alias)) AND alias <> ''),
  artist_key text NOT NULL,  -- a value that appears in songs.artist_keys
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artist_aliases_artist_key_idx
  ON artist_aliases (artist_key);

CREATE TABLE IF NOT EXISTS song_demand (
  line_key           text PRIMARY KEY,
  raw_line           text NOT NULL,  -- the first line seen for this key
  request_count      integer NOT NULL DEFAULT 1,
  first_requested_at timestamptz NOT NULL DEFAULT now(),
  last_requested_at  timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'rejected', 'added'))
);

-- RLS ON with NO policy: anon/authenticated see nothing. The base privileges
-- hosted Supabase auto-grants to them are revoked too, as for the pool tables
-- (mig 060). service_role keeps explicit base privileges (see the header).
ALTER TABLE artist_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE song_demand ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON artist_aliases FROM anon, authenticated;
REVOKE ALL ON song_demand FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON artist_aliases, song_demand
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. record_song_demand: count the list lines the catalog could not play.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_song_demand(
  p_keys  text[],
  p_lines text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_touched integer;
BEGIN
  -- unnest(a, b) pads the shorter array with NULLs, so a length mismatch
  -- would pair lines with the wrong keys. NULL counts as empty.
  IF coalesce(cardinality(p_keys), 0) <> coalesce(cardinality(p_lines), 0) THEN
    RAISE EXCEPTION 'demand_arrays_unequal' USING ERRCODE = '22023';
  END IF;

  -- One row per key (the first line for it wins), in key order.
  INSERT INTO song_demand (line_key, raw_line)
  SELECT DISTINCT ON (u.line_key) u.line_key, u.raw_line
    FROM unnest(p_keys, p_lines) WITH ORDINALITY AS u(line_key, raw_line, pos)
   ORDER BY u.line_key, u.pos
  ON CONFLICT (line_key) DO UPDATE
     SET request_count = song_demand.request_count + 1,
         last_requested_at = now();
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  RETURN v_touched;
END $$;

-- Backend-only (POST /games with a list). No token argument: anon could flood
-- the queue.
REVOKE EXECUTE ON FUNCTION record_song_demand(text[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_song_demand(text[], text[])
  TO service_role;

COMMIT;
