-- 004_indexes.sql
-- Spec: docs/data-model.md §3.

CREATE INDEX IF NOT EXISTS active_games_expires_at_idx ON active_games (expires_at);
CREATE INDEX IF NOT EXISTS game_teams_game_code_idx    ON game_teams  (game_code);
CREATE INDEX IF NOT EXISTS game_rounds_game_code_idx   ON game_rounds (game_code);
-- songs_is_soundtrack_idx: guarded on the column existing so the migration is
-- still safe to re-run after migration 025 dropped songs.is_soundtrack.
-- (CI applies migrations twice to verify idempotency.) Once the column has
-- been dropped, the partial index has no purpose; this block is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'songs'
      AND column_name = 'is_soundtrack'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS songs_is_soundtrack_idx ON songs (is_soundtrack) WHERE is_soundtrack = true';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS song_genres_genre_idx       ON song_genres (genre_id);
