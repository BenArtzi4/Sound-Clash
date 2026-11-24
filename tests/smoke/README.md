# Smoke tests

Run **after each production deploy** to verify the live system works end-to-end.

These are lightweight, take well under 2 minutes, and hit the real prod URL with synthetic traffic.

## Scripts

- `post_deploy.sh` (here): bash + curl + jq. Exercises `/health`, open game creation, two team joins, and the manager-token-gated `select-song` / `end-round` / `end` chain. Cleans up the game it created. No secrets needed (game hosting is open).
- `ui_prod_pass.mjs` (here): Node + Playwright's chromium (borrowed from `tests/e2e/node_modules`). The scripted post-merge pass for the UI redesign — `docs/planning/ui-redesign/06-validation-plan.md` §2.4 (deployed chunk hashes, CSS token markers, font caching) and §8 (a throwaway 4-team game with a Hebrew round, screenshots of all seven routes at 1280×800 and 1920×1080, console/CSP/font/animation probes, Display fit at 1920×1080, manager-console fit at 390×844, reduced-motion emulation, a route-transition click-through). Prints PASS/FAIL per hard gate plus the soft findings that stay non-zero until Tasks 2/4/9 land (emoji sweep, zero-length page fade-ins, missing `dir` on the reveal row). Creates and ends its own game; no secrets needed. Output (screenshots, `game.json`, `report.json`) goes to the git-ignored `tests/smoke/.prod-pass/`.
- `tests/e2e/smoke/prod_realtime.spec.ts`: Playwright. One buzzer race round end-to-end via the deployed UI. Proves the architectural keystone (browser → Supabase RPC → Realtime fan-out) survived the deploy. Lives under `tests/e2e/smoke/` rather than here because `@playwright/test` is only installed in `tests/e2e/node_modules`.
- `tests/e2e/smoke/playwright.smoke.config.ts`: Playwright config used by the spec above. Differs from `tests/e2e/playwright.config.ts` by omitting the `webServer` block, since smoke targets a live deployment. The regular e2e config excludes `smoke/**` so this spec doesn't run on the normal e2e CI job.

## Running

Bash smoke (after backend is reachable):

```bash
./tests/smoke/post_deploy.sh                          # defaults to https://api.soundclash.org
./tests/smoke/post_deploy.sh https://api.example.com  # any backend URL
```

UI redesign post-merge pass (from the repo root; needs `cd tests/e2e && npm install && npx playwright install chromium` once, and the Claude Code Bash sandbox disabled since it is all prod egress):

```bash
node tests/smoke/ui_prod_pass.mjs all          # deploy check → throwaway game → §8 pass → end game
node tests/smoke/ui_prod_pass.mjs deploy       # only the §2.4 chunk-hash / CSS-marker / font-cache check
node tests/smoke/ui_prod_pass.mjs setup        # keep a game around to eyeball in Chrome, then `run` / `end`
```

The headless browser is deliberate: Chrome cannot emulate 390 px or `prefers-reduced-motion`, and the manager console autoplays YouTube audio, so the user's browser is only used for eyeballing the screenshots it writes.

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

After every backend or frontend deploy that touches user-visible behaviour, and after applying any prod migration (see `docs/runbook.md`). For pre-event validation, see `docs/pre-event-checklist.md`.

## Custom setlist no-regression checks (SQL, production)

Two SQL files prove that migrations 060 and 061 (custom setlists, phase 1) change nothing a normal game runs on and make no genre round slower (spec §10 of `docs/planning/2026-11-24-custom-setlist-design.md`). Each file's header has the full instructions.

- `setlist_fingerprint.sql`: one read-only SELECT that lists `(kind, name, fingerprint)` rows: the md5 of the definitions of `buzz_in`, `award_attempt`, `release_buzz_lock`, `start_round`, `end_round`, `pick_next_song`, the 3-argument `select_next_song` wrapper and every function behind a non-internal trigger on `active_games` (with their owners and grants), plus `active_games`' columns, constraints, indexes, non-internal triggers, owner, grants, RLS flags, policies, replica identity and `supabase_realtime` publication rows. Run it on production right before 060 is applied (with every earlier migration already there), again after 060 and before 061, and again after 061; `diff` each later output against the first. **Pass: both diffs are empty**, and the after-060 diff must be empty before 061 is applied. Safe while games are live.
- `setlist_timing_selfcheck.sql`: one DO block that rolls itself back by raising `TIMING_ROLLBACK ...`. It times 200 `peek_next_song` and 200 guarded `select_next_song` calls on synthetic 8-genre games with today's bodies, then with migration 060's bodies (installed with `EXECUTE`, and its two tables without foreign keys so no lock lands on `active_games`), then 200 `pick_next_pool_song` calls on a 300-song pool. Run it on production **before** 060, only after `SELECT count(*) FROM active_games WHERE ended_at IS NULL AND expires_at > now()`. **Pass: the error message starts with `TIMING_ROLLBACK `** (any other error is a failed run), `new_peek <= old_peek + 1`, `new_select <= old_select + 1` and `pool_pick < 10` (ms averages; `verdict=` applies them). Then run the leftover check from the header (synthetic games `ZT0%` = 0, the pool tables absent). It takes about 13 s on a 1,700-song local catalog.
- `gen_setlist_timing.py`: writes `setlist_timing_selfcheck.sql`, cutting the three function bodies out of `db/migrations/060_game_song_pool.sql` byte for byte. Never edit the `.sql` by hand: after a change to those bodies in 060, run `python tests/smoke/gen_setlist_timing.py` (`--check` exits 1 when the file is stale).

```bash
supabase db query --linked -f "C:/abs/path/tests/smoke/setlist_fingerprint.sql" > fingerprint-before.txt
supabase db query --linked -f "C:/abs/path/tests/smoke/setlist_timing_selfcheck.sql"
# apply 060, then:
supabase db query --linked -f "C:/abs/path/tests/smoke/setlist_fingerprint.sql" > fingerprint-after-060.txt
diff fingerprint-before.txt fingerprint-after-060.txt   # must be empty before 061
# apply 061, then:
supabase db query --linked -f "C:/abs/path/tests/smoke/setlist_fingerprint.sql" > fingerprint-after-061.txt
diff fingerprint-before.txt fingerprint-after-061.txt   # must be empty
```
