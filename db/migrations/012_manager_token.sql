-- 012_manager_token.sql
-- Add per-game manager token to active_games.
--
-- Why: hosting a game no longer requires the global ADMIN_PASSWORD env var -
-- anyone can create a game from the home page. To preserve the property "only
-- the host can manage their own game" (award points, kick teams, end the
-- round) without a user-account system, the backend generates a random uuid
-- at game creation, returns it to the host's browser, and requires it on
-- every manager-only endpoint. Players who learn the game code still cannot
-- manage it.
--
-- The token has the same lifetime as the row (4-hour TTL via cleanup), so no
-- separate retention concern.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Existing rows pick up gen_random_uuid()
-- because the column is NOT NULL with a default; Postgres backfills.

ALTER TABLE active_games
  ADD COLUMN IF NOT EXISTS manager_token uuid NOT NULL DEFAULT gen_random_uuid();
