-- 030_grant_service_role_tables.sql
-- Grant the backend's service_role the base-table privileges it needs.
--
-- Background: the FastAPI backend connects to PostgREST as `service_role`
-- (the Supabase service-role key) and is the trusted server-side principal. It
-- is created BYPASSRLS in migration 006 and does all server-side reads/writes:
-- GET /genres, POST /games (active_games + game_teams), the admin song catalog
-- (songs + song_genres), kick (game_teams DELETE), etc.
--
-- The bug this fixes: bypassing RLS is NOT the same as holding a base-table
-- privilege -- PostgreSQL checks table GRANTs *before* RLS. Migration 006
-- granted SELECT on the six public tables to `anon` only, never to
-- `service_role`. In hosted Supabase that gap is invisible because the project
-- bootstrap auto-grants privileges on every `public` table to
-- anon/authenticated/service_role. But a stack that only applies
-- db/migrations/ -- the CI e2e `supabase start` stack -- gets no such
-- auto-grant, so every service_role table access fails with
-- `42501 permission denied for table ...`, starting with `GET /genres`, which
-- 500s and leaves the manager create-game page with no genres to pick (every
-- game-creating e2e spec then fails at setup).
--
-- Fix: grant service_role the privileges explicitly, mirroring the hosted
-- bootstrap. This is the same "don't rely on hosted-Supabase's auto-grant"
-- philosophy as migration 020 (which re-asserts function EXECUTE grants). It is
-- a no-op in production, where service_role already holds these grants.
--
-- Spec: docs/security-rls.md §2.
--
-- Idempotent: GRANT is naturally idempotent; the defensive role create mirrors
-- migration 006 and is a no-op on Supabase where the role exists natively.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON songs, genres, song_genres, active_games, game_teams, game_rounds
  TO service_role;
