# End-to-End tests

Playwright multi-browser, multi-context tests. Run against the `Sound-Clash-Preview` Supabase project (or local dev stack).

**Phase 6 deliverable.** Phase 1 contains only the config skeleton.

## Planned specs

See [`docs/testing-strategy.md`](../../docs/testing-strategy.md) §4.4 for the full list:

- `buzzer_race.spec.ts` — 4 contexts; both teams click within 5ms; deterministic winner; all contexts agree.
- `full_game.spec.ts` — 3-round happy path.
- `reconnection.spec.ts` — team disconnect mid-game; reload; state restored.
- `expiration.spec.ts` — game with past `expires_at`; cron runs; all clients redirect.
- `admin_login.spec.ts` — wrong password rejected; correct admits.
- `admin_songs_crud.spec.ts` — song CRUD via UI.
- `kick_team.spec.ts` — team kicked; their tab redirects.
- `mobile_team.spec.ts` — iPhone SE viewport; buzzer reachable.

## Browser matrix

Every spec must pass in:
- **chromium** (Desktop Chrome)
- **firefox** (Desktop Firefox)
- **webkit** (Desktop Safari)
- **mobile** (iPhone SE)

## Running

```bash
cd tests/e2e
npm install
npx playwright install --with-deps  # one-time
npx playwright test                 # all browsers, all specs
npx playwright test --ui            # interactive
npx playwright test buzzer_race     # one spec
npx playwright test --project=mobile  # one browser
```

## Required env vars

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_PASSWORD=...
BASE_URL=http://localhost:5173    # or preview URL
```

## Important rules

- **Never run against the prod Supabase project.** Use preview only.
- **Never embed secrets** in test code; always env vars.
- **Single retry max** in CI (`retries: 1`) — flake should fail fast.
