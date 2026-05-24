-- songs.sql
-- Minimal song catalog for the e2e local Supabase stack. 12 songs across
-- rock / pop / electronic / soundtracks so the Playwright suite can run a
-- 3-round game without exhausting pick_random_song.
--
-- Run once after migrations against the local stack:
--   DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
--   psql "$DB_URL" -f db/seed/songs.sql
--
-- Idempotent: songs match by youtube_id; song_genres rely on the
-- (song_id, genre_id) primary key + ON CONFLICT DO NOTHING.
--
-- The youtube_ids are REAL, publicly embeddable videos. Most of the e2e
-- specs don't care whether playback works (they exercise the round-control
-- flow), but manager_cleanup_yt_csp.spec.ts asserts the iframe actually
-- loads a video (guard against the "error 153 / video unavailable" regression),
-- so the seed needs at least the chosen genre to have a real, embeddable ID.

INSERT INTO songs (title, artist, youtube_id, start_time, source)
SELECT s.title, s.artist, s.youtube_id, s.start_time, s.source
FROM (VALUES
  ('E2E Test Song 1',  'E2E Test Artist A', 'dQw4w9WgXcQ', 0, NULL),
  ('E2E Test Song 2',  'E2E Test Artist B', 'jNQXAC9IVRw', 0, NULL),
  ('E2E Test Song 3',  'E2E Test Artist C', '9bZkp7q19f0', 0, NULL),
  ('E2E Test Song 4',  'E2E Test Artist D', 'fJ9rUzIMcZQ', 0, NULL),
  ('E2E Test Song 5',  'E2E Test Artist E', 'kJQP7kiw5Fk', 0, NULL),
  ('E2E Test Song 6',  'E2E Test Artist F', 'OPf0YbXqDm0', 0, NULL),
  ('E2E Test Song 7',  'E2E Test Artist G', 'JGwWNGJdvx8', 0, NULL),
  ('E2E Test Song 8',  'E2E Test Artist H', 'CevxZvSJLk8', 0, NULL),
  ('E2E Test Song 9',  'E2E Test Artist I', '09R8_2nJtjg', 0, NULL),
  ('E2E Test Song 10', 'E2E Test Artist J', 'hT_nvWreIhg', 0, NULL),
  ('E2E Test Song 11', 'E2E Test Artist K', 'nfWlot6h_JM', 0, 'Star Wars'),
  ('E2E Test Song 12', 'E2E Test Artist L', 'e-ORhEE9VVg', 0, 'Inception')
) AS s(title, artist, youtube_id, start_time, source)
WHERE NOT EXISTS (
  SELECT 1 FROM songs WHERE songs.youtube_id = s.youtube_id
);

INSERT INTO song_genres (song_id, genre_id)
SELECT songs.id, genres.id
FROM songs
JOIN (VALUES
  ('dQw4w9WgXcQ', 'rock'),
  ('jNQXAC9IVRw', 'rock'),
  ('9bZkp7q19f0', 'rock'),
  ('fJ9rUzIMcZQ', 'rock'),
  ('kJQP7kiw5Fk', 'pop'),
  ('OPf0YbXqDm0', 'pop'),
  ('JGwWNGJdvx8', 'pop'),
  ('CevxZvSJLk8', 'electronic'),
  ('09R8_2nJtjg', 'electronic'),
  ('hT_nvWreIhg', 'electronic'),
  ('nfWlot6h_JM', 'soundtracks'),
  ('e-ORhEE9VVg', 'soundtracks')
) AS m(youtube_id, slug) ON songs.youtube_id = m.youtube_id
JOIN genres ON genres.slug = m.slug
ON CONFLICT (song_id, genre_id) DO NOTHING;
