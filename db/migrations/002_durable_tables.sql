-- 002_durable_tables.sql
-- The durable half of the schema: the song catalog. Never auto-deleted.
--
-- Spec: docs/data-model.md §2.

CREATE TABLE IF NOT EXISTS songs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  artist        text NOT NULL,
  youtube_id    char(11) NOT NULL,
  start_time    integer NOT NULL DEFAULT 0,
  is_soundtrack boolean NOT NULL DEFAULT false,
  source        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS genres (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS song_genres (
  song_id  uuid REFERENCES songs(id)  ON DELETE CASCADE,
  genre_id uuid REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (song_id, genre_id)
);
