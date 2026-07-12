-- 046_team_secrets.sql
-- Per-team rejoin tokens, stored in a dedicated table that anon can NEVER read
-- (issue #183, host-only reconnect).
--
-- Why: a team that loses its device (dead phone, cleared storage, a different
-- phone) needs a reliable way back to its EXACT game_teams row (same id, same
-- score). Re-typing the team name already reclaims the row (T5.7, the open
-- "easy" path), but that is guessable. This migration adds a non-guessable
-- per-team rejoin_token that only the authenticated host can reveal (via the
-- manager-token-gated GET /games/:code/teams/:id/rejoin-token endpoint), shown
-- as a transient QR the host holds up for the team to scan. The token is NEVER
-- returned to players, NEVER stored in player localStorage, and NEVER fanned
-- out over Realtime.
--
-- This mirrors game_secrets (migration 034): game_teams is in the
-- supabase_realtime publication and anon can SELECT it, so a rejoin_token on
-- game_teams would be broadcast to every subscribed player. Keeping the token
-- in a separate table that is (a) NOT in the Realtime publication and (b) has
-- no anon SELECT closes that leak. The backend reads it with the service-role
-- key; there is no SECURITY DEFINER RPC (rejoin is a cold-start-tolerant
-- FastAPI endpoint, off the buzzer hot path).
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS
-- throughout, and the backfill is ON CONFLICT DO NOTHING, so CI's double-apply
-- and any re-run are clean no-ops.

-- ---------------------------------------------------------------------------
-- 1. The secret table. Keyed on team_id (game_teams' PK) and cascaded with the
--    team, so it inherits the team's ephemerality: when cleanup_expired_games
--    deletes the active_games row, the game_teams rows cascade, and their
--    team_secrets cascade in turn. game_code is carried denormalized so the
--    rejoin lookup can scope by (game_code, rejoin_token); it is cascaded from
--    active_games directly as belt-and-suspenders. Token defaults to a fresh
--    uuid (same generator as the manager token).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_secrets (
  team_id      uuid PRIMARY KEY
               REFERENCES game_teams(id) ON DELETE CASCADE,
  game_code    text NOT NULL
               REFERENCES active_games(game_code) ON DELETE CASCADE,
  rejoin_token uuid NOT NULL DEFAULT gen_random_uuid()
);

-- The rejoin lookup is `WHERE game_code = $1 AND rejoin_token = $2`; index the
-- token (high-cardinality) so that lookup never scans the table.
CREATE INDEX IF NOT EXISTS team_secrets_rejoin_token_idx
  ON team_secrets (rejoin_token);

-- ---------------------------------------------------------------------------
-- 2. Lock it down. RLS ON with NO policies => anon/authenticated see nothing
--    (Realtime + PostgREST both honour RLS). REVOKE the base privileges that
--    hosted-Supabase auto-grants to anon/authenticated as defence-in-depth.
--    The backend uses the service_role key, so it keeps SELECT/INSERT.
--    team_secrets is deliberately NOT added to the supabase_realtime
--    publication.
-- ---------------------------------------------------------------------------
ALTER TABLE team_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON team_secrets FROM anon, authenticated;
GRANT SELECT, INSERT ON team_secrets TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Auto-provision a secret whenever a team is created, in the SAME
--    transaction as the game_teams INSERT, so a team always has exactly one
--    secret and the two can never diverge. SECURITY DEFINER so it succeeds no
--    matter which role inserts the team (the join endpoint uses service_role,
--    but this keeps the invariant even if that changes). The token is
--    DB-generated; the host reads it back (by team_id) to build the QR.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_team_secret() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO team_secrets (team_id, game_code)
  VALUES (NEW.id, NEW.game_code)
  ON CONFLICT (team_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_team_secret ON game_teams;
CREATE TRIGGER trg_create_team_secret
  AFTER INSERT ON game_teams
  FOR EACH ROW EXECUTE FUNCTION create_team_secret();

-- ---------------------------------------------------------------------------
-- 4. Backfill existing teams so in-flight games can be rescued too. ON CONFLICT
--    DO NOTHING keeps a re-run a clean no-op.
-- ---------------------------------------------------------------------------
INSERT INTO team_secrets (team_id, game_code)
  SELECT id, game_code FROM game_teams
  ON CONFLICT (team_id) DO NOTHING;
