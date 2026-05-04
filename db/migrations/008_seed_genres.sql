-- 008_seed_genres.sql
-- Canonical genre list. Idempotent via ON CONFLICT (slug) DO NOTHING.
--
-- Spec: docs/tasks.md DB-08. The Phase 2 song-import script may add or rename
-- entries; amend this list in the same PR that lands the importer.

INSERT INTO genres (name, slug) VALUES
  ('Rock',        'rock'),
  ('Pop',         'pop'),
  ('Hip-Hop',     'hip-hop'),
  ('Classical',   'classical'),
  ('Soundtrack',  'soundtrack'),
  ('Jazz',        'jazz'),
  ('Electronic',  'electronic'),
  ('Country',     'country'),
  ('R&B',         'rnb'),
  ('Metal',       'metal')
ON CONFLICT (slug) DO NOTHING;
