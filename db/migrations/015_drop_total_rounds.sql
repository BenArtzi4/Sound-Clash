-- Migration 015: Relax active_games.total_rounds for the round-limit removal.
--
-- The column is no longer used by application code. Old backend code still
-- INSERTs total_rounds explicitly; new backend code omits it. To keep both
-- shapes working during the rollout, drop the NOT NULL constraint and add a
-- default. Migration 040 later DROPs the column entirely.
--
-- Idempotent AND re-runnable after 040: guarded with IF EXISTS so replaying the
-- full migration set once 040 has dropped total_rounds is a clean no-op. (CI
-- applies every migration twice to verify idempotency; without the guard the
-- second pass fails here with "column total_rounds does not exist" because
-- migration 003's CREATE TABLE IF NOT EXISTS won't re-add a column to the
-- already-existing table.) On a DB that still has the column the two ALTERs run
-- as before -- DROP NOT NULL is a no-op on an already-nullable column and SET
-- DEFAULT just overwrites whatever default was there.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'active_games' AND column_name = 'total_rounds'
  ) THEN
    ALTER TABLE active_games ALTER COLUMN total_rounds DROP NOT NULL;
    ALTER TABLE active_games ALTER COLUMN total_rounds SET DEFAULT 0;
  END IF;
END $$;
