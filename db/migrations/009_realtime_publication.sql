-- 009_realtime_publication.sql
-- Add ephemeral tables to the `supabase_realtime` publication so that
-- INSERT/UPDATE/DELETE row changes are broadcast over Supabase Realtime
-- (WebSocket). Without this, every client subscribes successfully but
-- never receives a single event; the publication filters them out.
--
-- Idempotent: guards each ALTER PUBLICATION with a pg_publication_tables
-- check. Skips entirely when the publication doesn't exist (vanilla
-- Postgres in testcontainers has no `supabase_realtime` publication).
--
-- REPLICA IDENTITY FULL ensures DELETE events emit the full old row, not
-- just the primary key. Our useGameChannel reducer reads `payload.old.id`
-- to evict from local state; that works either way, but FULL is the
-- standard Supabase Realtime recommendation and lets future code rely on
-- other old-row fields without surprise.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'supabase_realtime publication not found; skipping (vanilla postgres).';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'active_games'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.active_games;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'game_teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_teams;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'game_rounds'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rounds;
  END IF;
END $$;

ALTER TABLE public.active_games REPLICA IDENTITY FULL;
ALTER TABLE public.game_teams   REPLICA IDENTITY FULL;
ALTER TABLE public.game_rounds  REPLICA IDENTITY FULL;
