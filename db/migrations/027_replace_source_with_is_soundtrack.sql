-- 027_replace_source_with_is_soundtrack.sql
-- Migration 025 collapsed the is_soundtrack/source pair down to just
-- source IS NOT NULL as the canonical "soundtrack round" marker. With the
-- catalog now consistently using title=artist=show_name for soundtracks
-- (see docs/data-model.md), the source text column is redundant: every
-- value it holds is already (or should be) duplicated into title.
--
-- This migration finishes the simplification:
--   1. Re-introduce songs.is_soundtrack boolean (so the marker is a single
--      cheap column instead of "source IS NOT NULL" across every read path).
--   2. Backfill is_soundtrack = true for every row that currently has a
--      non-null source.
--   3. Overwrite title and artist with the source value for those rows --
--      the original song name / composer info is discarded (per user
--      decision: for a soundtrack, only the show name matters, and it
--      should appear as both title and artist so non-soundtrack code paths
--      can read them without a NULL-check).
--   4. Drop the source column.
--   5. Re-issue select_next_song so RETURNS TABLE now contains
--      is_soundtrack boolean in place of source text.
--
-- Idempotency: the backfill / column-drop steps are guarded on the source
-- column still existing, so a second pass after success is a no-op. The
-- function re-creation runs unconditionally via DROP + CREATE OR REPLACE.

-- Step 1: add the boolean column (idempotent via IF NOT EXISTS).
ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_soundtrack boolean NOT NULL DEFAULT false;

-- Step 2 + 3: backfill from source while it still exists. Guarded so a
-- post-drop rerun is a no-op rather than a "column does not exist" error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'songs'
      AND column_name = 'source'
  ) THEN
    EXECUTE $sql$
      UPDATE songs
         SET is_soundtrack = true,
             title         = source,
             artist        = source
       WHERE source IS NOT NULL
    $sql$;
  END IF;
END $$;

-- Step 4: drop the source column.
ALTER TABLE songs DROP COLUMN IF EXISTS source;

-- Step 5: re-issue select_next_song with is_soundtrack in the RETURNS list.
-- Postgres refuses CREATE OR REPLACE when RETURNS TABLE changes shape, so
-- DROP first. Body is identical to migration 025 except for the column swap.
DROP FUNCTION IF EXISTS select_next_song(text, uuid, uuid);

CREATE OR REPLACE FUNCTION select_next_song(
  p_game_code      text,
  p_manager_token  uuid,
  p_song_id        uuid DEFAULT NULL
)
RETURNS TABLE(
  round_id      uuid,
  round_number  integer,
  song_id       uuid,
  song_title    text,
  song_artist   text,
  youtube_id    text,
  start_time    integer,
  is_soundtrack boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected_token uuid;
  v_game_ended_at  timestamptz;
  v_genres         uuid[];
  v_chosen_song    uuid;
  v_round_id       uuid;
  v_round_number   integer;
BEGIN
  SELECT ag.manager_token, ag.ended_at, ag.selected_genres
    INTO v_expected_token, v_game_ended_at, v_genres
    FROM active_games ag
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

  IF v_genres IS NULL OR cardinality(v_genres) = 0 THEN
    RAISE EXCEPTION 'no_genres_selected' USING ERRCODE = '22023';
  END IF;

  IF p_song_id IS NOT NULL THEN
    PERFORM 1 FROM songs WHERE id = p_song_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'song_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_chosen_song := p_song_id;
  ELSE
    WITH played AS (
      SELECT gr.song_id AS sid
        FROM game_rounds gr
       WHERE gr.game_code = p_game_code
         AND gr.song_id IS NOT NULL
    ),
    eligible AS (
      SELECT sg.genre_id AS gid, sg.song_id AS sid
        FROM song_genres sg
       WHERE sg.genre_id = ANY (v_genres)
         AND sg.song_id NOT IN (SELECT played.sid FROM played)
    ),
    chosen_genre AS (
      SELECT eligible.gid
        FROM eligible
       GROUP BY eligible.gid
       ORDER BY random()
       LIMIT 1
    )
    SELECT e.sid INTO v_chosen_song
      FROM eligible e
      JOIN chosen_genre cg ON cg.gid = e.gid
     ORDER BY random()
     LIMIT 1;

    IF v_chosen_song IS NULL THEN
      RAISE EXCEPTION 'no_more_songs' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_round_id := start_round(p_game_code::char(6), v_chosen_song);

  SELECT ag.round_number INTO v_round_number
    FROM active_games ag
   WHERE ag.game_code = p_game_code;

  RETURN QUERY
    SELECT v_round_id,
           v_round_number,
           s.id,
           s.title,
           s.artist,
           s.youtube_id::text,
           s.start_time,
           s.is_soundtrack
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

GRANT EXECUTE ON FUNCTION select_next_song(text, uuid, uuid)
  TO anon, authenticated, service_role;
