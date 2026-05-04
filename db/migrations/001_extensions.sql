-- 001_extensions.sql
-- Postgres extensions Sound Clash relies on.
--
-- Spec: docs/data-model.md §2.
--
-- pgcrypto is required for gen_random_uuid().
-- pg_cron drives the hourly cleanup_expired_games() sweep (docs/rpc-functions.md §5).
-- pg_cron is preinstalled on Supabase but absent from vanilla postgres:15. We
-- gracefully skip it when unavailable so the same migration set runs in both
-- testcontainers (CI / local) and Supabase (preview / prod).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
  ELSE
    RAISE NOTICE 'pg_cron extension is not available in this Postgres install. Skipping (required in production on Supabase).';
  END IF;
END $$;
