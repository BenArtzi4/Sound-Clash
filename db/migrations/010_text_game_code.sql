-- 010_text_game_code.sql
-- Change `game_code` from char(6) to text on all three ephemeral tables.
--
-- Why: Supabase Realtime's logical-replication WAL decoder mishandles
-- bpchar (char(n)) types; it returns only the first character. For
-- game_teams and game_rounds that's harmless because their primary key
-- is `id uuid` (decoded correctly), so Realtime resolves the row via
-- the uuid PK and the filter matches against the actual stored
-- `game_code`. But active_games' PK *is* `game_code`, so Realtime tries
-- to resolve the row using the truncated 'V' instead of 'V6G5SR',
-- finds nothing, and silently drops the UPDATE event. The visible
-- symptom is that managers/teams/displays never see status changes
-- after start_round / award_points / end_game / buzz_in.
--
-- Diagnostic confirmation (run 2026-05-05): with the publication
-- correctly set up and REPLICA IDENTITY FULL, a service-role UPDATE
-- to active_games produced zero events on a subscribed anon client,
-- while INSERT and UPDATE on game_teams (uuid PK) produced one each.
--
-- Idempotent: skips if game_code is already text (data_type='text'
-- in information_schema).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'active_games'
       AND column_name = 'game_code'
       AND data_type = 'character'
  ) THEN
    RAISE NOTICE 'game_code already migrated to text; skipping.';
    RETURN;
  END IF;

  -- Drop FKs that reference active_games.game_code so we can re-type both sides.
  ALTER TABLE game_teams  DROP CONSTRAINT IF EXISTS game_teams_game_code_fkey;
  ALTER TABLE game_rounds DROP CONSTRAINT IF EXISTS game_rounds_game_code_fkey;

  -- Re-type. char(6) values are stored padded to 6 chars; ours are
  -- already exactly 6 chars (codes.py invariant), so the cast is a
  -- no-op data-wise.
  ALTER TABLE active_games ALTER COLUMN game_code TYPE text;
  ALTER TABLE game_teams   ALTER COLUMN game_code TYPE text;
  ALTER TABLE game_rounds  ALTER COLUMN game_code TYPE text;

  -- Re-add FKs with their original semantics.
  ALTER TABLE game_teams
    ADD CONSTRAINT game_teams_game_code_fkey
    FOREIGN KEY (game_code) REFERENCES active_games(game_code) ON DELETE CASCADE;

  ALTER TABLE game_rounds
    ADD CONSTRAINT game_rounds_game_code_fkey
    FOREIGN KEY (game_code) REFERENCES active_games(game_code) ON DELETE CASCADE;
END $$;
