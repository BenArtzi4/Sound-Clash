-- db/backups/restore.sql
--
-- Idempotent disaster-recovery restore of the durable song catalog
-- (genres, songs, song_genres) and of the two durable setlist tables
-- (artist_aliases, song_demand; migration 061) from the deterministic CSV dumps
-- in this directory. The CSVs are NOT in the repo (it is public): the weekly
-- .github/workflows/catalog-backup.yml run (Mon 04:17 UTC) keeps them as an
-- encrypted workflow artifact for 90 days. Download the newest one and decrypt
-- it into this folder first (docs/runbook.md §6 has the exact commands).
--
-- USAGE -- run from the REPO ROOT so the relative CSV paths resolve:
--
--     psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/backups/restore.sql
--
-- An archive made before 2026-11-24 has no artist_aliases.csv / song_demand.csv;
-- restore it with `-v skip_setlist_tables=1` added to that command.
--
-- Behaviour: each CSV is loaded into a staging table and its rows are INSERTed
-- into the live table with ON CONFLICT DO NOTHING. Rows that already exist are
-- left untouched, so this REFILLS deletions without ever destroying live data
-- and is safe to run repeatedly (a second run inserts zero rows). Insert order
-- respects the foreign keys: genres, then songs, then song_genres; the two
-- setlist tables have none. Everything is one transaction: any error restores
-- nothing.
--
-- Column-agnostic: the staging tables are created `LIKE` the live tables and the
-- CSVs are full-row dumps (SELECT * ORDER BY <pk>), so this keeps working across
-- ADDITIVE schema migrations with no edits. Each INSERT names only the live
-- table's ordinary columns (read from information_schema): a GENERATED column
-- such as songs.artist_keys (migration 049) cannot take a value, and Postgres
-- recomputes it from the restored row. If a migration RENAMES or REORDERS a
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

-- 1. Load every CSV into a staging table.
CREATE TEMP TABLE _restore_genres (LIKE public.genres) ON COMMIT DROP;
\copy _restore_genres FROM 'db/backups/genres.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE _restore_songs (LIKE public.songs) ON COMMIT DROP;
\copy _restore_songs FROM 'db/backups/songs.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE _restore_song_genres (LIKE public.song_genres) ON COMMIT DROP;
\copy _restore_song_genres FROM 'db/backups/song_genres.csv' WITH (FORMAT csv, HEADER true)

\if :{?skip_setlist_tables}
\echo 'skip_setlist_tables is set: artist_aliases and song_demand are not restored'
\else
CREATE TEMP TABLE _restore_artist_aliases (LIKE public.artist_aliases) ON COMMIT DROP;
\copy _restore_artist_aliases FROM 'db/backups/artist_aliases.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE _restore_song_demand (LIKE public.song_demand) ON COMMIT DROP;
\copy _restore_song_demand FROM 'db/backups/song_demand.csv' WITH (FORMAT csv, HEADER true)
\endif

-- 2. One INSERT per loaded table, in foreign-key order, naming only the live
--    table's non-generated columns. \gexec runs each returned row in order.
SELECT format('INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM pg_temp.%3$I ON CONFLICT (%4$s) DO NOTHING',
              r.tbl,
              string_agg(quote_ident(c.column_name::text), ', ' ORDER BY c.ordinal_position),
              '_restore_' || r.tbl,
              r.conflict)
  FROM (VALUES (1, 'genres', 'id'),
               (2, 'songs', 'id'),
               (3, 'song_genres', 'song_id, genre_id'),
               (4, 'artist_aliases', 'alias'),
               (5, 'song_demand', 'line_key')) AS r(step, tbl, conflict)
  JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = r.tbl AND c.is_generated = 'NEVER'
 WHERE to_regclass('pg_temp._restore_' || r.tbl) IS NOT NULL
 GROUP BY r.step, r.tbl, r.conflict
 ORDER BY r.step
\gexec

COMMIT;
