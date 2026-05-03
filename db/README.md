# Database

Postgres-as-code. Schema, RPC functions, RLS policies, and the pg_cron job all live here as ordered SQL migrations.

**Phase 3 deliverable.** Empty in Phase 1.

## Layout

```
db/
├── README.md         (this file)
├── migrate.sh        (applies migrations in order; used locally and in CI)
├── migrations/       (numbered SQL files)
│   ├── 001_extensions.sql
│   ├── 002_durable_tables.sql
│   ├── 003_ephemeral_tables.sql
│   ├── 004_indexes.sql
│   ├── 005_rpc_functions.sql
│   ├── 006_rls_policies.sql
│   ├── 007_cron_jobs.sql
│   └── 008_seed_genres.sql
└── seed/
    └── (one-time seed data not tied to migrations)
```

## Authority

Each migration is spec'd in the docs:

| Migration | Spec |
|---|---|
| 002, 003, 004 | [`docs/data-model.md`](../docs/data-model.md) |
| 005 | [`docs/rpc-functions.md`](../docs/rpc-functions.md) |
| 006 | [`docs/security-rls.md`](../docs/security-rls.md) |

If you change a migration, update the corresponding doc in the same PR.

## Idempotency

All migrations must be **idempotent** — running them twice on the same DB must be a no-op. Use `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS … ; CREATE POLICY …`. CI verifies this by running migrations twice.

## Running

```bash
# Local
./db/migrate.sh "postgres://postgres:postgres@localhost:54322/postgres"

# Preview / prod (via GitHub Actions)
# Use the `db-migrate.yml` workflow with manual dispatch + confirmation.
```

See [`docs/runbook.md`](../docs/runbook.md) §1.3 for the deploy-with-migration playbook.
