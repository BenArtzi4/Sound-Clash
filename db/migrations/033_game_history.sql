-- 033_game_history.sql
-- Durable game history: persist every game that actually played >= 1 round so an
-- operator can review past sessions long after the ephemeral active_games row is
-- swept (4h TTL via cleanup_expired_games / pg_cron). This is a DB-only feature:
-- no HTTP endpoint, no UI, no Realtime. It is queried via the Supabase SQL editor
-- with the service-role key.
--
-- Shape: one game_history row per archived game, plus two child tables --
-- game_history_teams (final name + score per team) and game_history_songs (the
-- ordered list of songs that played). Song fields are DENORMALISED (title /
-- artist / youtube_id copied at archive time) so history survives a later edit or
-- hard-delete of the songs row; song_id keeps a soft FK (ON DELETE SET NULL) for
-- convenience while the song still exists.
--
-- Archiving is driven by two callers, both redefined below:
--   * end_game            -> archive, then mark the game ended (host clicked End)
--   * cleanup_expired_games -> archive every expiring game before the DELETE,
--     so games a host never explicitly ended are still captured.
-- archive_game is idempotent (no-op if already archived) and skips 0-round games,
-- so the end_game-then-sweep double path archives exactly once.
--
-- Privacy: unlike the ephemeral tables (anon-readable because rows vanish in 4h),
-- this durable history has RLS enabled and NO anon policy -- it is operator-only.
-- The host-facing "export songs" feature reads the live ephemeral rows in the
-- host's own session, never these tables, so anon never needs to read them.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, guarded UNIQUE constraint, CREATE INDEX
-- IF NOT EXISTS, CREATE OR REPLACE FUNCTION. service_role table grants mirror
-- migration 030 (the migrations-only CI `supabase start` stack does not
-- auto-grant); the anon/authenticated EXECUTE revoke mirrors migration 020
-- (defense-in-depth vs hosted-Supabase's auto-grant-to-anon on public functions).
--
-- Spec: docs/data-model.md, docs/rpc-functions.md, docs/security-rls.md.

BEGIN;

-- Defensive role creation, mirroring migrations 006/020 -- a no-op on hosted
-- Supabase (roles exist natively) and on a stack that already applied 006/020,
-- but lets 033 apply standalone on a bare Postgres.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code         text        NOT NULL,
  started_at        timestamptz NOT NULL,
  ended_at          timestamptz,                       -- end_game time, or sweep time for abandoned games
  round_count       integer     NOT NULL,              -- rounds actually played (>= 1; 0-round games are skipped)
  selected_genres   uuid[]      NOT NULL DEFAULT '{}',
  selected_decades  integer[]   NOT NULL DEFAULT '{}',
  team_count        integer     NOT NULL DEFAULT 0,
  archived_at       timestamptz NOT NULL DEFAULT now()
);

-- (game_code, started_at) is the idempotency key. game_code alone is NOT unique
-- over time: codes are recycled after the 4h TTL frees them, so two different
-- games months apart can reuse one code. started_at disambiguates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_history_code_started_key'
  ) THEN
    ALTER TABLE game_history
      ADD CONSTRAINT game_history_code_started_key UNIQUE (game_code, started_at);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS game_history_teams (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_history_id  uuid    NOT NULL REFERENCES game_history(id) ON DELETE CASCADE,
  name             text    NOT NULL,
  score            integer NOT NULL,
  joined_at        timestamptz
);

