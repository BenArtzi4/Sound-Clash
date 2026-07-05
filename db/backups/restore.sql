-- db/backups/restore.sql
--
-- Idempotent disaster-recovery restore of the durable song catalog
-- (genres, songs, song_genres) from the deterministic CSV dumps in this
-- directory. Those CSVs are refreshed weekly by
-- .github/workflows/catalog-backup.yml (Mon 04:17 UTC) and committed via PR,
-- so the repo itself is a recoverable backup of the catalog.
--
-- USAGE -- run from the REPO ROOT so the relative CSV paths resolve:
--
--     psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/backups/restore.sql
--
-- Behaviour: each CSV is loaded into a staging table and its rows are INSERTed
-- into the live catalog with ON CONFLICT DO NOTHING. Rows that already exist are
-- left untouched, so this REFILLS deletions without ever destroying live data
-- and is safe to run repeatedly (a second run inserts zero rows). Insert order
-- respects the foreign keys: genres, then songs, then song_genres.
--
-- Column-agnostic: the staging tables are created `LIKE` the live tables and the
-- CSVs are full-row dumps (SELECT * ORDER BY <pk>), so this keeps working across
-- ADDITIVE schema migrations with no edits. If a migration RENAMES or REORDERS a
-- column, regenerate the CSVs (run catalog-backup.yml) before restoring.
--
-- Repairing a CORRUPTED catalog (not just refilling deletions): the default
-- DO NOTHING never overwrites a live row. To force the committed values to win,
-- add `TRUNCATE public.song_genres, public.songs, public.genres CASCADE;` right
-- after BEGIN -- but ONLY when you are certain no game references these rows.

\set ON_ERROR_STOP on

-- The dumps are UTF-8 (Hebrew titles). Pin the client encoding so \copy reads
-- them correctly no matter the OS/console default -- psql on a Hebrew-locale
-- Windows box otherwise assumes WIN1255 and fails on the Hebrew bytes.
SET client_encoding = 'UTF8';

BEGIN;

CREATE TEMP TABLE _restore_genres (LIKE public.genres) ON COMMIT DROP;
\copy _restore_genres FROM 'db/backups/genres.csv' WITH (FORMAT csv, HEADER true)
INSERT INTO public.genres SELECT * FROM _restore_genres ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE _restore_songs (LIKE public.songs) ON COMMIT DROP;
\copy _restore_songs FROM 'db/backups/songs.csv' WITH (FORMAT csv, HEADER true)
INSERT INTO public.songs SELECT * FROM _restore_songs ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE _restore_song_genres (LIKE public.song_genres) ON COMMIT DROP;
\copy _restore_song_genres FROM 'db/backups/song_genres.csv' WITH (FORMAT csv, HEADER true)
INSERT INTO public.song_genres SELECT * FROM _restore_song_genres ON CONFLICT (song_id, genre_id) DO NOTHING;

COMMIT;
