-- 013_seed_extra_genres.sql
-- Israeli / Mizrahit genres added live during the Phase 7 song-catalog
-- import. Backfilled into version control so a fresh prod rebuild from
-- migrations alone produces the same genre set. Idempotent via
-- ON CONFLICT (slug) DO NOTHING; safe to rerun.
--
-- Pairs with 008_seed_genres.sql; do not delete that file's rows here.

INSERT INTO genres (name, slug) VALUES
  ('Israeli Cover',         'israeli-cover'),
  ('Israeli Pop',           'israeli-pop'),
  ('Israeli Rap & Hip-Hop', 'israeli-rap-hip-hop'),
  ('Israeli Rock-Pop',      'israeli-rock-pop'),
  ('Mizrahit',              'mizrahit')
ON CONFLICT (slug) DO NOTHING;
