-- tests/smoke/setlist_fingerprint.sql
-- Custom setlists, phase 1, no-regression proof 1 of 2 (spec §10 of
-- docs/planning/2026-11-24-custom-setlist-design.md): migrations 060 and 061
-- must not change anything a normal game runs on.
--
-- What it lists, as (kind, name, fingerprint) rows sorted by kind and name:
--   function      md5(pg_get_functiondef) of every overload of buzz_in,
--                 award_attempt, release_buzz_lock, start_round, end_round and
--                 pick_next_song, of the 3-argument select_next_song wrapper
--                 (mig 057; 060 replaces only the 4-argument overload, so that
--                 one is NOT listed), and of every function behind a
--                 non-internal trigger on active_games (create_game_secret,
--                 mig 034, and broadcast_buzz_lock, mig 058, which sends the
--                 buzzer locks).
--   function_acl  the owner and EXECUTE grants of the same functions.
--   columns       one md5 of every active_games column in attnum order (name,
--                 type, NOT NULL, default, column grants), and one `column`
--                 row per column in readable text.
--   constraint, index   active_games' own constraints and indexes.
--   trigger       active_games' NON-internal triggers (enabled flag, tgtype,
--                 function, CREATE TRIGGER text). Internal triggers are left
--                 out on purpose: 060's foreign key game_setlists.game_code ->
--                 active_games adds RI_ConstraintTrigger_* triggers to
--                 active_games, by design, exactly as game_secrets' foreign key
--                 already does. They check the referencing tables and change
--                 nothing a normal game runs.
--   table         active_games' owner, grants (relacl), RLS flags
--                 (relrowsecurity, relforcerowsecurity) and replica identity.
--   policy        every RLS policy on active_games (command, permissive,
--                 roles, USING, WITH CHECK).
--   publication   the supabase_realtime publication's flags, active_games'
--                 membership (with the published column list and row filter
--                 where the server has them), and the full list of published
--                 tables (so 060/061 cannot publish the pool tables by
--                 accident). On a bare Postgres without the publication these
--                 rows say "absent" instead of failing.
--
-- How to run (production, from a tree that is linked to the project). Spec
-- §10 compares before and after EACH migration, so there are three runs and
-- two diffs:
--   1. BEFORE migration 060, right before it is applied, with every earlier
--      migration already on production (otherwise an unrelated earlier
--      migration would show in the diff):
--        supabase db query --linked --output-format json -f "C:/abs/path/tests/smoke/setlist_fingerprint.sql" 2>&1 | grep -v -E 'Initialising|new version|recommend updating' > fingerprint-before.txt
--   2. Apply 060 (named by the maintainer). Then, after 060 and before 061:
--        supabase db query --linked --output-format json -f "C:/abs/path/tests/smoke/setlist_fingerprint.sql" 2>&1 | grep -v -E 'Initialising|new version|recommend updating' > fingerprint-after-060.txt
--        diff fingerprint-before.txt fingerprint-after-060.txt
--      It must be empty before 061 is applied.
--   3. Apply 061 (named by the maintainer). Then:
--        supabase db query --linked --output-format json -f "C:/abs/path/tests/smoke/setlist_fingerprint.sql" 2>&1 | grep -v -E 'Initialising|new version|recommend updating' > fingerprint-after-061.txt
--        diff fingerprint-before.txt fingerprint-after-061.txt
--      It must be empty.
--   Why this exact command: JSON output does not truncate wide cells (the
--   table output can cut a long fingerprint, so a real change could hide in
--   the cut), and the grep drops the CLI's own chatter lines, which would
--   otherwise make a diff non-empty for no reason (2>&1 puts stderr through
--   the same filter, so the chatter is dropped from either stream and a real
--   error still lands in the file, where the diff shows it).
--   Use the same tool and the same login every time: the text of
--   pg_get_functiondef and of regprocedure names can depend on search_path.
--
-- PASS: both diffs are empty. Any changed, added or missing row is a FAIL;
-- the row's kind and name say what changed, and the diff it first appears in
-- says which migration changed it.
--
-- One SELECT, read-only: no temp table, no DO block, no lock beyond
-- AccessShare on the catalogs. Safe to run while games are live, and it
-- leaves nothing behind (no leftover check needed).

