-- 026_split_soundtracks_genre.sql
-- Split the single 'Soundtrack' (slug: soundtrack) genre into two buckets:
--   1. Rename it to 'Soundtracks' (slug: soundtracks) for symmetry with the
--      new sibling, and because the catalog now holds many titles per genre.
--   2. Add 'Israeli Soundtracks' (slug: israeli-soundtracks) for Hebrew
--      film / TV themes (גבעת חלפון, גברת פלפלת, …) so hosts can run a
--      Hebrew-only soundtrack round without forcing English content in.
--   3. Move the six Hebrew-source titles from the generic bucket into the
--      new Israeli bucket. Identification is by youtube_id so the move
--      survives subsequent title/artist edits.
--   4. Clean up one mis-tagged row ('Everything I Wanted' by Billie Eilish
--      had source='Billie Eilish' — the artist name, not a film/TV source).
--      Clear its source and remove the Soundtracks tag; the row stays in
--      the catalog under whatever other genres it has.
--
-- Idempotent against the chained-rerun scenario.
--   - Step A:  on a re-run, mig 008 re-INSERTs the old 'soundtrack' slug
--              (because its conflict clause is on slug, and we renamed
--              that slug away), and mig 025 then back-fills song_genres
--              for it. So before renaming, we re-home those song_genres
--              onto the canonical 'soundtracks' row and delete the rogue
--              'soundtrack' row if 'soundtracks' already exists. Then
--              UPDATE handles the first-run rename. All three statements
--              are no-ops in their non-applicable scenario.
--   - Step B:  ON CONFLICT (slug) DO NOTHING.
--   - Step C:  INSERT … ON CONFLICT (song_id, genre_id) DO NOTHING + the
--              DELETE-by-youtube_id is naturally a no-op once the rows
--              have already been moved.
--   - Step D:  UPDATE WHERE source IS NOT NULL is a no-op once source has
--              been cleared; the DELETE is a no-op once the link is gone.

-- Step A: collapse 'soundtrack' (singular, possibly re-created by mig 008
-- on rerun) into 'soundtracks' (plural, the canonical post-rename row).
-- A.1 — re-home any song_genres still linked to the rogue singular row.
INSERT INTO song_genres (song_id, genre_id)
SELECT sg.song_id, g_new.id
  FROM song_genres sg
  JOIN genres g_old ON g_old.id  = sg.genre_id AND g_old.slug = 'soundtrack'
  JOIN genres g_new ON g_new.slug = 'soundtracks'
ON CONFLICT (song_id, genre_id) DO NOTHING;

-- A.2 — drop the rogue singular row if the canonical plural row exists.
DELETE FROM genres
 WHERE slug = 'soundtrack'
   AND EXISTS (SELECT 1 FROM genres WHERE slug = 'soundtracks');

-- A.3 — first-run path: rename the original Soundtrack row. After A.2 the
-- only surviving 'soundtrack' row is the one inserted by mig 008 on a fresh
-- build (before mig 026 has ever run), so the UPDATE is collision-free.
UPDATE genres
   SET name = 'Soundtracks',
       slug = 'soundtracks'
 WHERE slug = 'soundtrack';

-- Step B: add the new Israeli Soundtracks genre.
INSERT INTO genres (name, slug) VALUES
  ('Israeli Soundtracks', 'israeli-soundtracks')
ON CONFLICT (slug) DO NOTHING;

-- Step C: move the 6 Hebrew-source titles from soundtracks -> israeli-soundtracks.
--   8H0cvMSAhLY  גבעת חלפון אינה עונה
--   9SZZDDXyWVY  נילס הולגרסון
--   g49huS-qQ1Y  גברת פלפלת
--   WoKEdEy_g1A  הדרדסים
--   qF0gBrO4gIY  איזה עולם (משמש)
--   sHfwZFzMclk  הפיג'מות
INSERT INTO song_genres (song_id, genre_id)
SELECT s.id, g.id
  FROM songs s
  JOIN genres g ON g.slug = 'israeli-soundtracks'
 WHERE s.youtube_id IN (
   '8H0cvMSAhLY',
   '9SZZDDXyWVY',
   'g49huS-qQ1Y',
   'WoKEdEy_g1A',
   'qF0gBrO4gIY',
   'sHfwZFzMclk'
 )
ON CONFLICT (song_id, genre_id) DO NOTHING;

DELETE FROM song_genres sg
 USING songs s, genres g
 WHERE sg.song_id = s.id
   AND sg.genre_id = g.id
   AND g.slug = 'soundtracks'
   AND s.youtube_id IN (
     '8H0cvMSAhLY',
     '9SZZDDXyWVY',
     'g49huS-qQ1Y',
     'WoKEdEy_g1A',
     'qF0gBrO4gIY',
     'sHfwZFzMclk'
   );

-- Step D: clean up 'Everything I Wanted' (Billie Eilish) — source was mis-set
-- to the artist name rather than a film/TV source. Guarded on source still
-- existing (mig 027 dropped it) so a chain-rerun is a no-op.
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
         SET source = NULL
       WHERE youtube_id = 'e8psHWLGDN4'
         AND source IS NOT NULL
    $sql$;
  END IF;
END $$;

DELETE FROM song_genres sg
 USING songs s, genres g
 WHERE sg.song_id = s.id
   AND sg.genre_id = g.id
   AND g.slug = 'soundtracks'
   AND s.youtube_id = 'e8psHWLGDN4';
