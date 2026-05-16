-- 023_drop_legacy_overloads.sql
-- Drop the un-tokenised legacy overloads of award_attempt and release_buzz_lock.
--
-- Background: migration 021 added new 6-arg and 2-arg tokenised overloads
-- next to the original 5-arg award_attempt and 1-arg release_buzz_lock so
-- the still-deployed FastAPI (which called the old signatures via the
-- service-role key) kept working during the cutover. Migration 020 locked
-- the legacy overloads down to service_role only, so they posed no anon-
-- callable risk -- they were just orphan plumbing.
--
-- The new frontend (PR #87) has been live and stable on prod; the FastAPI
-- endpoints that used to call these overloads were removed in the same PR.
-- Nothing in the running stack now references either legacy overload.
-- This migration retires them.
--
-- Idempotent via DROP FUNCTION IF EXISTS. Safe to re-apply.
--
-- Caveat: this migration MUST be applied AFTER the new frontend (PR #87)
-- has rolled out -- which it has been since 2026-05-16. Applying it now,
-- with no caller present, is a clean no-op for the running system. If a
-- future operator rolls back to a pre-PR-87 FastAPI image without first
-- restoring this function, the host's "Correct Song" click will 500 with
-- "function award_attempt(...) does not exist" until either the rollback
-- is unwound or the migration is reverted. Recovery is just re-running
-- migration 016 (which recreates the legacy signature).

DROP FUNCTION IF EXISTS award_attempt(text, uuid, integer, integer, integer);
DROP FUNCTION IF EXISTS release_buzz_lock(text);
