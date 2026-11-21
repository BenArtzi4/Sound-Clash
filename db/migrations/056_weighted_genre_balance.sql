-- 056_weighted_genre_balance.sql
-- Keep the draw random within a two-unit genre balance band. Check the full
-- tag set of a song before drawing it and gently favor a change of genre.
-- The picker signature, catalog filters and artist-spacing rules stay intact.

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
  -- A genre heard in the previous round is less likely to go next.
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
  -- A cover round counts as two balance units, giving covers half the target
  -- airtime of other genres in a mixed game.
  genre_pool AS (
    SELECT e.gid, count(*) AS remaining
      FROM eligible e
     GROUP BY e.gid
  ),
  played_turns AS (
    SELECT sg.genre_id AS gid, count(*) AS turns
      FROM played p
      JOIN song_genres sg ON sg.song_id = p.sid
     WHERE sg.genre_id = ANY (p_genres)
     GROUP BY sg.genre_id
  ),
  alive AS (
    SELECT gp.gid, gp.remaining, w.units, coalesce(pt.turns, 0) * w.units AS turns
      FROM genre_pool gp
      JOIN genres g ON g.id = gp.gid
      CROSS JOIN LATERAL (VALUES (CASE WHEN g.slug = 'israeli-cover' THEN 2 ELSE 1 END)) w(units)
      LEFT JOIN played_turns pt ON pt.gid = gp.gid
  ),
  -- If even the largest possible one-round increase fits, every song is
  -- allowed. This skips the per-song tag aggregation on opening rounds.
  balance_check AS (
    SELECT coalesce(max(turns) - min(turns) + max(units) > 2, false) AS needed
      FROM alive
  ),
  song_tags AS (
    SELECT e.sid, array_agg(e.gid ORDER BY e.gid) AS gids
      FROM eligible e
     WHERE (SELECT needed FROM balance_check)
     GROUP BY e.sid
  ),
  -- Songs with identical selected tags produce identical genre counts. Score
  -- those tag sets once, regardless of the number of songs in the pool.
  projected AS (
    SELECT tags.gids, spread.gap
      FROM (SELECT DISTINCT gids FROM song_tags) tags
      CROSS JOIN LATERAL (
        SELECT coalesce(max(after_pick.turns) - min(after_pick.turns), 0) AS gap
          FROM (
            SELECT a.turns + CASE WHEN a.gid = ANY (tags.gids) THEN a.units ELSE 0 END AS turns
              FROM alive a
             WHERE a.remaining > (a.gid = ANY (tags.gids))::integer
          ) after_pick
      ) spread
  ),
  allowed_tags AS (
    SELECT p.gids
      FROM projected p
     WHERE p.gap <= greatest(2, (SELECT min(gap) FROM projected))
  ),
  allowed_songs AS MATERIALIZED (
    SELECT st.sid
      FROM song_tags st
      JOIN allowed_tags t ON t.gids = st.gids
  ),
  chosen_genre AS (
    SELECT a.gid
      FROM alive a
      LEFT JOIN current_genres prev ON prev.gid = a.gid
     WHERE NOT (SELECT needed FROM balance_check)
        OR EXISTS (SELECT 1 FROM allowed_tags t WHERE a.gid = ANY (t.gids))
     ORDER BY -ln(1 - random()) * a.units * CASE WHEN prev.gid IS NULL THEN 1 ELSE 2 END
     LIMIT 1
  ),
  chosen_songs AS (
    SELECT e.sid, e.artist_keys
      FROM eligible e
      JOIN chosen_genre c ON c.gid = e.gid
  ),
  -- Every artist credited in this game: how many songs credited it and how
  -- many rounds ago it was last heard (1 = the song playing now).
  artist_history AS MATERIALIZED (
    SELECT k.akey, count(*) AS plays, min(lr.rn - p.rn + 1) AS ago
      FROM played p
      CROSS JOIN last_round lr
      JOIN songs s ON s.id = p.sid
      CROSS JOIN LATERAL unnest(s.artist_keys) AS k(akey)
     GROUP BY k.akey
  ),
  -- Compute artist supply and the pool size once for the chosen genre.
  genre_artists_left AS MATERIALIZED (
    SELECT k.akey, count(*) AS n
      FROM chosen_songs e
      CROSS JOIN LATERAL unnest(e.artist_keys) AS k(akey)
     GROUP BY k.akey
  ),
  genre_left AS MATERIALIZED (
    SELECT count(*) AS n
      FROM chosen_songs e
  ),
  -- One set-based pass over the chosen genre's songs (no per-song subquery).
  scored AS (
    SELECT e.sid,
           -- 9 = none of its artists heard in the last 8 rounds,
           -- otherwise rounds since the most recent of them was heard.
           least(coalesce(min(h.ago), 9), 9) AS spacing,
           -- Songs already credited to its most-played artist, and
           -- the most songs any of its artists still has in this genre.
           coalesce(max(h.plays), 0) AS plays,
           coalesce(max(gal.n), 0) AS artist_left
      FROM chosen_songs e
      LEFT JOIN LATERAL unnest(e.artist_keys) AS k(akey) ON true
      LEFT JOIN artist_history h ON h.akey = k.akey
      LEFT JOIN genre_artists_left gal ON gal.akey = k.akey
     WHERE NOT (SELECT needed FROM balance_check)
        OR e.sid IN (SELECT allowed.sid FROM allowed_songs allowed)
     GROUP BY e.sid
  ),
  ranked AS (
    SELECT s.sid,
           -- An artist holding half or more of what the genre has left is not
           -- held back: deferring it would only bunch its songs at the end.
           CASE WHEN s.artist_left * 2 >= gl.n THEN 0 ELSE s.plays END AS plays,
           rank() OVER (ORDER BY s.spacing DESC) AS rk
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

-- Only the authenticated manager RPCs use this helper from the browser.
REVOKE EXECUTE ON FUNCTION pick_next_song(text, uuid[], integer[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pick_next_song(text, uuid[], integer[])
  TO service_role;
