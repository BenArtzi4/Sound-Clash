-- The console awards a fixed +4 directly. Older clients keep the service-role
-- REST path, whose award_bonus function also supports custom point values.
BEGIN;

CREATE OR REPLACE FUNCTION public.award_manager_bonus(
  p_game_code     text,
  p_manager_token uuid,
  p_team_id       uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.game_secrets
     WHERE game_code = p_game_code AND manager_token = p_manager_token
  ) THEN
    RAISE EXCEPTION 'manager_token_required' USING ERRCODE = '28000';
  END IF;

  RETURN public.award_bonus(p_game_code, p_team_id, 4);
END $$;

REVOKE ALL ON FUNCTION public.award_manager_bonus(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_manager_bonus(text, uuid, uuid)
  TO anon, authenticated, service_role;

COMMIT;
