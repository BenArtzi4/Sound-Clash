-- 007_cron_jobs.sql
-- Schedule the hourly sweep of expired games.
--
-- Spec: docs/rpc-functions.md §5.
--
-- Idempotent: unschedule first if a job by the same name already exists, then
-- schedule fresh. Skips entirely when pg_cron is not loaded (testcontainers
-- runs vanilla postgres:15, which has no pg_cron).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not loaded; skipping cleanup-expired-games schedule.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-expired-games') THEN
    PERFORM cron.unschedule('cleanup-expired-games');
  END IF;

  PERFORM cron.schedule(
    'cleanup-expired-games',
    '0 * * * *',
    $cron$ SELECT cleanup_expired_games(); $cron$
  );
END $$;
