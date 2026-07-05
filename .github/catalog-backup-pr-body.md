## Summary

Automated weekly backup of the durable song catalog (`genres`, `songs`, `song_genres`), produced by `.github/workflows/catalog-backup.yml`. The committed CSVs under `db/backups/` drifted from production, so this PR refreshes them. Only data snapshots change here.

## Test plan

- Deterministic dump (`SELECT * ORDER BY <pk>`), so the diff is real catalog drift, not row reordering.
- Restore is idempotent: `psql "$SUPABASE_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/backups/restore.sql` (run from repo root). See `docs/runbook.md` §6.
- CI status checks do not run on this bot PR (GitHub does not trigger workflows from `GITHUB_TOKEN` pushes); it changes only `db/backups/*.csv`.
