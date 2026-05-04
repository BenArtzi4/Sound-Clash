-- 003_ephemeral_tables.sql
-- The ephemeral half: live game state. Pruned 4 hours after started_at by
-- cleanup_expired_games() (docs/rpc-functions.md §5).
--
-- Spec: docs/data-model.md §2.
--
-- Two FKs on active_games (current_round_id, buzzed_team_id) reference tables
-- created later in this same file, so they're added via ALTER after both
-- tables exist. The DO blocks make the ALTER idempotent across re-runs.

CREATE TABLE IF NOT EXISTS active_games (
  game_code         char(6) PRIMARY KEY,
  status            text NOT NULL DEFAULT 'waiting'
                     CHECK (status IN ('waiting','playing','ended')),
  total_rounds      integer NOT NULL,
  selected_genres   uuid[] NOT NULL DEFAULT '{}',
  round_number      integer NOT NULL DEFAULT 0,
  current_song_id   uuid REFERENCES songs(id) ON DELETE SET NULL,
  current_round_id  uuid,
  buzzed_team_id    uuid,
  locked_at         timestamptz,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '4 hours')
);

CREATE TABLE IF NOT EXISTS game_teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code  char(6) NOT NULL REFERENCES active_games(game_code) ON DELETE CASCADE,
  name       text NOT NULL,
  score      integer NOT NULL DEFAULT 0,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_code, name)
);

CREATE TABLE IF NOT EXISTS game_rounds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code       char(6) NOT NULL REFERENCES active_games(game_code) ON DELETE CASCADE,
  round_number    integer NOT NULL,
  song_id         uuid REFERENCES songs(id) ON DELETE SET NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  buzzed_team_id  uuid REFERENCES game_teams(id) ON DELETE SET NULL,
  title_points    integer NOT NULL DEFAULT 0,
  artist_points   integer NOT NULL DEFAULT 0,
  source_points   integer NOT NULL DEFAULT 0,
  timeout_penalty integer NOT NULL DEFAULT 0,
  ended_at        timestamptz,
  UNIQUE (game_code, round_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'active_games_current_round_fkey'
  ) THEN
    ALTER TABLE active_games
      ADD CONSTRAINT active_games_current_round_fkey
      FOREIGN KEY (current_round_id) REFERENCES game_rounds(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'active_games_buzzed_team_fkey'
  ) THEN
    ALTER TABLE active_games
      ADD CONSTRAINT active_games_buzzed_team_fkey
      FOREIGN KEY (buzzed_team_id) REFERENCES game_teams(id) ON DELETE SET NULL;
  END IF;
END $$;
