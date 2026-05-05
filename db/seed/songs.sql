-- songs.sql
-- Minimal song catalog for the Sound-Clash-Preview Supabase project.
-- 12 placeholder songs across rock / pop / electronic / soundtrack so the
-- Phase 6 Playwright e2e suite can run a 3-round game without exhausting
-- pick_random_song.
--
-- Run once after migrations against the preview project:
--   psql "$PREVIEW_DATABASE_URL" -f db/seed/songs.sql
--
-- Idempotent: songs match by youtube_id; song_genres rely on the
-- (song_id, genre_id) primary key + ON CONFLICT DO NOTHING.
--
-- youtube_ids are intentionally placeholder strings that match the schema
-- regex (^[A-Za-z0-9_-]{11}$) but won't resolve to real videos. The YT
-- IFrame Player will surface "Video unavailable"; the e2e flow does not
-- gate on actual playback (round controls work regardless).

INSERT INTO songs (title, artist, youtube_id, start_time, is_soundtrack, source)
SELECT s.title, s.artist, s.youtube_id, s.start_time, s.is_soundtrack, s.source
FROM (VALUES
  ('E2E Test Song 1',  'E2E Test Artist A', 'E2ETEST0001', 0, false, NULL),
  ('E2E Test Song 2',  'E2E Test Artist B', 'E2ETEST0002', 0, false, NULL),
  ('E2E Test Song 3',  'E2E Test Artist C', 'E2ETEST0003', 0, false, NULL),
  ('E2E Test Song 4',  'E2E Test Artist D', 'E2ETEST0004', 0, false, NULL),
  ('E2E Test Song 5',  'E2E Test Artist E', 'E2ETEST0005', 0, false, NULL),
  ('E2E Test Song 6',  'E2E Test Artist F', 'E2ETEST0006', 0, false, NULL),
  ('E2E Test Song 7',  'E2E Test Artist G', 'E2ETEST0007', 0, false, NULL),
  ('E2E Test Song 8',  'E2E Test Artist H', 'E2ETEST0008', 0, false, NULL),
  ('E2E Test Song 9',  'E2E Test Artist I', 'E2ETEST0009', 0, false, NULL),
  ('E2E Test Song 10', 'E2E Test Artist J', 'E2ETEST0010', 0, false, NULL),
  ('E2E Test Song 11', 'E2E Test Artist K', 'E2ETEST0011', 0, true,  'Star Wars'),
  ('E2E Test Song 12', 'E2E Test Artist L', 'E2ETEST0012', 0, true,  'Inception')
) AS s(title, artist, youtube_id, start_time, is_soundtrack, source)
WHERE NOT EXISTS (
  SELECT 1 FROM songs WHERE songs.youtube_id = s.youtube_id
);

INSERT INTO song_genres (song_id, genre_id)
SELECT songs.id, genres.id
FROM songs
JOIN (VALUES
  ('E2ETEST0001', 'rock'),
  ('E2ETEST0002', 'rock'),
  ('E2ETEST0003', 'rock'),
  ('E2ETEST0004', 'rock'),
  ('E2ETEST0005', 'pop'),
  ('E2ETEST0006', 'pop'),
  ('E2ETEST0007', 'pop'),
  ('E2ETEST0008', 'electronic'),
  ('E2ETEST0009', 'electronic'),
  ('E2ETEST0010', 'electronic'),
  ('E2ETEST0011', 'soundtrack'),
  ('E2ETEST0012', 'soundtrack')
) AS m(youtube_id, slug) ON songs.youtube_id = m.youtube_id
JOIN genres ON genres.slug = m.slug
ON CONFLICT (song_id, genre_id) DO NOTHING;
