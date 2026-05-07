-- 011_buzz_in_records_round.sql
-- Fix: buzz_in must also record the winning team on the current
-- game_rounds row, so award_points can credit the team's score.
--
-- Previously, buzz_in only updated active_games.buzzed_team_id (the
-- transient lock indicator that gets reset after each round). It did
-- NOT touch game_rounds.buzzed_team_id, which remained NULL forever.
-- award_points reads game_rounds.buzzed_team_id to decide whom to
-- credit, so it always read NULL and skipped the
-- `UPDATE game_teams SET score = score + v_total` step. Net result:
-- every round closed cleanly, but no score ever changed.
--
-- Why nobody caught this before: the Phase 3 race tests assert on the
-- buzz_in return value and on active_games row state; they never call
-- award_points. The Phase 4 backend tests use the FakeSupabaseClient
-- which mocks `award_points` instead of running it. The Playwright
-- e2e suite is the first thing that exercises buzz_in → award_points
-- end to end against real Postgres.
--
-- CREATE OR REPLACE keeps the same (char, uuid) signature so PostgREST
-- continues to route browser calls to the same function; no API break.

CREATE OR REPLACE FUNCTION buzz_in(
  p_game_code char(6),
  p_team_id   uuid
)
RETURNS TABLE(locked boolean, locked_team_id uuid, locked_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_round_id  uuid;
  v_locked_at timestamptz;
BEGIN
  -- Atomic compare-and-set on active_games. RETURNING captures the
  -- round we just locked and the resulting locked_at, which we need
  -- both for the round update and the function's return value.
  UPDATE active_games ag
     SET buzzed_team_id = p_team_id,
         locked_at      = now()
   WHERE ag.game_code = p_game_code
     AND ag.status = 'playing'
     AND ag.buzzed_team_id IS NULL
  RETURNING ag.current_round_id, ag.locked_at INTO v_round_id, v_locked_at;

  IF FOUND THEN
    -- Mirror the lock onto the round so award_points has a durable
    -- pointer to the winning team. Skip if there's no current round
    -- (defensive; should not happen during status='playing').
    IF v_round_id IS NOT NULL THEN
      UPDATE game_rounds
         SET buzzed_team_id = p_team_id
       WHERE id = v_round_id;
    END IF;

    RETURN QUERY SELECT true, p_team_id, v_locked_at;
  ELSE
    -- Already locked by someone else (or game not playable). Return
    -- the existing winner so the client can render "X buzzed first".
    RETURN QUERY
    SELECT false, ag.buzzed_team_id, ag.locked_at
      FROM active_games ag
     WHERE ag.game_code = p_game_code;
  END IF;
END $$;
