-- 049_song_spacing.sql
-- Song spacing: no genre twice in a row, artists spaced and shared out.
--
-- Migration 048 kept genre TOTALS within 2 of each other, but players still
-- heard runs of 3-4 songs from one genre (a genre 2 behind may catch up all at
-- once), and the picker never looked at the artist, so prolific artists came
-- back round after round. In the 15 games played 2026-10-01..08, game EW96PR
-- (Pop + Mizrahit, 2010s, 101 rounds) credited one artist on 18 songs, 5 of
-- them straight after another song by the same artist.
--
-- Maintainer decision (2026-10-09). pick_next_song, the one picker behind
-- select_next_song's random path and peek_next_song, now applies, in order:
--
--   1. GENRE ROTATION: never a genre of the song playing now, as long as
--      another selected genre still has songs. With two genres this is a
--      strict alternation; that predictability was accepted.
--   2. BALANCE (048's rule): a genre may go next only if it has had at most
--      one more turn than the least-played genre that still has songs. If the
--      rotation leaves no genre inside that limit (only possible through songs
--      tagged in two selected genres), the limit is taken among the rotating
--      genres instead, so rule 1 always wins.
--   3. One allowed genre is drawn at random. Inside it, a song that shares no
--      genre with the song playing now beats one that does (a song can carry
--      two selected genres).
--   4. ARTIST SPACING: then a song none of whose artists was heard in the last
--      8 rounds beats one whose artist was; failing that, the artist heard
--      longest ago wins, so a small pool spreads its repeats out.
--   5. ARTIST SHARE: among the songs left tied, each is weighted by
--      1 / (1 + plays)^2, where plays is how many songs in this game already
--      credited its most-played artist. Artists heard less get their turn.
--      Exception: an artist holding half or more of the genre's remaining
--      songs is not held back (plays counts as 0), because in a game that is
--      using up a small pool, holding it back only bunches its songs at the
--      end.
--
-- Rules 4 and 5 were chosen by simulating 30-60 games per setting on the
-- 2026-10 catalog, then confirmed on prod with this exact SQL (rolled back):
-- in a 30-round, 3-genre Israeli game the artists heard 3+ times fell from
-- 2.6 per game (048) to 0.2, and songs by the same artist within 8 rounds
-- from 5.6 to 0. Where the pool really runs short (2010s Mizrahit: 57 songs,
-- 19 of them crediting one artist, in a 101-round game) repeats cannot be
-- avoided; rules 4 and 5 spread them out.
--
-- Artists come from songs.artist, which is free text: "X & Y", "X ft. Y",
-- "X featuring Y", "X, Y", "X vs. Y", "X x Y" and the Hebrew "X וY" each credit
-- every named artist, so a duet counts for both. song_artist_keys() does that
-- split. On the 2026-10 catalog it splits 160 of 808 artist strings, and every
-- key two strings share is a real shared artist. A wrong split ("Blood, Sweat &
-- Tears") only adds spacing; it never blocks a song, because the fallbacks
-- above always return a song while any is left.
--
-- Performance: the picker runs in the background during the current round
-- (peek_next_song prebuffers the next video), and the Next-round click commits
-- the peeked id through select_next_song's p_song_id path, which never calls
-- the picker; only the rare cold path (nothing prebuffered) runs it on the
-- click. A first draft split artist names inside the pick and took 250-900ms
-- per call on an 8-genre game (the split ran once per candidate per artist
-- heard). So the split now happens once, when a song is written:
-- songs.artist_keys is a STORED generated column, and the pick only joins
-- arrays. Measured cost: docs/rpc-functions.md §3cc.
--
-- If song_artist_keys' body ever changes, existing rows keep their old keys
-- until rewritten: follow the change with `UPDATE songs SET artist = artist`.
--
-- Shape: pick_next_song keeps its signature and RETURNS, so select_next_song,
-- peek_next_song, their grants and the RPC contract are untouched. Idempotent:
-- CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS and re-runnable REVOKE/GRANT.

-- ---------------------------------------------------------------------------
-- song_artist_keys: the artists credited in a songs.artist string, lowercased
-- and trimmed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION song_artist_keys(p_artist text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT parts.k), '{}')
    FROM (
      SELECT lower(btrim(piece)) AS k
        FROM regexp_split_to_table(
               coalesce(p_artist, ''),
               -- " & ", " featuring ", " feat. ", " ft. ", " vs. " | " x " (but
               -- not the X of "Lil Nas X & ...") | "," | the Hebrew " ו" prefix
               '\s+(?:&|featuring|feat\.?|ft\.?|vs\.?)\s+|\s+x\s+(?!&)|\s*,\s*|\s+ו(?=\S)',
               'i'
             ) AS piece
    ) parts
   WHERE parts.k <> '';
$$;

REVOKE EXECUTE ON FUNCTION song_artist_keys(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION song_artist_keys(text) TO service_role;

-- Computed by Postgres on every insert and on every update of artist (the
-- admin API and CSV import write songs as service_role, which has EXECUTE).
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS artist_keys text[]
  GENERATED ALWAYS AS (song_artist_keys(artist)) STORED;

-- ---------------------------------------------------------------------------
-- pick_next_song: same signature as migration 048. Returns NULL when no
-- eligible song is left.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pick_next_song(
  p_game_code text,
  p_genres    uuid[],
  p_decades   integer[]
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  WITH played AS (
    SELECT gr.song_id AS sid, gr.round_number AS rn
      FROM game_rounds gr
     WHERE gr.game_code = p_game_code
       AND gr.song_id IS NOT NULL
  ),
  last_round AS (
    SELECT max(played.rn) AS rn FROM played
  ),
  -- Selected genres of the song playing now (the latest round).
  current_genres AS (
    SELECT sg.genre_id AS gid
      FROM played p
      JOIN last_round lr ON lr.rn = p.rn
      JOIN song_genres sg
        ON sg.song_id = p.sid
       AND sg.genre_id = ANY (p_genres)
  ),
  -- (genre, song) pairs still playable in this game. A multi-genre song
  -- appears once per selected genre it belongs to.
  eligible AS (
    SELECT sg.genre_id AS gid, s.id AS sid, s.artist_keys
      FROM songs s
      JOIN song_genres sg
        ON sg.song_id = s.id
       AND sg.genre_id = ANY (p_genres)
     WHERE s.id NOT IN (SELECT played.sid FROM played)
       AND (
             coalesce(cardinality(p_decades), 0) = 0
             OR (s.release_year / 10 * 10) = ANY (p_decades)
           )
       AND s.unavailable_at IS NULL  -- dead-video auto-skip (mig 045)
  ),
  -- Turns each selected genre has already had: songs played in this game that
  -- belong to it (a song in two selected genres counts for both).
  turns AS (
    SELECT g.gid, count(sg.song_id) AS n
      FROM (SELECT DISTINCT unnest(p_genres) AS gid) g
      LEFT JOIN song_genres sg
        ON sg.genre_id = g.gid
       AND sg.song_id IN (SELECT played.sid FROM played)
     GROUP BY g.gid
  ),
  alive AS (
    SELECT t.gid, t.n
      FROM turns t
     WHERE EXISTS (SELECT 1 FROM eligible e WHERE e.gid = t.gid)
  ),
  -- Rule 1: drop the genre(s) playing now, unless no other genre has songs.
  rotating AS (
    SELECT a.gid, a.n
      FROM alive a
     WHERE a.gid NOT IN (SELECT current_genres.gid FROM current_genres)
        OR NOT EXISTS (
             SELECT 1 FROM alive a2
              WHERE a2.gid NOT IN (SELECT current_genres.gid FROM current_genres)
           )
  ),
  -- Rule 2: at most one turn ahead of the least-played alive genre; if the
  -- rotation left none inside that, of the least-played rotating genre.
  turn_limit AS (
    SELECT CASE
             WHEN EXISTS (
               SELECT 1 FROM rotating r
                WHERE r.n <= (SELECT min(a.n) FROM alive a) + 1
             )
             THEN (SELECT min(a.n) FROM alive a) + 1
             ELSE (SELECT min(r.n) FROM rotating r) + 1
           END AS n
  ),
  chosen_genre AS (
    SELECT r.gid
      FROM rotating r
      CROSS JOIN turn_limit tl
     WHERE r.n <= tl.n
     ORDER BY random()
     LIMIT 1
  ),
  -- Every artist credited in this game: how many songs credited it and how
  -- many rounds ago it was last heard (1 = the song playing now).
  artist_history AS (
    SELECT k.akey, count(*) AS plays, min(lr.rn - p.rn + 1) AS ago
      FROM played p
      CROSS JOIN last_round lr
      JOIN songs s ON s.id = p.sid
      CROSS JOIN LATERAL unnest(s.artist_keys) AS k(akey)
     GROUP BY k.akey
  ),
  -- Songs tagged in a genre of the song playing now.
  current_genre_songs AS (
    SELECT DISTINCT sg.song_id
      FROM song_genres sg
      JOIN current_genres cg ON cg.gid = sg.genre_id
  ),
  -- How many of the chosen genre's playable songs each artist still has.
  genre_artists_left AS (
    SELECT k.akey, count(*) AS n
      FROM eligible e
      JOIN chosen_genre c ON c.gid = e.gid
      CROSS JOIN LATERAL unnest(e.artist_keys) AS k(akey)
     GROUP BY k.akey
  ),
  genre_left AS (
    SELECT count(*) AS n
      FROM eligible e
      JOIN chosen_genre c ON c.gid = e.gid
  ),
  -- One set-based pass over the chosen genre's songs (no per-song subquery).
  scored AS (
    SELECT e.sid,
           -- Rule 3: shares a genre with the song playing now.
           bool_or(cur.song_id IS NOT NULL) AS same_genre,
           -- Rule 4: 9 = none of its artists heard in the last 8 rounds,
           -- otherwise rounds since the most recent of them was heard.
           least(coalesce(min(h.ago), 9), 9) AS spacing,
           -- Rule 5: songs already credited to its most-played artist, and
           -- the most songs any of its artists still has in this genre.
           coalesce(max(h.plays), 0) AS plays,
           coalesce(max(gal.n), 0) AS artist_left
      FROM eligible e
      JOIN chosen_genre c ON c.gid = e.gid
      LEFT JOIN current_genre_songs cur ON cur.song_id = e.sid
      LEFT JOIN LATERAL unnest(e.artist_keys) AS k(akey) ON true
      LEFT JOIN artist_history h ON h.akey = k.akey
      LEFT JOIN genre_artists_left gal ON gal.akey = k.akey
     GROUP BY e.sid
  ),
  ranked AS (
    SELECT s.sid,
           -- An artist holding half or more of what the genre has left is not
           -- held back: deferring it would only bunch its songs at the end.
           CASE WHEN s.artist_left * 2 >= gl.n THEN 0 ELSE s.plays END AS plays,
           rank() OVER (ORDER BY s.same_genre, s.spacing DESC) AS rk
      FROM scored s
      CROSS JOIN genre_left gl
  )
  -- Weighted draw (Efraimidis-Spirakis): the smallest Exp(1) / weight wins,
  -- so each song wins with probability proportional to 1 / (1 + plays)^2.
  -- 1 - random() is in (0, 1], so ln() never sees 0.
  SELECT r.sid
    FROM ranked r
   WHERE r.rk = 1
   ORDER BY -ln(1 - random()) * (1 + r.plays) * (1 + r.plays)
   LIMIT 1;
$$;

-- Internal helper (unchanged from 048): not browser-callable.
REVOKE EXECUTE ON FUNCTION pick_next_song(text, uuid[], integer[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pick_next_song(text, uuid[], integer[])
  TO service_role;
