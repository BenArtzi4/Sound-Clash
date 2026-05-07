# Database

Postgres-as-code. Schema, RPC functions, RLS policies, and the pg_cron job all live here as ordered SQL migrations.

## Layout

```
db/
├── README.md         (this file)
├── migrate.sh        (applies migrations in order; used locally and in CI)
├── migrations/       (numbered SQL files; see the directory for the canonical list)
└── seed/             (one-time seed data not tied to migrations)
```

Migrations are applied in numeric order. The initial set (`001`–`008`) ships the schema, indexes, the original five RPC functions, RLS policies, the cron job, and the genre seed. Later migrations layer fixes and feature work on top; Realtime publication wiring (`009`), `char(n)` → `text` for game codes (`010`), buzz/round mirroring (`011`), the per-game manager token (`012`), and the scoring revamp + `award_bonus` (`014`). New migrations get the next free numeric prefix.

## Authority

Each migration is spec'd in the docs:

| Migration | Spec |
|---|---|
| 002, 003, 004 | [`docs/data-model.md`](../docs/data-model.md) |
| 005 | [`docs/rpc-functions.md`](../docs/rpc-functions.md) |
| 006 | [`docs/security-rls.md`](../docs/security-rls.md) |

If you change a migration, update the corresponding doc in the same PR.

## Idempotency

All migrations must be **idempotent**: running them twice on the same DB must be a no-op. Use `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS … ; CREATE POLICY …`. CI verifies this by running migrations twice.

## Running

```bash
# Local
./db/migrate.sh "postgres://postgres:postgres@localhost:54322/postgres"

# Preview / prod (via GitHub Actions)
# Use the `db-migrate.yml` workflow with manual dispatch + confirmation.
```

**Pooler vs direct connection**: when setting `SUPABASE_DATABASE_URL` for CI / GitHub Actions, use Supabase's **Session pooler** URL (Project Settings → Database → Connection string → Session pooler). The default "Direct connection" URL is IPv6-only on the free tier and GitHub Actions runners can't reach it. Pooler URL pattern: `postgresql://postgres.<ref>:[password]@aws-0-<region>.pooler.supabase.com:5432/postgres`.

See [`docs/runbook.md`](../docs/runbook.md) §1.3 for the deploy-with-migration playbook.
