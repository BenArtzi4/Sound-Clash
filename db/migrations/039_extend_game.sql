-- 039_extend_game.sql
-- Token-gated "keep playing" extension for the 4-hour game TTL (T4.8 /
-- I-Expiry / X-Extend).
--
-- Why: active_games.expires_at is stamped at CREATION (now() + 4h, mig 003) and
-- the hourly pg_cron sweep (cleanup_expired_games, mig 005/033) deletes any
-- game past it -- mid-round if the party overruns, and lobby time eats into the
-- window too. The manager console shows a countdown that becomes a warning
-- banner in the last ~20 minutes with a single "Keep playing +1h" action; that
-- action calls this RPC.
--
-- Semantics: each call pushes expires_at to GREATEST(expires_at, now()) + 1h.
-- The GREATEST matters in the "past expires_at but not yet swept" window (the
-- sweep is hourly): extending there grants a full hour from now rather than a
-- stale hour that is already partly or wholly consumed. The bump size is fixed
-- server-side -- no caller-supplied interval to abuse. Repeat calls stack; only
-- the token-holding host can call it, the game is their own, and the sweep
-- resumes the moment they stop extending, so no cap is imposed. A 'waiting'
-- (lobby) game is extendable for the same reason a long lobby needs it.
--
-- Security model: identical to award_attempt / release_buzz_lock /
-- select_next_song / peek_next_song since mig 034 -- SECURITY DEFINER, expected
-- token fetched via LEFT JOIN game_secrets (a table anon can never read), same
-- gate order and error contract: game_not_found (P0002) / game_ended (P0001) /
-- manager_token_required (28000). Anon-callable by design; migration 020's
-- REVOKE loop pre-dates this function, so EXECUTE is granted explicitly below.
--
-- Realtime: the UPDATE lands on active_games, which is in the
-- supabase_realtime publication with expires_at already in the frontend's
-- selected columns and diff check, so every subscribed client sees the new
-- deadline with no extra plumbing.
--
-- Idempotent: CREATE OR REPLACE; the defensive DROP mirrors mig 029/038 so a
-- future migration that changes the return shape can't break a re-run of this
-- one with 42P13 "cannot change return type of existing function".

DROP FUNCTION IF EXISTS extend_game(text, uuid);

CREATE OR REPLACE FUNCTION extend_game(
  p_game_code     text,
  p_manager_token uuid
)
RETURNS timestamptz  -- the new expires_at
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_token uuid;
  v_game_ended_at  timestamptz;
  v_new_expires_at timestamptz;
BEGIN
  -- Same gate order as award_attempt (mig 034): row lookup, ended check,
  -- token check -- all before the write.
  SELECT gs.manager_token, ag.ended_at
    INTO v_expected_token, v_game_ended_at
    FROM active_games ag
    LEFT JOIN game_secrets gs ON gs.game_code = ag.game_code
   WHERE ag.game_code = p_game_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_game_ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'game_ended' USING ERRCODE = 'P0001';
  END IF;

  IF v_expected_token IS NULL
     OR p_manager_token IS NULL
     OR v_expected_token <> p_manager_token THEN
    RAISE EXCEPTION 'manager_token_required' USING ERRCODE = '28000';
  END IF;

  UPDATE active_games
     SET expires_at = GREATEST(expires_at, now()) + interval '1 hour'
   WHERE game_code = p_game_code
   RETURNING expires_at INTO v_new_expires_at;

  RETURN v_new_expires_at;
END $$;

-- Anon-callable by design (the in-function token check is the gate), same as
-- select_next_song / peek_next_song. Migration 020's REVOKE loop enumerates a
-- fixed list that pre-dates this function, so grant EXECUTE explicitly.
GRANT EXECUTE ON FUNCTION extend_game(text, uuid)
  TO anon, authenticated, service_role;
