-- 020_lock_down_backend_rpcs.sql
-- Defense in depth: keep the backend-only RPCs off the public anon key.
--
-- start_round / end_round / award_attempt / award_bonus / release_buzz_lock /
-- end_game are called only by FastAPI (with the service-role key, behind the
-- per-game manager_token gate); cleanup_expired_games is called only by
-- pg_cron. buzz_in is the one RPC the browser may call directly, and keeps its
-- anon GRANT (see migration 006).
--
-- Earlier migrations did `REVOKE ALL ... FROM PUBLIC` on these functions, which
-- is enough on a vanilla Postgres. It is NOT enough on hosted Supabase: the
-- Supabase project bootstrap grants EXECUTE on every function in `public`
-- *directly* to anon / authenticated / service_role, and a REVOKE FROM PUBLIC
-- doesn't touch those direct grants. So a browser holding the public anon key
-- could call award_attempt / award_bonus / start_round / end_game / ... via
-- PostgREST RPC, bypassing FastAPI's X-Manager-Token check. Here we revoke
-- EXECUTE explicitly from anon and authenticated, and (re-)assert it for
-- service_role so FastAPI keeps working.
--
-- `authenticated` is created defensively the same way migration 006 creates
-- `anon` / `service_role` -- a no-op on hosted Supabase (it exists natively),
-- and lets this migration apply on the bare Postgres used by the DB tests.
--
-- Idempotent: defensive CREATE ROLE; REVOKE / GRANT are naturally idempotent;
-- the loop simply skips any function that doesn't exist (e.g. award_points,
-- retired by migration 016).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'start_round',
         'end_round',
         'award_attempt',
         'award_bonus',
         'release_buzz_lock',
         'end_game',
         'cleanup_expired_games',
         'award_points'  -- retired by 016; revoked here too if still present
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', fn);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
