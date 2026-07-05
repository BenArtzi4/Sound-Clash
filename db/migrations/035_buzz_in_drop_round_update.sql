-- 035_buzz_in_drop_round_update.sql
-- Perf (Phase 3, I-Buzz1UPDATE): drop the now-dead game_rounds write from buzz_in.
--
-- Migration 011 taught buzz_in to also write `game_rounds.buzzed_team_id` so the
-- since-replaced award_points could credit the winning team by reading it back.
-- That reader is long gone: award_attempt (mig 016 onward) reads the held lock
-- off active_games.buzzed_team_id, and every UI page reads active_games too.
-- Nothing in the running system reads game_rounds.buzzed_team_id anymore -- the
-- only remaining comparison is the frontend's roundEqual(), which now simply sees
-- NULL === NULL and is inert.
--
-- Why it matters: game_rounds is in the supabase_realtime publication with
-- REPLICA IDENTITY FULL, so that mirror-write broadcast a full game_rounds row (a
-- no-op ROUND_CHANGE) to every subscribed client on EVERY buzz -- doubling the
-- buzz-path Realtime fan-out and forcing a wasted re-render pass on all clients.
-- Dropping the write halves buzz-path events. active_games.buzzed_team_id (the
-- actual lock, read by the UI and by award_attempt) is untouched, so the buzzer
-- semantics and the atomic compare-and-set are byte-for-byte identical: the
-- buzz-race test (10 concurrent -> 1 winner, looped) stays the headline gate.
--
-- CREATE OR REPLACE keeps the (char(6), uuid) signature, so PostgREST routing of
-- the browser's supabase.rpc('buzz_in', ...) call is unchanged. The
-- game_rounds.buzzed_team_id COLUMN is retained (nullable, now vestigial) to keep
-- this a non-destructive, purely additive perf change.
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
  -- locked_at for the return value.
  UPDATE active_games ag
     SET buzzed_team_id = p_team_id,
         locked_at      = now()
   WHERE ag.game_code = p_game_code
     AND ag.status = 'playing'
     AND ag.buzzed_team_id IS NULL
  RETURNING ag.locked_at INTO v_locked_at;

  IF FOUND THEN
    RETURN QUERY SELECT true, p_team_id, v_locked_at;
  ELSE
    -- Already locked by someone else (or game not playable). Return the existing
    -- winner so the client can render "X buzzed first".
    RETURN QUERY
    SELECT false, ag.buzzed_team_id, ag.locked_at
      FROM active_games ag
     WHERE ag.game_code = p_game_code;
  END IF;
END $$;
