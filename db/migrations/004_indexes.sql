-- 004_indexes.sql
-- Spec: docs/data-model.md §3.

CREATE INDEX IF NOT EXISTS active_games_expires_at_idx ON active_games (expires_at);
CREATE INDEX IF NOT EXISTS game_teams_game_code_idx    ON game_teams  (game_code);
CREATE INDEX IF NOT EXISTS game_rounds_game_code_idx   ON game_rounds (game_code);
CREATE INDEX IF NOT EXISTS songs_is_soundtrack_idx     ON songs (is_soundtrack) WHERE is_soundtrack = true;
CREATE INDEX IF NOT EXISTS song_genres_genre_idx       ON song_genres (genre_id);