CREATE TABLE IF NOT EXISTS game_history_songs (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  game_history_id  uuid    NOT NULL REFERENCES game_history(id) ON DELETE CASCADE,
  round_number     integer NOT NULL,
  song_id          uuid    REFERENCES songs(id) ON DELETE SET NULL,  -- soft FK; denorm below is the source of truth
  song_title       text    NOT NULL,
  song_artist      text    NOT NULL,
  youtube_id       text    NOT NULL,
  start_time       integer NOT NULL DEFAULT 0,
  UNIQUE (game_history_id, round_number)
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (the UNIQUE constraints already index their keys; add the
--    child-table FK indexes the operator's joins want, plus browse helpers).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS game_history_teams_history_idx ON game_history_teams (game_history_id);
CREATE INDEX IF NOT EXISTS game_history_songs_history_idx ON game_history_songs (game_history_id);
CREATE INDEX IF NOT EXISTS game_history_started_at_idx    ON game_history (started_at);
CREATE INDEX IF NOT EXISTS game_history_game_code_idx     ON game_history (game_code);

-- ---------------------------------------------------------------------------
-- 3. RLS + table grants.
--    RLS enabled, NO anon policy -> all anon access denied by default (durable +
--    operator-only). service_role bypasses RLS but still needs base-table
--    privileges (Postgres checks GRANTs before RLS) -- mirror migration 030, or
--    the migrations-only `supabase start` stack 500s on archive with 42501.
--    NOT added to supabase_realtime: nothing subscribes.
-- ---------------------------------------------------------------------------
ALTER TABLE game_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_history_songs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON game_history, game_history_teams, game_history_songs
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. archive_game: snapshot one game into the durable history tables.
--    SECURITY DEFINER, service-role-only. Idempotent. Skips 0-round games.
--    Called by end_game (before marking ended) and cleanup_expired_games (before
--    the DELETE). Safe to call with the live row still present; reads
--    active_games / game_teams / game_rounds and writes game_history*.
--    Returns the game_history.id (existing or new), or NULL when skipped.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION archive_game(p_game_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_started_at timestamptz;
  v_ended_at   timestamptz;
  v_genres     uuid[];
  v_decades    integer[];
  v_round_cnt  integer;
  v_team_cnt   integer;
  v_history_id uuid;
BEGIN
  -- Load the game. Missing row -> nothing to archive (already swept, or never
  -- existed). Return NULL rather than raising so callers can PERFORM blindly.
  SELECT ag.started_at, ag.ended_at, ag.selected_genres, ag.selected_decades
    INTO v_started_at, v_ended_at, v_genres, v_decades
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Skip games that never played a round.
  SELECT count(*) INTO v_round_cnt
    FROM game_rounds gr
   WHERE gr.game_code = p_game_code;

  IF v_round_cnt = 0 THEN
    RETURN NULL;
  END IF;

  -- Idempotency: already archived this exact game (code + start instant)?
  SELECT gh.id INTO v_history_id
    FROM game_history gh
   WHERE gh.game_code = p_game_code
     AND gh.started_at = v_started_at;

  IF FOUND THEN
    RETURN v_history_id;
  END IF;

  SELECT count(*) INTO v_team_cnt
    FROM game_teams gt
   WHERE gt.game_code = p_game_code;

  INSERT INTO game_history (
    game_code, started_at, ended_at, round_count,
    selected_genres, selected_decades, team_count
  )
  VALUES (
    p_game_code, v_started_at, COALESCE(v_ended_at, now()), v_round_cnt,
    v_genres, v_decades, v_team_cnt
  )
  ON CONFLICT ON CONSTRAINT game_history_code_started_key DO NOTHING
  RETURNING id INTO v_history_id;

  -- Lost a concurrent insert race: the row now exists, re-read its id and bail
  -- (the winning caller wrote the children).
  IF v_history_id IS NULL THEN
    SELECT gh.id INTO v_history_id
      FROM game_history gh
     WHERE gh.game_code = p_game_code
       AND gh.started_at = v_started_at;
    RETURN v_history_id;
  END IF;

  -- Teams snapshot (final scores).
  INSERT INTO game_history_teams (game_history_id, name, score, joined_at)
  SELECT v_history_id, gt.name, gt.score, gt.joined_at
    FROM game_teams gt
   WHERE gt.game_code = p_game_code;

  -- Songs snapshot, ordered by round_number, denormalised from songs. A round
  -- whose song was already hard-deleted (song_id NULL) keeps a placeholder so
  -- the ordered list stays contiguous; the NOT NULL columns need a fallback.
  INSERT INTO game_history_songs (
    game_history_id, round_number, song_id,
    song_title, song_artist, youtube_id, start_time
  )
  SELECT v_history_id,
         gr.round_number,
         gr.song_id,
         COALESCE(s.title, '(deleted song)'),
         COALESCE(s.artist, ''),
         COALESCE(s.youtube_id::text, ''),
         COALESCE(s.start_time, 0)
    FROM game_rounds gr
    LEFT JOIN songs s ON s.id = gr.song_id
   WHERE gr.game_code = p_game_code
   ORDER BY gr.round_number;

  RETURN v_history_id;
END $$;

-- ---------------------------------------------------------------------------
-- 5a. end_game: archive BEFORE marking ended, so the snapshot reflects final
--     scores and a failed archive aborts the whole transaction (the game stays
--     un-ended and the host can retry). Identical to migration 005 except the
--     single PERFORM line. Signature/return unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION end_game(p_game_code char(6))
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ended_at timestamptz;
  v_status   text;
BEGIN
  SELECT status, ended_at INTO v_status, v_ended_at
    FROM active_games WHERE game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'ended' THEN
    RAISE EXCEPTION 'game_already_ended' USING ERRCODE = 'P0001';
  END IF;

  -- Snapshot to durable history before the row is eventually swept. archive_game
  -- is idempotent and skips 0-round games, so this is safe and cheap. ended_at is
  -- still NULL on the live row here, so archive_game stamps history.ended_at =
  -- now() (its COALESCE fallback) -- the same instant the UPDATE below sets,
  -- within one transaction. The cast bridges char(6) -> text.
  PERFORM archive_game(p_game_code::text);

  UPDATE active_games
     SET status   = 'ended',
         ended_at = now()
   WHERE game_code = p_game_code
   RETURNING ended_at INTO v_ended_at;

  RETURN v_ended_at;
END $$;

-- ---------------------------------------------------------------------------
-- 5b. cleanup_expired_games: archive every expiring game BEFORE the DELETE.
--     archive_game no-ops games already archived by end_game and skips 0-round
--     games, so the sweep archives exactly the abandoned games that played
--     rounds but were never explicitly ended. Signature/return unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_expired_games()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Archive first. PERFORM ... FROM drives one archive_game call per expiring
  -- game; idempotent + 0-round-skipping handle the end_game'd and never-played
  -- cases.
  PERFORM archive_game(ag.game_code)
     FROM active_games ag
    WHERE ag.expires_at < now();

  WITH deleted AS (
    DELETE FROM active_games
     WHERE expires_at < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM deleted;

  RETURN v_count;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Function grants. archive_game is service-role-only; end_game and
--    cleanup_expired_games were already locked down by migrations 006/020, but
--    CREATE OR REPLACE can re-trip hosted-Supabase's auto-grant-to-anon, so
--    re-assert the revoke for all three (mirror migration 020). Naturally
--    idempotent.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('archive_game', 'end_game', 'cleanup_expired_games')
  LOOP
    EXECUTE format('REVOKE ALL    ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', fn);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;
