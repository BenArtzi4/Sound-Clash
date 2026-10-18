-- Zero-persistence check: a throwaway all-genres game draws through the real
-- picker until it runs out. Always ends in RAISE EXCEPTION, so every row rolls back.
-- Pass = not_served=0: every playable song (has a genre, not flagged unavailable)
-- can come up in a game. ~16 s for 1,500 songs; `supabase db query --linked` is
-- cut at 100 s by Cloudflare whatever the timeout says, so keep the run short.
SET statement_timeout = '90s';
DO $x$
DECLARE
  v_code   text := 'ZZAUD1';
  v_token  uuid;
  v_genres uuid[];
  v_sid    uuid;
  n        int := 0;
  v_total  int;
  v_served int;
  v_missing int;
  v_bad    int;
BEGIN
  SELECT array_agg(id) INTO v_genres FROM genres;
  INSERT INTO active_games (game_code, status, selected_genres) VALUES (v_code, 'waiting', v_genres);
  SELECT manager_token INTO v_token FROM game_secrets WHERE game_code = v_code;
  CREATE TEMP TABLE _served (song_id uuid) ON COMMIT DROP;
  LOOP
    v_sid := pick_next_song(v_code, v_genres, '{}');
    EXIT WHEN v_sid IS NULL OR n > 20000;
    PERFORM select_next_song(v_code, v_token, NULL);
    n := n + 1;
  END LOOP;
  INSERT INTO _served SELECT song_id FROM game_rounds WHERE game_code = v_code;
  SELECT count(*) INTO v_total FROM songs s WHERE s.unavailable_at IS NULL
     AND EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id);
  SELECT count(DISTINCT song_id) INTO v_served FROM _served;
  SELECT count(*) INTO v_missing FROM songs s WHERE s.unavailable_at IS NULL
     AND EXISTS (SELECT 1 FROM song_genres sg WHERE sg.song_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM _served x WHERE x.song_id = s.id);
  SELECT count(*) INTO v_bad FROM _served x WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.id = x.song_id);
  RAISE EXCEPTION 'SELFCHECK_DONE_ROLLBACK rounds=% served_distinct=% playable_catalog=% not_served=% served_but_not_in_catalog=%',
    n, v_served, v_total, v_missing, v_bad;
END
$x$;
