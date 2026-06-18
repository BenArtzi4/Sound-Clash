-- 031_song_release_year.sql
-- Adds songs.release_year so a host can later filter the song pool by decade
-- when creating a game. This migration only adds the column (dormant); the
-- picker-side filter and the active_games.selected_decades column arrive in
-- migration 032.
--
-- Semantics: release_year is the ORIGINAL commercial release year of the SONG,
-- not of the particular recording in our catalog. For a cover, store the year
-- the song was first released by its original artist -- a 2012 cover of a 1967
-- song is 1967. This matches how players think about "play 60s music" and is
-- the value the backfill tooling (tools/song-curation/) is built to produce.
--
-- Nullable: NULL means "year unknown / not yet backfilled". A NULL-year song is
-- excluded from a decade-filtered game (it satisfies no specific decade) and
-- included when no decade is chosen -- see migration 032's picker logic.
--
-- integer, not char(n): Supabase Realtime's WAL decoder truncates bpchar, so
-- plain integer columns broadcast cleanly (lessons-learned 2026-05-05). The
-- CHECK keeps obvious typos out (a 3-digit year, an upload timestamp, etc.); the
-- upper bound is a hard literal because a CHECK expression must be immutable
-- (now()/extract are not allowed).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. The inline CHECK is created with the
-- column, so a re-run skips the whole statement and is a no-op.

ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS release_year integer
    CHECK (release_year IS NULL OR release_year BETWEEN 1900 AND 2100);
