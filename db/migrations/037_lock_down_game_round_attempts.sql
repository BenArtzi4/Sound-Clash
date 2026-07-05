-- 037_lock_down_game_round_attempts.sql
-- Perf + defense-in-depth (Phase 3, I-AttemptsPub / T-AttemptsRLS):
--   (1) remove game_round_attempts from the supabase_realtime publication, and
--   (2) enable RLS + revoke anon/authenticated base privileges on it.
--
-- game_round_attempts (mig 016) records one row per scored buzz for future
-- analytics (e.g. an X-Streaks flame badge). Mig 016 added it to the
-- supabase_realtime publication with REPLICA IDENTITY FULL -- but NOTHING
-- subscribes to it: the frontend's useGameChannel subscribes only to
-- active_games / game_teams / game_rounds. So Supabase WAL-decodes and broadcasts
-- a full attempts row on every scored buzz for zero consumers -- pure
-- Realtime-quota + WAL waste. Drop it from the publication. If X-Streaks is ever
-- built it re-adds the table to the publication deliberately, as part of that
-- feature (see docs/planning/03-features.md).
--
-- While here, close a latent gap: mig 016 created game_round_attempts WITHOUT
-- enabling RLS, and mig 006 never granted it to anon -- but hosted Supabase's
-- bootstrap auto-grants base privileges on every new public table to
-- anon/authenticated, so on prod anon could read (and write) this table directly,
-- with no RLS to stop it. It holds no secrets (analytics only) and the app never
-- reads it, so impact was low, but this applies the same posture as game_secrets
-- (mig 034) and game_history* (mig 033): RLS ON with no policy (deny-all) + an
-- explicit REVOKE so anon gets a hard permission-denied rather than an
-- RLS-empty result. The award_attempt INSERT is unaffected -- it runs SECURITY
-- DEFINER as the table owner, bypassing both RLS and GRANTs.
--
-- The anon/authenticated roles are created by earlier migrations (006/020/033),
-- which always run before this one, so no defensive CREATE ROLE is needed here
-- (mirrors mig 034).
--
-- Idempotent: the publication drop is guarded on current membership; ENABLE RLS
-- / REVOKE / GRANT are naturally idempotent.

-- 1. Remove from the Realtime publication (guarded: only when present, and only
--    when the publication exists at all -- vanilla Postgres in testcontainers has
--    no supabase_realtime publication).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
          AND tablename = 'game_round_attempts'
     ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.game_round_attempts;
  END IF;
END $$;

-- 2. Lock it down. RLS ON with no policy => anon/authenticated see nothing;
--    REVOKE the base privileges hosted-Supabase auto-grants. Keep service_role
--    able to read it for future analytics; award_attempt inserts as owner.
ALTER TABLE game_round_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON game_round_attempts FROM anon, authenticated;
GRANT SELECT, INSERT ON game_round_attempts TO service_role;
