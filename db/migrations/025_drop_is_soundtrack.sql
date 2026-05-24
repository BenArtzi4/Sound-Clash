-- 025_drop_is_soundtrack.sql
-- Retire the songs.is_soundtrack boolean. It was a scoring modifier until
-- migration 014 (the +5 source bonus), and since then has only been read by
-- the admin list view as a "Soundtrack" genre-tag fallback. The Soundtrack
-- genre + the source text column already capture the concept, so collapse
-- to: source IS NOT NULL is the canonical "this is a soundtrack" marker,
-- and the Soundtrack genre is the game-filterable category, auto-applied
-- whenever source is set.
--
-- Backfills run BEFORE the column drop so we don't lose any rows that were
-- flagged is_soundtrack=true but never tagged with the Soundtrack genre.
-- Both backfills are idempotent via ON CONFLICT DO NOTHING on the
-- song_genres composite primary key.

-- Backfill 1: any row with is_soundtrack=true should also carry the
-- Soundtrack genre tag. Guarded on the column still existing so a second
-- run (after the column is dropped) is a no-op rather than a parse error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'songs'
      AND column_name = 'is_soundtrack'
  ) THEN
    EXECUTE $sql$
      INSERT INTO song_genres (song_id, genre_id)
      SELECT s.id, g.id
      FROM songs s
      CROSS JOIN genres g
      WHERE s.is_soundtrack = true
        AND g.slug = 'soundtrack'
      ON CONFLICT (song_id, genre_id) DO NOTHING
    $sql$;
  END IF;
END $$;

-- Backfill 2: every row with source IS NOT NULL is a soundtrack under the
-- new model, so make sure they all carry the Soundtrack genre tag too.
-- Safe to run unconditionally; idempotent.
INSERT INTO song_genres (song_id, genre_id)
SELECT s.id, g.id
FROM songs s
CROSS JOIN genres g
WHERE s.source IS NOT NULL
  AND g.slug = 'soundtrack'
ON CONFLICT (song_id, genre_id) DO NOTHING;

-- Drop the partial index that targeted the column.
DROP INDEX IF EXISTS songs_is_soundtrack_idx;

-- The select_next_song RPC (migration 022) declares is_soundtrack in its
-- RETURNS TABLE signature. Postgres won't let CREATE OR REPLACE change a
-- function's return signature, so DROP and re-create. The signature is
-- otherwise unchanged from 022.
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
  source        text
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
           s.source
      FROM songs s
     WHERE s.id = v_chosen_song;
END $$;

GRANT EXECUTE ON FUNCTION select_next_song(text, uuid, uuid)
  TO anon, authenticated, service_role;

-- Drop the column.
ALTER TABLE songs DROP COLUMN IF EXISTS is_soundtrack;
