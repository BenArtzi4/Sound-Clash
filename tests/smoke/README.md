# Smoke tests

Run **after each production deploy** to verify the live system works end-to-end.

These are lightweight, take well under 2 minutes, and hit the real prod URL with synthetic traffic.

## Scripts

- `post_deploy.sh` (here): bash + curl + jq. Exercises `/health`, open game creation, two team joins, and the manager-token-gated `select-song` / `end-round` / `end` chain. Cleans up the game it created. No secrets needed (game hosting is open).
- `tests/e2e/smoke/prod_realtime.spec.ts`: Playwright. One buzzer race round end-to-end via the deployed UI. Proves the architectural keystone (browser → Supabase RPC → Realtime fan-out) survived the deploy. Lives under `tests/e2e/smoke/` rather than here because `@playwright/test` is only installed in `tests/e2e/node_modules`.
- `tests/e2e/smoke/playwright.smoke.config.ts`: Playwright config used by the spec above. Differs from `tests/e2e/playwright.config.ts` by omitting the `webServer` block, since smoke targets a live deployment. The regular e2e config excludes `smoke/**` so this spec doesn't run on the normal e2e CI job.

## Running

Bash smoke (after backend is reachable):

```bash
./tests/smoke/post_deploy.sh                          # defaults to https://api.soundclash.org
./tests/smoke/post_deploy.sh https://api.example.com  # any backend URL
```

Playwright smoke (run from `tests/e2e/`):

```bash
cd tests/e2e
BASE_URL=https://soundclash.org npx playwright test --config smoke/playwright.smoke.config.ts
# Or against a preview/staging environment:
BASE_URL=https://preview.soundclash.org API_URL=https://api-preview.soundclash.org \
  npx playwright test --config smoke/playwright.smoke.config.ts
```

The Playwright spec derives `API_URL` from `BASE_URL` if not set (`https://soundclash.org` → `https://api.soundclash.org`; `http://localhost:5173` → `http://localhost:8000`).

## When to run

See `docs/phase7-cutover-checklist.md` steps 6 (preview) and 8 (post-DNS-cutover). After Phase 7 ships, run both scripts after every backend or frontend deploy that touches user-visible behaviour.
