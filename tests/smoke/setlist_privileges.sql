-- tests/smoke/setlist_privileges.sql
-- Custom setlists, phase 1: the production privilege check for the four new
-- tables (game_setlists, game_song_pool from migration 060; artist_aliases,
-- song_demand from migration 061).
--
-- Why it exists: the DB test suite runs on a bare Postgres that never
-- auto-grants, so its anon "permission denied" tests cannot prove that the
-- migrations' REVOKEs beat hosted Supabase's auto-grant of base privileges on
-- every new public table. This query asks production itself.
--
-- What it lists: one row per (table, role) for the roles anon and
-- authenticated, with has_table_privilege for SELECT, INSERT, UPDATE and
-- DELETE, and a verdict:
--   PASS             the table exists and all four are false
--   FAIL             the table exists and at least one is true
--   not applied yet  the table does not exist (to_regclass is NULL), so it can
--                    run after 060 alone: the 061 rows say this until 061 is
--                    applied
--
-- How to run (production, from a tree that is linked to the project), after
-- 060 is applied and again after 061 is applied:
--   supabase db query --linked --output-format json -f "C:/abs/path/tests/smoke/setlist_privileges.sql" 2>&1 | grep -v -E 'Initialising|new version|recommend updating'
-- PASS after 060: the game_setlists and game_song_pool rows say PASS.
-- PASS after 061: all eight rows say PASS.
--
-- One SELECT, read-only: no lock beyond AccessShare on the catalogs. Safe to
-- run while games are live, and it leaves nothing behind.

WITH t (ord, table_name) AS (
  VALUES (1, 'game_setlists'),
         (2, 'game_song_pool'),
         (3, 'artist_aliases'),
         (4, 'song_demand')
),
r (ord, role_name) AS (
  VALUES (1, 'anon'),
         (2, 'authenticated')
),
p AS (
  SELECT t.ord AS t_ord,
         r.ord AS r_ord,
         t.table_name,
         r.role_name,
         to_regclass('public.' || t.table_name)::oid AS rel
    FROM t
   CROSS JOIN r
),
privs AS (
  SELECT p.*,
         has_table_privilege(p.role_name::name, p.rel, 'SELECT') AS can_select,
         has_table_privilege(p.role_name::name, p.rel, 'INSERT') AS can_insert,
         has_table_privilege(p.role_name::name, p.rel, 'UPDATE') AS can_update,
         has_table_privilege(p.role_name::name, p.rel, 'DELETE') AS can_delete
    FROM p
)
SELECT privs.table_name,
       privs.role_name,
       privs.can_select,
       privs.can_insert,
       privs.can_update,
       privs.can_delete,
       CASE
         WHEN privs.rel IS NULL THEN 'not applied yet'
         WHEN privs.can_select OR privs.can_insert
              OR privs.can_update OR privs.can_delete THEN 'FAIL'
         ELSE 'PASS'
       END AS verdict
  FROM privs
 ORDER BY privs.t_ord, privs.r_ord;
