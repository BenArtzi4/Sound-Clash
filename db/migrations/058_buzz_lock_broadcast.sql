-- 058_buzz_lock_broadcast.sql
-- The atomic active_games update remains the source of truth for both transports.
ALTER TABLE public.active_games
  ADD COLUMN IF NOT EXISTS buzz_revision integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.broadcast_buzz_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.buzz_revision := OLD.buzz_revision + 1;

  IF OLD.buzzed_team_id IS NULL
     AND NEW.buzzed_team_id IS NOT NULL
     AND NEW.current_round_id IS NOT NULL
     AND NEW.status = 'playing'
     AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object(
          'game_code', NEW.game_code,
          'status', NEW.status,
          'selected_genres', NEW.selected_genres,
          'selected_decades', NEW.selected_decades,
          'round_number', NEW.round_number,
          'current_song_id', NEW.current_song_id,
          'started_at', NEW.started_at,
          'ended_at', NEW.ended_at,
          'expires_at', NEW.expires_at,
          'current_round_id', NEW.current_round_id,
          'buzzed_team_id', NEW.buzzed_team_id,
          'locked_at', NEW.locked_at,
          'buzz_revision', NEW.buzz_revision
        ),
        'buzz_locked',
        'buzz:' || NEW.game_code,
        true
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Buzz Broadcast failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.broadcast_buzz_lock() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_broadcast_buzz_lock ON public.active_games;
CREATE TRIGGER trg_broadcast_buzz_lock
  BEFORE UPDATE ON public.active_games
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_buzz_lock();

-- The standalone Postgres race gate has no Supabase Realtime schema.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    DROP POLICY IF EXISTS buzz_broadcast_read ON realtime.messages;
    CREATE POLICY buzz_broadcast_read ON realtime.messages
      FOR SELECT TO anon USING (
        extension = 'broadcast'
        AND topic = (SELECT realtime.topic())
        AND EXISTS (
          SELECT 1 FROM public.active_games AS game
          WHERE game.game_code = substr((SELECT realtime.topic()), 6)
            AND (SELECT realtime.topic()) LIKE 'buzz:%'
        )
      );

    DROP POLICY IF EXISTS buzz_broadcast_no_client_write ON realtime.messages;
    CREATE POLICY buzz_broadcast_no_client_write ON realtime.messages
      AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (
        coalesce((SELECT realtime.topic()), '') NOT LIKE 'buzz:%'
        AND coalesce(topic, '') NOT LIKE 'buzz:%'
      );
  END IF;
END
$$;
