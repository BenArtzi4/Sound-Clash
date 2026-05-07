-- Migration 015: Relax active_games.total_rounds for the round-limit removal.
--
-- The column is no longer used by application code. Old backend code still
-- INSERTs total_rounds explicitly; new backend code omits it. To keep both
-- shapes working during the rollout, drop the NOT NULL constraint and add a
-- default. A follow-up migration will DROP the column entirely once every
-- live backend is on the new contract.
--
-- Idempotent: ALTER COLUMN ... DROP NOT NULL is a no-op on an already-nullable
-- column, and SET DEFAULT just overwrites whatever default was there.
ALTER TABLE active_games ALTER COLUMN total_rounds DROP NOT NULL;
ALTER TABLE active_games ALTER COLUMN total_rounds SET DEFAULT 0;
