# End-to-End tests

Playwright multi-context tests. Run against the `Sound-Clash-Preview` Supabase project (a separate Supabase free-tier project from prod).

**Status:** all seven specs from [`docs/testing-strategy.md`](../../docs/testing-strategy.md) §4.4 are landed: `buzzer_race`, `full_game`, `reconnection`, `expiration`, `admin_songs_crud` (API-driven; the `/admin/songs` UI is a deferred carve-out), `kick_team`, `mobile_team`. The legacy `admin_login` spec was removed when the manager password was retired in favour of per-game manager tokens (hosting is open). The multi-browser matrix (firefox / webkit / iPhone-SE project) is declared in `playwright.config.ts` but the CI job runs `--project=chromium` only.

## One-time preview project setup

```bash
# 1. Create Sound-Clash-Preview project at supabase.com (free tier).
# 2. Apply migrations.
./db/migrate.sh local --db-url "$PREVIEW_DATABASE_URL"
# 3. Seed songs (idempotent, run again any time the seed file changes).
psql "$PREVIEW_DATABASE_URL" -f db/seed/songs.sql
```

Then set GitHub repo secrets so the `E2E` workflow can run on PRs labeled `run-e2e`:

| Secret | Source |
|---|---|
| `SUPABASE_PREVIEW_URL` | preview project settings → API → URL |
| `SUPABASE_PREVIEW_ANON_KEY` | preview project settings → API → anon/public key |
| `SUPABASE_PREVIEW_SERVICE_ROLE_KEY` | preview project settings → API → service_role key |
| `PREVIEW_ADMIN_PASSWORD` | choose any string; backend reads `ADMIN_PASSWORD`. Gates `/admin/songs` only; game hosting is open. |

## Running locally

```bash
cd tests/e2e
npm install
npx playwright install --with-deps chromium    # one-time
npx playwright test --project=chromium         # both specs
npx playwright test --ui                       # interactive runner
npx playwright test buzzer_race                # one spec
```

The Playwright config auto-starts a local backend (`uvicorn` on port 8000) and the Vite dev server (port 5173). It does **not** spin up Supabase; you must point the backend at a real Supabase project (preview or local Docker).

### Required env vars

Create `tests/e2e/.env` (gitignored) or export in your shell:

```
# Backend reads these
SUPABASE_URL=https://<preview-id>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_PASSWORD=...

# Frontend reads these (Vite picks them up via process.env)
VITE_SUPABASE_URL=https://<preview-id>.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_API_URL=http://localhost:8000

# E2E spec helpers
API_URL=http://localhost:8000
# ADMIN_PASSWORD reused from above
```

## Browser matrix

`playwright.config.ts` declares chromium / firefox / webkit / mobile. Phase 6 cores run only chromium in CI; the broader matrix is enabled in a follow-up PR.

## Important rules

- **Never run against the prod Supabase project.** Preview only.
- **Never embed secrets** in test code; always env vars.
- The buzzer race relies on Postgres deciding the winner; do not weaken `expect.poll` timeouts trying to make the race deterministic on the client.
