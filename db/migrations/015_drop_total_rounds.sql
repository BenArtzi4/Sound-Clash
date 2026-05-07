-- Migration 015: Remove the total_rounds limit. Games now run until the
-- host clicks "End game"; round counter is open-ended and the column is
-- unused by every RPC function.
ALTER TABLE active_games DROP COLUMN IF EXISTS total_rounds;
