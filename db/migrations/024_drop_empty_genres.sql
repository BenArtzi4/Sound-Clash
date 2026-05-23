-- 024_drop_empty_genres.sql
-- Drop five genres that have zero songs attached and aren't planned to
-- receive any: Classical, Country, Jazz, Metal, R&B. They've been in the
-- seed since migration 008 but the catalog's actual music is Israeli /
-- mainstream-pop / rock / hip-hop / soundtrack / electronic, so these
-- five just clutter the manager's genre picker.
--
-- Safe because the audit on 2026-05-23 confirmed all five had zero
-- song_genres rows. If a future operator decides to reintroduce one,
-- amend the seed (migrations 008/013) and let ON CONFLICT (slug) DO
-- NOTHING reinsert it.
--
-- Idempotent: DELETE WHERE slug IN (...) is a no-op once the rows are
-- gone. ON DELETE CASCADE on song_genres would clean up any stragglers
-- if a row had been linked after the audit (none expected, but defensive).

DELETE FROM genres
WHERE slug IN ('classical', 'country', 'jazz', 'metal', 'rnb');
