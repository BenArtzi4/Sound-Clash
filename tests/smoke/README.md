# Smoke tests

Run **after each production deploy** to verify the live system works end-to-end.

These are lightweight, take <2 minutes, and hit the real prod URL with synthetic traffic.

**Phase 7 deliverable.** Empty in Phase 1.

## Planned scripts

- `post_deploy.sh` — curl `/health`; create a synthetic game; join 2 teams; start round; end game; clean up.
- `prod_realtime.spec.ts` — Playwright against prod URL; one buzzer race round end-to-end.

## Running (after Phase 7 ships)

```bash
ADMIN_PASSWORD=... ./tests/smoke/post_deploy.sh https://api.soundclash.org
npx playwright test tests/smoke/prod_realtime.spec.ts
```