WITH fn AS (
  SELECT p.oid
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind = 'f'
     AND p.proname IN ('buzz_in', 'award_attempt', 'release_buzz_lock',
                       'start_round', 'end_round', 'pick_next_song')
  UNION
  SELECT p.oid
    FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.select_next_song(text, uuid, uuid)')
  UNION
  SELECT t.tgfoid
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.active_games'::regclass
     AND NOT t.tgisinternal
),
fn_named AS (
  SELECT p.oid,
         p.proowner,
         p.proacl,
         n.nspname || '.' || p.proname
           || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name
    FROM fn
    JOIN pg_proc p ON p.oid = fn.oid
    JOIN pg_namespace n ON n.oid = p.pronamespace
),
ag AS (
  SELECT c.oid, c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity,
         c.relreplident
    FROM pg_class c
   WHERE c.oid = 'public.active_games'::regclass
),
cols AS (
  SELECT a.attnum,
         a.attname,
         a.attnum::text || ' ' || format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
           || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
           || coalesce(' GRANTS ' || a.attacl::text, '') AS def
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.active_games'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
),
pub AS (
  SELECT p.*
    FROM pg_publication p
   WHERE p.pubname = 'supabase_realtime'
),
fp (kind, name, fingerprint) AS (
  SELECT 'function', f.name, md5(pg_get_functiondef(f.oid))
    FROM fn_named f
  UNION ALL
  SELECT 'function_acl', f.name,
         'owner=' || pg_get_userbyid(f.proowner)
           || ' grants=' || coalesce(f.proacl::text, 'default')
    FROM fn_named f
  UNION ALL
  SELECT 'columns', 'active_games',
         md5(string_agg(c.attname || ' ' || c.def, '; ' ORDER BY c.attnum))
    FROM cols c
  UNION ALL
  SELECT 'column', 'active_games.' || c.attname, c.def
    FROM cols c
  UNION ALL
  SELECT 'constraint', 'active_games.' || con.conname,
         con.contype::text || ' ' || pg_get_constraintdef(con.oid)
    FROM pg_constraint con
   WHERE con.conrelid = 'public.active_games'::regclass
  UNION ALL
  SELECT 'index', 'active_games.' || i.relname, pg_get_indexdef(x.indexrelid)
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
   WHERE x.indrelid = 'public.active_games'::regclass
  UNION ALL
  SELECT 'trigger', 'active_games.' || t.tgname,
         format('enabled=%s tgtype=%s function=%s | %s',
                t.tgenabled, t.tgtype, t.tgfoid::regprocedure,
                pg_get_triggerdef(t.oid))
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.active_games'::regclass
     AND NOT t.tgisinternal
  UNION ALL
  SELECT 'table', 'active_games.owner', pg_get_userbyid(ag.relowner)
    FROM ag
  UNION ALL
  SELECT 'table', 'active_games.grants', coalesce(ag.relacl::text, 'default')
    FROM ag
  UNION ALL
  SELECT 'table', 'active_games.rls',
         format('relrowsecurity=%s relforcerowsecurity=%s',
                ag.relrowsecurity, ag.relforcerowsecurity)
    FROM ag
  UNION ALL
  SELECT 'table', 'active_games.replica_identity', ag.relreplident::text
    FROM ag
  UNION ALL
  SELECT 'policy', 'active_games.' || pol.polname,
         format('cmd=%s permissive=%s roles=%s using=%s with_check=%s',
                pol.polcmd,
                pol.polpermissive,
                (SELECT string_agg(rn.role_name, ',' ORDER BY rn.role_name)
                   FROM (SELECT CASE WHEN r.role_oid = 0 THEN 'public'
                                     ELSE pg_get_userbyid(r.role_oid) END AS role_name
                           FROM unnest(pol.polroles) AS r(role_oid)) rn),
                coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
                coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'))
    FROM pg_policy pol
   WHERE pol.polrelid = 'public.active_games'::regclass
  UNION ALL
  SELECT 'publication', 'supabase_realtime',
         coalesce((SELECT (to_jsonb(pub) - 'oid')::text FROM pub), 'absent')
  UNION ALL
  SELECT 'publication', 'supabase_realtime.active_games',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM pub)
             THEN 'absent (no supabase_realtime publication)'
           ELSE coalesce(
             (SELECT (to_jsonb(pt) - 'pubname' - 'schemaname' - 'tablename')::text
                FROM pg_publication_tables pt
               WHERE pt.pubname = 'supabase_realtime'
                 AND pt.schemaname = 'public'
                 AND pt.tablename = 'active_games'),
             'not a member')
         END
  UNION ALL
  SELECT 'publication', 'supabase_realtime.tables',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM pub)
             THEN 'absent (no supabase_realtime publication)'
           ELSE coalesce(
             (SELECT string_agg(pt.schemaname || '.' || pt.tablename, ','
                                ORDER BY pt.schemaname, pt.tablename)
                FROM pg_publication_tables pt
               WHERE pt.pubname = 'supabase_realtime'),
             'none')
         END
)
SELECT fp.kind, fp.name, fp.fingerprint
  FROM fp
 ORDER BY fp.kind COLLATE "C", fp.name COLLATE "C";
