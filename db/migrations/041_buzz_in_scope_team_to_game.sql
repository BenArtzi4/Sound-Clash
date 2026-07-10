-- 041_buzz_in_scope_team_to_game.sql
-- Security: scope buzz_in's lock claim to teams that belong to the game, closing
-- a cross-game score-write vector.
--
-- The bug: buzz_in's atomic compare-and-set set active_games.buzzed_team_id =
-- p_team_id gated ONLY by the FK (buzzed_team_id -> game_teams.id). That FK is
-- satisfied by ANY game_teams row, including a team that belongs to a DIFFERENT
-- game. A caller who knows one game's code could therefore plant a foreign
-- game's team into that game's buzz lock; award_attempt (mig 036) then
-- credits/debits whatever team currently holds the lock with no game_code filter,
-- so the foreign team's score gets tampered with from a game it never joined.
--
-- The fix: add ONE predicate to the existing conditional UPDATE so a team that is
-- not a member of p_game_code can never win the lock. This mirrors the guard
-- award_bonus already carries (mig 014: the `team_not_in_game` check rejects a
-- team_id whose game_code differs from the target game). A foreign team simply
-- fails the UPDATE and falls through to the existing "already locked / not
-- playable" ELSE return path -- no exception, no extra round-trip.
--
-- Race property is preserved: the claim is still a SINGLE atomic conditional
-- UPDATE (Postgres MVCC + row lock; see realtime-design.md §4). The only change
-- is one extra AND in the WHERE, so the buzz-race test (10 concurrent -> 1
-- winner, looped 100x) -- the headline gate -- is unaffected. This does NOT
-- change the accepted D-4 posture (a client can still buzz as any team WITHIN
-- the same game; the host is the integrity check for that); it only forbids
-- planting a team from another game.
--
-- CREATE OR REPLACE keeps the (char(6), uuid) signature and RETURNS TABLE shape
-- identical to mig 035, so PostgREST routing of the browser's
-- supabase.rpc('buzz_in', ...) call is unchanged.
--
-- Idempotent: CREATE OR REPLACE.

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
  v_locked_at timestamptz;
BEGIN
  -- Atomic compare-and-set on active_games: only the first concurrent caller to
  -- satisfy buzzed_team_id IS NULL wins the UPDATE (Postgres MVCC + row lock make
  -- this race-safe; see realtime-design.md §4). RETURNING captures the resulting
  -- locked_at for the return value. The EXISTS predicate scopes the lock to a
  -- team that belongs to this game, so a foreign game's team can never be planted
  -- into the lock (cross-game score-write guard; see award_bonus's team_not_in_game).
  UPDATE active_games ag
     SET buzzed_team_id = p_team_id,
         locked_at      = now()
   WHERE ag.game_code = p_game_code
     AND ag.status = 'playing'
     AND ag.buzzed_team_id IS NULL
     AND EXISTS (
       SELECT 1 FROM game_teams gt
        WHERE gt.id = p_team_id AND gt.game_code = p_game_code
     )
  RETURNING ag.locked_at INTO v_locked_at;

  IF FOUND THEN
    RETURN QUERY SELECT true, p_team_id, v_locked_at;
  ELSE
    -- Already locked by someone else (or game not playable, or team not a member
    -- of this game). Return the existing winner so the client can render
    -- "X buzzed first".
    RETURN QUERY
    SELECT false, ag.buzzed_team_id, ag.locked_at
      FROM active_games ag
     WHERE ag.game_code = p_game_code;
  END IF;
END $$;
