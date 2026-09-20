# UI redesign — final checks & full validation

_Created 2026-09-17. Companion to [06-validation-plan.md](06-validation-plan.md) (the per-PR gate ladder) and [07-implementation-plan.md](07-implementation-plan.md) (the build). This file is the **end-of-redesign run**: one fresh session proves **(1)** the game still works perfectly — many teams, every button, every combination, zero errors — and **(2)** the new design is on screen exactly as specified, and it lists what (if anything) still needs a fix. Run it after Task 11 merges and deploys. It can also run earlier in **partial mode** (§0.3) to catch drift once Tasks 0–8 are in._

## Starter prompt (paste into a fresh session)

> Run the Sound Clash final validation of the UI redesign. Read `docs/planning/ui-redesign/08-final-validation.md` in full and execute it top to bottom, in order: Part 0 (setup + which tasks are live), Part A (automated gates), Part B (local e2e, full suite, three browsers), Part C (prod API + RPC negative paths + the 30-team load check), Part D (real-browser games on prod with many teams and every button and combination), Part E (design conformance against `01-design-system.md`, `04-motion-and-transitions.md`, `05-page-by-page.md`), Part F (triage, fixes, report, verdict). Before Part E also read `docs/planning/ui-redesign/README.md`, `06-validation-plan.md` §3–§5 and `02-current-state-audit.md` §4; before any prod or local-stack command read `.claude/rules/lessons-learned.md`.
>
> Rules: work autonomously. Prod access needs `dangerouslyDisableSandbox: true` and the `https://www.soundclash.org` host. Every game you create on prod is ended before you finish (Part D.9). Never run the backend db pytest suite against the shared local stack (export `DATABASE_URL=""`). Never touch `tools/song-curation/*`; stage files by explicit path. Any subagent runs on Opus (`model: 'opus'`). Write the report to `docs/planning/ui-redesign/validation/<YYYY-MM-DD>-final-validation.md` as you go, using the Part F template; screenshots stay in your scratchpad and are described in the report, never committed. For every P0/P1 finding and every unambiguous spec deviation open a fix PR (`fix/ui-<slug>`, one concern per PR, local gate green, `run-e2e` label when the Team/Console/Display pages are touched, bot review threads resolved, `mergeStateStatus: CLEAN`). Never merge. Stop only for a question I must answer: a design judgement the spec leaves open, a new dependency, a `.github/workflows/` change, or the physical-device checks in Part E.7. Finish with the GO / NO-GO verdict, the findings table, the fix-PR links, and the device checklist I still owe.

Where things live: the local stack is `supabase start` (API `127.0.0.1:54321`, DB `127.0.0.1:54322`); prod is `https://www.soundclash.org` (frontend, Cloudflare Pages), `https://api.soundclash.org` (FastAPI, Render), Supabase project `jvfddxuaqcsrguibkymp` (Frankfurt; read-only queries via `supabase db query --linked "..."`). The public anon key and Supabase URL are in `frontend/.env.production` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) — not secrets, they ship in the bundle. Grafana is reachable through the read-only Grafana MCP (`grafanacloud-logs` for Loki, Tempo for traces). Sentry is the project behind `VITE_SENTRY_DSN` in the same env file.

---

## 0. Scope, verdicts, modes

### 0.1 The two goals and what PASS means

| Goal | PASS means | Evidence |
|---|---|---|
| **G1 — behaviour** | Every automated suite green; every button and combination in Part D behaves per `docs/game-rules.md`; scores agree across manager, teams, display and the DB at every step; a 30-team game and a 12-team real-browser game complete with exactly one buzz winner per race; zero app console errors on all three roles; buzz latency at baseline | Part A, B, C, D outputs pasted into the report |
| **G2 — design** | Every route in every state matches `01` (tokens, type, components, banned list), `04` (motion catalogue, hot-path guarantees), `05` (page specs, copy); the audit scripts in Part E return zero violations; the frozen contracts in `02` §4 are intact; fonts load under the prod CSP; fit constraints (#177, #179) hold | Part E outputs + screenshots described in the report |

The redesign is "done" only when both are PASS or every open finding is a P3 (below) that the maintainer has explicitly accepted.

### 0.2 Severity scale (used by every finding)

| Sev | Meaning | Action in this session |
|---|---|---|
| **P0** | Blocks play or corrupts results: a button does nothing, a race yields 0 or 2 winners, scores disagree, a role page crashes, a console error on the buzz path | Fix PR immediately; re-run the affected Part |
| **P1** | Wrong behaviour or a broken contract without corrupting play: a test id / attribute / copy contract from `02` §4 changed, a frozen label drifted, a fit constraint fails, an accessibility regression (missing label, unreachable focus), a CSP-blocked asset | Fix PR immediately |
| **P2** | Visible deviation from the design spec with an unambiguous spec answer: wrong token, gradient present, emoji present, wrong easing/duration, hover rule outside `(hover: hover)`, animated property outside the allowed list, wrong copy | Fix PR if the spec leaves no judgement; otherwise list with a recommendation |
| **P3** | Polish / taste / anything the spec does not decide | List with a recommendation; no PR unless asked |

### 0.3 Modes

Determine the mode in Part 0.2 and write it at the top of the report.

- **Full mode** (Tasks 0–11 merged and deployed): run every Part.
- **Partial mode** (some of Tasks 1–11 not yet merged): run Parts A–D in full (they test behaviour, which must hold at every step), and in Part E skip the checks marked with the task number that has not landed (each check is tagged `[T n]`). Record the skipped tags in the report so the next run knows what was not checked.

### 0.4 Out of scope

Anything the redesign does not touch: backend logic, migrations, RLS, the admin song catalog beyond inherited styling, the OG image / PWA icons (decision 9, follow-up PR), sound effects (X-SFX), a light theme (vetoed). Do not "improve" behaviour while validating: a behaviour finding is reported and fixed only when it contradicts `docs/game-rules.md` or `02` §4.

### 0.5 Known benign noise (do not report as findings)

- YouTube's third-party `compute-pressure` console warnings on the manager console.
- The e2e YouTube `data-ready` flake (#222): a failure whose only symptom is `youtube-player` never reaching `data-ready="true"` across unrelated specs — rerun up to 3× before treating it as real.
- `tests/db/test_rls_anon.py` failing only inside the full backend suite — rerun that file alone; green alone = not a regression (lessons-learned 2026-05-25).
- `curl -w "%{http_code}"` printing `000` on this machine — assert on response bodies with `jq`, never on `-w`.
- Cloudflare serving a stale `index.html` for a few minutes after a deploy — cache-bust with `?cb=<timestamp>`.

---

## Part 0 — Setup

- [ ] **0.1 Report file and branch.** From a clean `main`:

```bash
git checkout main && git pull
git checkout -b feature/ui-final-validation-report
mkdir -p docs/planning/ui-redesign/validation
```

Create `docs/planning/ui-redesign/validation/<YYYY-MM-DD>-final-validation.md` from the template in Part F.3 and fill it as each Part completes. Fix PRs go on their own `fix/ui-<slug>` branches from `main`; only the report lives on this branch. Never `git add .` — stage by path.

- [ ] **0.2 Which redesign tasks are live.** Each row is a file-level fingerprint of one task from `07`; run all twelve and record the table in the report.

```bash
cd frontend
echo "T0  fonts        $(ls public/fonts/*.woff2 2>/dev/null | wc -l) woff2 files (expect 4-5)"
echo "T1  tokens       $(grep -c -- '--accent: #FF7A00' src/styles.css) (expect 1)"
echo "T2  icons        $(test -f src/components/icons.tsx && echo present || echo MISSING)"
echo "T3  wordmark     $(grep -c 'EqualizerMark' src/components/Logo.tsx) (expect >=1)"
echo "T4  home copy    $(grep -c 'Name the song' src/pages/HomePage.tsx) (expect 1)"
echo "T5  code field   $(test -f src/components/GameCodeField.tsx && echo present || echo MISSING)"
echo "T6  create       $(grep -c 'scroll-snap' src/pages/ManagerCreateGamePage.module.css) (expect >=1)"
echo "T7  buzz screen  $(grep -c 'data-round-live' src/pages/TeamGameplayPage.tsx) (expect 1)"
echo "T8  console      $(grep -c -- '--accent' src/pages/ManagerConsolePage.module.css) (expect >=1)"
echo "T9  display      $(grep -c '@formkit/auto-animate' package.json) (expect 1)"
echo "T10 transitions  $(test -f src/hooks/useViewTransitionNavigate.ts && echo present || echo MISSING)"
echo "T11 cleanup      $(grep -c -- '--space-xs' src/styles.css) (expect 0)"
```

Also list the merged redesign PRs: `git log --oneline origin/main | grep -iE 'font|token|emoji|icon|wordmark|home|join|create|buzz screen|console|display|transition|cleanup' | head -20`. If any of T1–T11 is missing, run in **partial mode** (§0.3).

- [ ] **0.3 Prod serves the merged tree.** Content hashes are deterministic, so the deployed chunk names must equal a fresh local build's:

```bash
cd frontend && npm ci && npm run build && ls dist/assets | grep -E '^(index|vendor|DisplayPage|TeamGameplayPage|ManagerConsolePage)-.*\.(js|css)$' | sort > /tmp/local-assets.txt
curl -s "https://www.soundclash.org/?cb=$(date +%s)" | grep -oE '/assets/(index|vendor)-[A-Za-z0-9_-]+\.(js|css)' | sort -u
```

Every hash printed by the `curl` must appear in `/tmp/local-assets.txt`. If not, wait for the Cloudflare Pages deploy of `main` to finish (`gh run list --workflow=frontend.yml --branch main --limit 3`) and re-check; do not continue Parts C–E against a stale deploy. Also fetch the lazy chunk list from the deployed `index-*.js` (`curl -s https://www.soundclash.org/assets/index-<hash>.js | grep -oE '(DisplayPage|TeamGameplayPage|ManagerConsolePage)-[A-Za-z0-9_-]+\.js' | sort -u`) and confirm those hashes match too — Part E.5 greps them.

- [ ] **0.4 Local stack + e2e environment.**

```bash
docker ps >/dev/null || echo "start Docker Desktop first"
supabase start
./db/migrate.sh local
docker exec -i supabase_db_Sound-Clash psql -U postgres -d postgres < db/seed/songs.sql
supabase status -o env | grep -E 'API_URL|ANON_KEY|SERVICE_ROLE_KEY'
```

`tests/e2e/.env` must point at the local stack (`SUPABASE_URL=http://127.0.0.1:54321`, the anon + service-role keys from `supabase status`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL=http://localhost:8000`, `API_URL=http://localhost:8000`, `ADMIN_PASSWORD=<any string>`); the Playwright config starts uvicorn and Vite itself. `tests/e2e/node_modules` must exist (`cd tests/e2e && npm ci && npx playwright install chromium firefox webkit`). Sanity: `cd tests/e2e && npx playwright test buzzer_race.spec.ts --project=chromium --retries=0` → 1 passed.

- [ ] **0.5 Prod prerequisites.** All with the sandbox disabled.

```bash
curl -s https://api.soundclash.org/health | jq .            # {"status":"ok", "supabase":"ok"} — also wakes Render
grep -E 'VITE_SUPABASE_(URL|ANON_KEY)' frontend/.env.production
supabase db query --linked "select count(*) as live from active_games where status='playing' and expires_at > now()"
```

If `live > 0`, a real game is in progress: run Parts A–B now and Parts C–D later, or after asking the maintainer. Confirm the Grafana MCP answers (`list_datasources`) and note the UTC start time of the prod window for the Loki/Tempo queries in Part D.8.

---

## Part A — Automated gates (local + CI)

Stop at the first red, fix or triage it (Part F), then continue.

- [ ] **A.1 Frontend gate.**

```bash
cd frontend
npm run format:check
npm run lint
npm run typecheck
npm run test:run
npm run test:coverage
npm run build
```

Expected: every command exits 0; `test:run` reports **no fewer tests than the baseline** (521 as of 2026-09-17 — the redesign adds tests, never removes them; a lower count is a P1 finding until explained); coverage thresholds 85/80/85/85 met; `npm run build` ends with the bundle guard from Task 9 (`scripts/check-bundle.mjs`) printing its OK line. `[T9]` If the guard is absent, run its check by hand in A.4.

- [ ] **A.2 Source sweeps (the banned list, `01` §9, as greps).** Run from the repo root; the expected result is on each line.

```bash
rg -n "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}\x{2B50}\x{2705}\x{274C}\x{2605}]" frontend/src -g '!*.test.*'    # 0 matches  [T2]
rg -n "gradient\(" frontend/src -g '*.css'                    # only the code-field cells (Join + Display entry) and the EndScreen winner sweep ::after  [T5][T9]
rg -n "transition:\s*all" frontend/src -g '*.css'             # 0  [T1]
rg -n "backdrop-filter" frontend/src -g '*.css'               # 0  [T3]
rg -n "box-shadow" frontend/src -g '*.css'                    # only --shadow-modal (modal + toast)  [T1][T3]
rg -n "translateY\(-6px\)|rotate\(" frontend/src -g '*.css'   # 0 hover lifts / icon rotations  [T4]
rg -n "Welcome to" frontend/src -g '!*.test.*'                # 0  [T4]
rg -ln "startViewTransition" frontend/src -g '!*.test.*'      # exactly frontend/src/hooks/useViewTransitionNavigate.ts  [T10]
rg -ln "auto-animate" frontend/src -g '!*.test.*'             # exactly frontend/src/pages/DisplayPage.tsx  [T9]
rg -n "how-to-play-hero.png" frontend/src frontend/index.html # 0; and the file is gone: ls frontend/public/how-to-play-hero.png → no such file  [T4]
rg -n -- "--space-xs|--easing-spring|bg-drift" frontend/src   # 0  [T11]
node scratchpad/hover-guard.mjs                               # Appendix C — every :hover rule sits inside @media (hover: hover)  [T1]
```

Any unexpected match is a P2 finding (P1 if it is `transition: all` or a hover rule outside the media query on the Team or Console page).

- [ ] **A.3 Font budget and headers.** `[T0]`

```bash
ls -l frontend/public/fonts/            # 4-5 woff2, total ≤ 120 KB (≤ 150 KB with the optional serif)
grep -n "fonts/" frontend/public/_headers frontend/index.html frontend/src/fonts.css
```

Expected: `_headers` has a `/fonts/*` block with `Cache-Control: public, max-age=31536000, immutable`; `index.html` preloads the display face (`<link rel="preload" as="font" type="font/woff2" crossorigin>`); `fonts.css` declares `Anton`, `Instrument Sans`, `Secular One`, `Heebo` with `font-display: swap` and `unicode-range` subsets.

- [ ] **A.4 Bundle size vs baseline.** From the `npm run build` output (gzip column), fill the table in the report. Baseline (2026-09-17, `main @ 586ba3a`): `index-*.js` **60.94 KB**, `vendor-*.js` **74.14 KB**, all CSS chunks **20.93 KB** (sum). Budget (`06` §5, one-dependency option approved): eager JS ≤ baseline + 20 KB; CSS ≤ baseline + 10 KB. Over budget = P2 with the numbers. Then the chunk guard, by hand if the script is missing:

```bash
cd frontend/dist/assets
grep -l "auto-animate\|autoAnimate" *.js          # exactly one file: DisplayPage-*.js  [T9]
grep -lE "framer-motion|lenis|gsap" *.js          # none
```

- [ ] **A.5 Backend + DB gate.** The redesign is frontend-only, but the exit gate (`EXECUTION-CONTRACT.md` §5) wants every suite green on the tree being shipped. Docker must be running; the empty `DATABASE_URL` forces a throwaway testcontainer so the shared local stack from Part 0.4 is not truncated.

```bash
cd backend
ruff check . && ruff format --check . && mypy app
DATABASE_URL="" ./.venv/Scripts/python.exe -m pytest -m "not stress"
DATABASE_URL="" ./.venv/Scripts/python.exe -m pytest -m stress -c pyproject.toml --rootdir=.
```

Expected: the first run ~288 passed / 1 skipped (only `test_rls_anon` may need the isolated rerun from §0.5); the stress run is the buzz-race loop (10 concurrent → 1 winner, 100×) — it must pass every iteration.

- [ ] **A.6 CI on `main` is green.**

```bash
gh run list --branch main --limit 12 --json workflowName,conclusion,headSha,createdAt --jq '.[] | "\(.createdAt) \(.workflowName) \(.conclusion) \(.headSha[0:7])"'
```

Expected: the newest run of each of `Frontend`, `Backend`, `E2E`, `CodeQL` on the current `main` SHA is `success`. A `failure` whose only symptom is the #222 flake gets `gh run rerun <id> --failed`; anything else is a P1 finding.

- [ ] **A.7 Record.** Paste the command outputs (trimmed to the summary lines) into the report under "Part A". Commit the report progress on the report branch: `git add docs/planning/ui-redesign/validation/ && git commit -m "Final validation report: Part A"`.

## Part B — Local e2e, full suite, three browsers

Against the local stack from Part 0.4. Foreground Bash calls cap at 10 minutes and background ones get reaped after ~3, so the suite runs in four batches (each fits one call with `timeout: 600000`). Always `cd` with an absolute path in the same command as the run.

- [ ] **B.1 Chromium, every spec, no retries.**

```bash
cd /c/Users/yulin/GBA/Sound-Clash/tests/e2e && npx playwright test buzzer_race.spec.ts full_game.spec.ts multi_buzz_round.spec.ts wrong_buzz_recovery.spec.ts token_claim_constraints.spec.ts --project=chromium --retries=0 --reporter=list
cd /c/Users/yulin/GBA/Sound-Clash/tests/e2e && npx playwright test bonus_flow.spec.ts soundtrack_playthrough.spec.ts reconnection.spec.ts team_rejoin.spec.ts host_recovery.spec.ts expiration.spec.ts --project=chromium --retries=0 --reporter=list
cd /c/Users/yulin/GBA/Sound-Clash/tests/e2e && npx playwright test display_fit.spec.ts mobile_team.spec.ts manager_cleanup_yt_csp.spec.ts buzzer_realtime_drops.spec.ts admin_songs_crud.spec.ts redesign_guards.spec.ts --project=chromium --retries=0 --reporter=list
cd /c/Users/yulin/GBA/Sound-Clash/tests/e2e && npx playwright test four_teams_twenty_rounds.spec.ts ten_teams_thirty_rounds.spec.ts --project=chromium --retries=0 --reporter=list
```

Expected: every batch ends `N passed`, zero failed, zero skipped. The spec list is the 18 baseline specs plus `redesign_guards.spec.ts` (Task 7's listener + latency guard — `[T7]`, drop it from the third batch in partial mode). `ten_teams_thirty_rounds` verifies the DB after every round; `display_fit` runs ten viewports down to 1024×640 against the new 8+4 TV grid. A failure whose only symptom is `youtube-player`/`data-ready` is the #222 flake (rerun that spec alone up to 3×); any other failure is a P0 (play/score) or P1 (contract) finding — check the DB (`select round_number from game_rounds where game_code='…'`) before deciding, per lessons-learned 2026-06-24.

- [ ] **B.2 Hot-path specs twice more.** Flake shake-out on the buzz path:

```bash
cd /c/Users/yulin/GBA/Sound-Clash/tests/e2e && npx playwright test buzzer_race.spec.ts multi_buzz_round.spec.ts buzzer_realtime_drops.spec.ts --project=chromium --retries=0 --repeat-each=2 --reporter=list
```

Expected: 18/18 passed (9 tests × 2).

- [ ] **B.3 Firefox and WebKit.** These projects are declared but never run in CI; the redesign's one browser-variant feature is the route transition (Firefox < 144 / Safari < 18 must get an instant swap with no errors). Run the navigation-heavy specs on both engines, plus the route audit script from Appendix B against the local dev server with console capture:

```bash
cd /c/Users/yulin/GBA/Sound-Clash/tests/e2e && npx playwright test full_game.spec.ts mobile_team.spec.ts display_fit.spec.ts --project=firefox --retries=0 --reporter=list
cd /c/Users/yulin/GBA/Sound-Clash/tests/e2e && npx playwright test full_game.spec.ts mobile_team.spec.ts display_fit.spec.ts --project=webkit --retries=0 --reporter=list
cd /c/Users/yulin/GBA/Sound-Clash && node scratchpad/redesign-audit.mjs --base http://localhost:5173 --browser firefox --routes-only
cd /c/Users/yulin/GBA/Sound-Clash && node scratchpad/redesign-audit.mjs --base http://localhost:5173 --browser webkit --routes-only
```

Expected: the specs pass, and the audit prints `console errors: 0` for every public route on both engines (the Vite dev server must be up: the preceding Playwright run leaves it running, or start `npm run dev` in `frontend/`). Triage rule: a WebKit failure about YouTube autoplay / `data-ready` is a pre-existing browser-matrix gap (record as P3, not a redesign finding); a failure or console error mentioning `startViewTransition`, `view-transition`, `@starting-style`, a font, or a CSS parse error is a P1.

- [ ] **B.4 Pool exhaustion.** Not an e2e — it is covered by `frontend/src/pages/ManagerConsolePage.test.tsx` ("shows a clear toast when the song pool is exhausted (RpcError no_more_songs)"), which ran in A.1. Confirm the test still exists: `grep -n "no_more_songs" frontend/src/pages/ManagerConsolePage.test.tsx` → ≥ 1 line.

- [ ] **B.5 Record + commit.** Per-batch summary lines and any triage into the report; `git add docs/planning/ui-redesign/validation/ && git commit -m "Final validation report: Part B"`.

---

## Part C — Prod protocol validation (API + RPC + load, no browser)

Everything here needs `dangerouslyDisableSandbox: true`. Every game these steps create is ended by the step itself; C.7 double-checks.

- [ ] **C.1 Post-deploy smoke.** `bash ./tests/smoke/post_deploy.sh https://api.soundclash.org` → exits 0 (health → create → two joins → end).

- [ ] **C.2 Buzzer REST-path smoke (the dead-socket client).**

```bash
SUPABASE_ANON_KEY="$(grep '^VITE_SUPABASE_ANON_KEY=' frontend/.env.production | cut -d= -f2-)" bash ./tests/smoke/buzzer_recovery.sh https://api.soundclash.org
```

Expected: exits 0 through all eight steps (lock atomic, release re-arms, round advances, game ends).

- [ ] **C.3 Prod Realtime smoke (one buzzer round through the deployed UI).**

```bash
cd /c/Users/yulin/GBA/Sound-Clash/tests/e2e && BASE_URL=https://www.soundclash.org npx playwright test --config smoke/playwright.smoke.config.ts --reporter=list
```

Expected: 1 passed. This is the first run that exercises the redesigned Join, Create, Console, Team and Display pages on prod through the real fixtures — a locator failure here means a frozen contract from `02` §4 broke (P1).

- [ ] **C.4 Negative-path API + RPC matrix.** Write Appendix A to `scratchpad/api-matrix.sh` (from this file; it needs the Write tool because of the regex) and run it:

```bash
cd /c/Users/yulin/GBA/Sound-Clash && bash scratchpad/api-matrix.sh
```

Expected: the script prints one `PASS <case>` line per case and ends with `ALL PASS (N cases)`; it ends its own game. Each `FAIL` line is a P0 (a state transition allowed that `docs/game-rules.md` forbids, a token check bypassed) or P1 (a wrong error code). The script covers, in order: health; create-game validation (slugs, empty list); team-name validation (31 chars, whitespace-only, bidi-override stripping); join to an unknown code (`not_found`); same-name reclaim (same id); bonus auth (missing / wrong token → `unauthorized`), bonus bounds (0 and 51 → `validation_error`, 50 → total 50); rejoin-token reveal gating and the `POST /rejoin` round-trip (right token → same id + score, bogus token → `not_found`); `buzz_in` on a `waiting` game → `locked=false`; `select_next_song` with a wrong token → `manager_token_required`; `award_attempt` with no buzz → `no_buzz_to_score`; the atomic lock (`A` wins, `B` sees `A`); a foreign team id → `locked=false`; `wrong` + `title` → `wrong_buzz_with_correct`; `title` → `+10`; second `title` → `title_already_claimed`; `release_buzz_lock` re-arms; wrong right after a correct → `0` (free guess); wrong again → `−3`; `peek_next_song` → one row that does not advance the round; `extend_game` → later `expires_at`; kick → `204` and the kicked team can no longer buzz; `select_next_song` → round 2; end-game auth; end → `ended`; join after end → `gone`; `select_next_song` / `extend_game` after end → `game_ended`; `buzz_in` after end → `locked=false`.

- [ ] **C.5 Rate limiter (last, because it burns the per-IP create bucket for a minute).** 11 game creates in a burst from this machine; the 11th (or earlier) should come back `rate_limited` now that the limiter keys on `CF-Connecting-IP` (PR #231); zero `429`s is not a redesign finding but is recorded for issue #247. The script ends every game it managed to create.

```bash
cd /c/Users/yulin/GBA/Sound-Clash && bash scratchpad/api-matrix.sh --rate-limit-only
```

- [ ] **C.6 Load check: 30 teams in one game, every button flow.** The committed harness (`tests/load/README.md`) plays whole games over REST + direct RPC + one Realtime socket per simulated device and verifies final scores against a local ledger. First the tiny self-check (every flow once), then the 30-team game. Launch the 30-team run **detached** exactly as `tests/load/RUN-PROMPTS.md` prescribes (PowerShell `Start-Process`, sandbox disabled) and watch its `status.json` with the Monitor tool; do not run two checks at once.

```bash
cd /c/Users/yulin/GBA/Sound-Clash && node tests/load/loadtest.mjs smoke --pace fast
```

```powershell
New-Item -ItemType Directory -Force "C:\Users\yulin\GBA\Sound-Clash\tests\load\results" | Out-Null
Start-Process -FilePath "node" -ArgumentList "tests/load/loadtest.mjs","run","--label","final-1x30","--games","1","--teams","30","--rounds","15","--seed","404" -WorkingDirectory "C:\Users\yulin\GBA\Sound-Clash" -RedirectStandardOutput "C:\Users\yulin\GBA\Sound-Clash\tests\load\results\final-1x30-console.log" -RedirectStandardError "C:\Users\yulin\GBA\Sound-Clash\tests\load\results\final-1x30-console.err.log" -WindowStyle Hidden
```

Then read `tests/load/results/final-1x30/report.md`. Expected: verdict **PASS**, `violations: 0` (every race exactly one winner, every ledger delta matched, all 15 rounds `previous+1`, the game ended cleanly); Realtime misses 0 with ≤ 32 sockets. Add the one-line ledger row to `tests/load/FINDINGS.md` (a committed file — stage it on the report branch) and, if the harness itself fails to start, read the `.err.log` before blaming the stack. A WARN on latency percentiles is advisory; a `violation` is a P0.

- [ ] **C.7 No leftovers.**

```bash
supabase db query --linked "select game_code, status, expires_at from active_games where status <> 'ended' and expires_at > now() order by expires_at desc"
```

Expected: only games that were already there in Part 0.5 (a real host's game); anything created by C.1–C.6 is `ended`. End a stray with `curl -s -X POST https://api.soundclash.org/games/<CODE>/end -H "X-Manager-Token: <token>"` if its token is in `tests/load/results/<label>/games.json`; otherwise `node tests/load/loadtest.mjs cleanup --dir tests/load/results/<label>`.

- [ ] **C.8 Record + commit.** `git add docs/planning/ui-redesign/validation/ tests/load/FINDINGS.md && git commit -m "Final validation report: Part C"`.

## Part D — Real-browser games on prod: many teams, every button, every combination

This is goal G1's centrepiece and goal G2's evidence source: one real 13-team game on `https://www.soundclash.org` driven through the **deployed UI** (the host clicks the real console buttons, players press the real BUZZ button, the TV renders the real board), with the DB and the toasts cross-checked after every action, and screenshots of every role at every key state for Part E. It runs as one Playwright script (Appendix D, `scratchpad/prod-game.mjs`, loaded through `tests/e2e/node_modules` — no install) because a human-paced click gap is what the console's `busy` flag expects (lessons-learned 2026-06-24) and because thirteen tabs are unmanageable by hand. Sandbox disabled; `www.` host.

- [ ] **D.1 Run the scripted game.** Write Appendix D to `scratchpad/prod-game.mjs` with the Write tool, then:

```bash
cd /c/Users/yulin/GBA/Sound-Clash && node scratchpad/prod-game.mjs 2>&1 | tee scratchpad/prod-game.log
```

The script prints one `PASS S<n>` / `FAIL S<n>: <reason>` line per scenario below, writes screenshots to `scratchpad/shots/<role>-<state>.png`, and ends the game itself (also on error). Scenario matrix (the script's order):

| # | Who / where | Action | Expected (asserted) |
|---|---|---|---|
| S1 | Host, `/manager/create` | Click preset **Hot Now**, tick **Soundtracks** and the first **Israeli** genre, tick **80s**, click **Create game** | Lands on `/manager/game/<CODE>`; header shows the code + `WAITING`; `game:<CODE>:manager-token` in localStorage; a token-less context on the same URL shows "You're not the host of this game." |
| S2 | Display, `/display` | Type the code, click **Open** | `/display/<CODE>`; "Waiting for teams" banner; QR panel whose link ends `/join/<CODE>` |
| S3 | Players | `FV-01`…`FV-06` join through `/join/<CODE>` (prefilled code, name, **Join game**); `FV-07`…`FV-12` join over REST; one join with code `ZZZZZZ` | Six tabs land on `/team/<CODE>` in the `waiting` tone; Display shows 5 rows + exact text `+7 more teams playing`; each phone's `standing-rank` reads `#k` and `standing-score` reads `0 pts` (never the word "of" — `TeamGameplayPage.test.tsx:304`); the bad code shows "does not exist" |
| S4 | Host | Wait for `youtube-player[data-ready="true"]`, click **Start game** (`start-round`) | Console "Round 1"; every phone `data-tone="idle"` with label `BUZZ`; Display banner in the `playing` state; both YouTube layers mounted and visible |
| S5 | Six phones | Simultaneous `pointerdown` on `buzz` | Exactly one `winner` (`YOU BUZZED`), five `locked-other`; console `role="status"` contains "<name> buzzed in"; Display banner names the same team and `role="timer"` shows 1–10 |
| S6 | Host | **Correct Song** (`score-title`) | Toast "+10 to <name>"; winner keeps the floor (`winner` tone persists, timer restarts); `token-chip-title[data-claimed="true"]`; Display `display-reveal-title[data-revealed="true"]` with the real title; `score-title` disabled; DB score +10; phone chip +10; Display row +10 |
| S7 | Host, then `FV-02` | **Continue round** (`continue-round`); `FV-02` buzzes; **Correct Artist** (`score-artist`) | After Continue every tone is `idle`; `FV-02` wins; toast "+5 to FV-02"; artist chip claimed; Display artist revealed; with both tokens claimed `score-title`, `score-artist` and `continue-round` are disabled |
| S8 | Host | **Next round** (`start-round`) | "Round 2"; tones `idle`; both reveal rows `data-revealed="false"` (masked, no `???` text); chips `data-claimed="false"` |
| S9 | `FV-03`, host | Buzz → **Wrong**; buzz again → **Wrong** | "−3 to FV-03" twice (no lock-out, no free guess yet); each Wrong clears the lock without Continue; DB −6 |
| S10 | `FV-04`, host, `FV-03`, `FV-05`, `FV-06` | `FV-04` buzz → **Correct Song**; **Continue**; `FV-03` buzz → **Wrong**; `FV-05` buzz → **Wrong**; `FV-06` buzz → **Correct Artist** | +10; **0** for `FV-03` (free guess after a correct); **−3** for `FV-05` (flag consumed); +5 for `FV-06`; DB matches at every step |
| S11 | Host | **Bonus** (`score-bonus`) → picker → `FV-12` | Picker lists 12 `bonus-team-*` buttons with aria-label `Award +4 bonus to <name>`; toast "+4 to FV-12"; DB +4 (a REST-only team outside the top 5 still receives it) |
| S12 | `FV-01`, host | Buzz (held) → **Next round** without a verdict | "Round 3"; `FV-01`'s score unchanged (abandoned tokens); tones `idle` |
| S13 | Script, host, `FV-02` | `select_next_song(p_song_id = <a Soundtracks song>)`; `FV-02` buzz → **Correct** (`score-soundtrack`) | Console shows `soundtrack-badge` + `score-soundtrack`, no `score-title`/`score-artist`; Display has exactly **one** reveal row; +15; Display reveals the work name (the `artist` field) |
| S14 | Script, host, `FV-01` | `select_next_song(p_song_id = <an Israeli-genre song>)`; `FV-01` buzz → **Correct Song** | Console song line renders Hebrew; Display title row `dir="auto"`, `scrollWidth <= clientWidth` (no clipping); `document.fonts` reports `Secular One` / `Heebo` `loaded`; screenshots of all three roles |
| S15 | Phones / host / display | Reload `FV-01`'s tab, the console, the Display | Phone keeps its identity + score and can buzz; console resumes at the same round from localStorage; Display board intact |
| S16 | Fresh contexts | Host recovery: `host-link-toggle` → `host-link-url` contains `#mt=`; open it in a token-less context. Team rescue: `rescue-open` → modal → `FV-07` → `rescue-url` contains `#rt=`; open it in a fresh context. Same-name rejoin: fresh context joins as `FV-08` | Recovered console shows the same round and working buttons; rescued tab lands on `/team/<CODE>` with `FV-07`'s score; same-name join resolves to `FV-08`'s existing id and score (no duplicate row) |
| S17 | Script (REST), `FV-06`'s tab | `DELETE /games/<CODE>/teams/<FV-06 id>` with `X-Manager-Token` | 204; the tab redirects to `/` within 5 s; the bonus picker now lists 11; Display no longer lists `FV-06` |
| S18 | Script | `extend_game` RPC; `FV-13` joins over REST mid-game; open a tab for `FV-13`; next round; `FV-13` buzzes | `expires_at` +1 h in the DB (the banner is correctly absent — not within 20 min); Display `+N more teams` recomputes; `FV-13` can win a race |
| S19 | Host | Round with nobody buzzing → **Next round**; then one more full round with `FV-01` buzzing (latency probe, D.4) | Rounds advance with no score change on the skip; the buzz probe numbers are printed |
| S20 | Host, all roles | **End game** (`end-game`) → dialog "This cannot be undone." → confirm | Every role shows the `FINAL RESULTS` heading and the exact text `WINNER`; Display swaps the board for the podium; console shows `export-download` + `export-playlist`; phones show `final-scoreboard` + `final-scoreboard-more` ("and N more teams"); DB `status='ended'`; a fresh join afterwards shows "already ended" |

- [ ] **D.2 Read the results.** Every `FAIL` line is a finding: score/lock/state mismatches are **P0**, missing test ids / attributes / labels are **P1**, purely visual mismatches go to Part E. Paste the full `PASS/FAIL` block into the report.

- [ ] **D.3 Console + network hygiene.** The script collects `console.error`, `pageerror`, `requestfailed` and any console line matching `Refused|Content Security Policy|CSP|violat` per context and prints a per-role summary at the end. Expected: **0** for every role (the YouTube `compute-pressure` warnings are filtered out). Any CSP line is a P1 (the fonts or an icon asset is being served from a disallowed origin); any `pageerror` is a P0.

- [ ] **D.4 Buzz-path latency on prod.** Printed by S19 from `FV-01`'s tab: `pointerdown → data-tone="pending"` and `pointerdown → buzz_in request start`. Expected: pending < **16 ms** (same frame), request start < **5 ms** after the dispatch (the RPC fires before any visual work — `04` §6). Also printed: the `buzz_in` response time for that press. The request figure comes from Playwright's request timing against the page clock, so a one-off 5–20 ms reading is measurement noise: re-run S19's probe three times (a second short game is fine) and take the median before filing. A consistently larger number is a P1 (something was inserted into the buzz path: check that `BuzzButton.tsx` / `useBuzzer.ts` are byte-identical to `main` before the redesign — `git log --oneline main -- frontend/src/components/BuzzButton.tsx frontend/src/hooks/useBuzzer.ts` must show no redesign commit).

- [ ] **D.5 Grafana window.** With the read-only Grafana MCP, using the UTC window from Part 0.5:
  - Tempo (`tempo_traceql-metrics-instant`): `{ name = "game.buzz.e2e" } | quantile_over_time(duration, .5, .95)` for the validation window, and the same for the 7 days ending the day before the first redesign PR touching the Team page merged (Task 7). Expected: p95 within noise of the baseline (rule of thumb: ≤ baseline p95 + 30 ms or + 20 %, whichever is larger). Record both numbers.
  - Loki (`query_loki_logs`, datasource `grafanacloud-logs`): `{service_name="sound-clash-web"} |= "<CODE>" |~ "stale_buzz_lock_resynced|error"` → expected **0** lines; `{service_name="sound-clash-web"} |= "realtime_fanout" |= "<CODE>"` → present (fan-out events were emitted).

- [ ] **D.6 DB cross-check (read-only).** After D.1, compare the script's final ledger with the archive/live rows:

```bash
supabase db query --linked "select name, score from game_teams where game_code='<CODE>' order by score desc, joined_at asc"
supabase db query --linked "select round_number, title_claimed_by is not null as title, artist_claimed_by is not null as artist, ended_at is not null as closed from game_rounds where game_code='<CODE>' order by round_number"
supabase db query --linked "select status, ended_at, expires_at from active_games where game_code='<CODE>'"
```

Expected: scores equal the script's ledger line for line; every round but the last has `closed=true`; the soundtrack round has `title` and `artist` both true; `status='ended'`.

- [ ] **D.7 Sentry.** Open the Sentry project behind `VITE_SENTRY_DSN` (or ask the maintainer for the issues list) and confirm no new issue was created in the validation window. If you cannot reach Sentry, write "not checked — maintainer" in the report; do not guess.

- [ ] **D.8 What only real phones can prove.** The `06` §9 exit gate wants two real phones (one iPhone, one Android) in a game. The script cannot do that; list it in the Part E.7 device checklist for the maintainer, with the exact steps: join both phones through the QR, one buzz race, one Correct Song, one Wrong, Bonus, one soundtrack round, End → podium on both.

- [ ] **D.9 Cleanup.** The script ends its game; confirm and sweep anything else this session created:

```bash
supabase db query --linked "select game_code, status from active_games where game_code in (select game_code from game_teams where name like 'FV-%') and status <> 'ended'"
```

Expected: zero rows. End a straggler with `POST /games/<CODE>/end` + `X-Manager-Token` (the script prints the code and token at start). Then record + commit: `git add docs/planning/ui-redesign/validation/ && git commit -m "Final validation report: Part D"`.

## Part E — Design conformance (is it on screen exactly as planned?)

Two layers: **machine checks** (Appendix E `audit-lib.mjs`, run by the static-route script in Appendix B and, for in-game states, by the game script in Appendix D) and a **looked-at-it review** of the screenshots against `05-page-by-page.md`, done by you with the Read tool on the PNGs. Every check carries the task tag it depends on for partial mode.

- [ ] **E.0 The per-merge prod pass first.** If `tests/smoke/ui_prod_pass.mjs` exists (the scripted `06` §2.4 + §8 pass that each redesign merge runs), run it before anything else in this Part — sandbox disabled, from the repo root:

```bash
node tests/smoke/ui_prod_pass.mjs all
```

Expected: exit 0 and, in full mode, **zero SOFT findings** as well (the emoji sweep, reduced-motion counts and `dir="auto"` findings it labels "expected until Tasks 2/4/9 land" must all be zero once those tasks are merged — a non-zero soft finding here is a P2). Paste its summary into the report; E.1–E.6 then go deeper (four viewports, three engines, the contrast/focus/tap-target audits, in-game states, motion frames). If the script does not exist on `main`, say so in the report and continue with E.1.

- [ ] **E.1 Static routes, all viewports, reduced motion, route transitions.** Write Appendix E to `scratchpad/audit-lib.mjs` and Appendix B to `scratchpad/redesign-audit.mjs`, then:

```bash
cd /c/Users/yulin/GBA/Sound-Clash && node scratchpad/redesign-audit.mjs --base https://www.soundclash.org --browser chromium 2>&1 | tee scratchpad/redesign-audit.log
```

It visits `/`, `/how-to-play`, `/join`, `/join/ABCDEF`, `/manager/create`, `/display` at 1280×800, 1920×1080, iPhone 12 (390×844) and 360×640, screenshots each to `scratchpad/shots/static-<route>-<viewport>.png`, and prints one `OK`/`VIOLATION` line per check per route. The checks, with the spec line each enforces:

| Check | Rule (spec) | Tag |
|---|---|---|
| `tokens` | `--bg #000000`, `--surface #121111`, `--accent #FF7A00`, `--accent-ink #000000`, `--bone #E9E4D9`, `--text-muted #B4A88F`, `--positive #4ADE80`, `--negative #F2352B`, `--warning #F6CC00` on `:root`; `body` background `rgb(0, 0, 0)`; `<meta name="color-scheme" content="dark">`, `theme-color #000000` (`01` §2) | T1 |
| `fonts` | after `document.fonts.ready`: `Anton` and `Instrument Sans` faces `loaded`; `body` `font-family` starts with `Instrument Sans`; every `h1`/`h2` starts with `Anton`; no `Refused`/failed request under `/fonts/`; each `/fonts/*` response has `cache-control` with `immutable` (`01` §3, `06` §5) | T0 T1 |
| `emoji` | `document.body.innerText` has no match for `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{2605}]` (`01` §6, §9) | T2 |
| `gradients` | no element or `::before`/`::after` with `background-image` containing `gradient`, except the six-cell code input (`input[maxlength="6"]`) and the EndScreen winner sweep (`01` §2 "No gradients, anywhere") | T1 T5 T9 |
| `transition-all` | no element with a non-zero `transition-duration` whose `transition-property` is `all` (`07` Global Constraints) | T1 |
| `backdrop-filter` | none anywhere (`01` §2) | T3 |
| `resting-shadow` | `box-shadow` only inside `[role="dialog"]` or the toast region (`01` §2 "No drop shadows on resting elements") | T1 T3 |
| `animations` | every running animation's keyframe properties ⊆ {`transform`, `opacity`, `filter`, `clip-path`, `visibility`} plus, off the hot paths only, {`background-color`, `border-color`, `color`, `outline-color`, `stroke-dashoffset`} (`04` §1 rule 2, §5) | T1–T10 |
| `hover-touch` | every `button`/`a`/`[role="button"]` computes `-webkit-tap-highlight-color: rgba(0, 0, 0, 0)`; create-page pills have `touch-action: manipulation` (#282, `05` §4) | T1 T6 |
| `tap-targets` | on the phone viewports every visible `button`, `input`, `[role="button"]` and block-level `a` is ≥ 44×44 CSS px (`06` §6) | T1 T3 |
| `contrast` | every visible text node ≥ 4.5:1 against its effective background (≥ 3:1 at ≥ 24 px or ≥ 18.66 px bold) (`06` §6) | T1 |
| `focus-ring` | Tab-walking the page, every focused element shows a visible `outline` (≥ 2 px, not `none`) (`01` §4) | T1 |
| `copy` | Home: no "Welcome to"; `h1` = `Name the song. Buzz first.`; subhead `Real-time music trivia for a room full of people and one TV.`; three role links in the order Host / Play / Display; Join rejoin hint verbatim `Already had a team? Enter the same name to rejoin and keep your score.` (`README` decision 4, `05` §2) | T4 T5 |
| `reduced-motion` | in a context with `reducedMotion: "reduce"`, `document.getAnimations().length === 0` one second after load on every route, and `startViewTransition` is never called on navigation (`04` §1 rule 5, §4) | T1 T10 |
| `view-transition` | Chromium, normal motion: Home → Host and Home → Play each call `document.startViewTransition` exactly once; `scrollY === 0` after each; the wordmark text `Sound Clash` exists before and after; Back returns instantly (no extra call); zero console errors (`04` §4) | T10 |
| `routes` (`--routes-only`) | every route renders with zero console errors / page errors / failed requests, on the engine given by `--browser` (`06` §4.1) | — |

Expected: `VIOLATIONS: 0` at the end. Each violation line names the route, viewport, check and offending element; classify per §0.2 (P2 by default; P1 for `fonts`, `focus-ring`, `contrast`, `tap-targets`, `hover-touch` on Team/Console/Create, and for any `routes` error).

- [ ] **E.2 In-game states.** The Part D script ran the same library on every role at these states and printed `AUDIT <role> <state>: OK | VIOLATION …` lines: `waiting`, `playing-idle`, `buzzed`, `claimed-title`, `claimed-both`, `soundtrack`, `hebrew`, `ended`; for the console it also measured the #177 fit at 390×844, 375×667 and 360×640 (`[data-testid^="score-"]`, `continue-round`/`start-round`, `end-game` bottoms ≤ `innerHeight`, `scrollHeight <= innerHeight`), for the Display the #179 fit at 1920×1080 and 1280×720 (`scrollHeight <= innerHeight`, five `li[data-team-id]`, `more-teams` present with 13 teams, absent after the podium), the frozen row markup (`<ol style="--rows:N">`, `li[data-team-id][data-rank]` with exactly three `span` children, `main[data-density="normal"]`), and on the Team page during `playing` that the only infinite animation is the buzz pulse (`04` §6). Grep them out and classify:

```bash
grep -E "^AUDIT" scratchpad/prod-game.log
```

- [ ] **E.3 Prod deploy artefacts.** `[T0][T9][T10]`

```bash
IDX=$(curl -s "https://www.soundclash.org/?cb=$(date +%s)" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://www.soundclash.org$IDX" | grep -oE '(DisplayPage|TeamGameplayPage|ManagerConsolePage|useGameChannel)-[A-Za-z0-9_-]+\.js' | sort -u
# for each printed chunk:
curl -s "https://www.soundclash.org/assets/<chunk>" | grep -c "autoAnimate\|auto-animate"     # DisplayPage: ≥1; every other chunk and index: 0
curl -s "https://www.soundclash.org$IDX" | grep -c "startViewTransition"                        # 1 (the hook is in the eager chunk) — or 0 if the hook is lazy; then exactly one lazy chunk has it
curl -sI https://www.soundclash.org/fonts/anton-latin.woff2 | grep -iE "cache-control|content-type"   # immutable, font/woff2
curl -s "https://www.soundclash.org/?cb=$(date +%s)" | grep -oE '<link rel="preload"[^>]*font[^>]*>'   # the display-face preload
curl -s "https://www.soundclash.org/?cb=$(date +%s)" | grep -oE '<meta name="(theme-color|color-scheme)"[^>]*>'
curl -s https://www.soundclash.org/manifest.webmanifest | jq '{theme_color, background_color}'          # both #000000
```

- [ ] **E.4 Looked-at-it review — every route, every state.** Open the screenshots from E.1 and D.1 with the Read tool (one at a time) and tick each line against `05-page-by-page.md`. Write one sentence per route in the report ("matches", or the deviation). This is where taste enters: a deviation from the spec is a P2; something the spec does not decide is a P3 with your recommendation.

| Route / state | Must see (from `05`) | Tag |
|---|---|---|
| Shell (every page) | Flat black ground, no gradient, no blobs; wordmark as text in the display face + a monochrome four-bar mark; no header stripe; cards `--surface` + 1 px hairline, no shadow; primary buttons solid orange with **black** text; inputs `--surface-2` with a 2 px orange focus outline | T1 T3 |
| Home `/` | Small wordmark top-left; editorial headline "Name the song. Buzz first." left-aligned on desktop; three full-width numbered role rows (01 Host / 02 Play / 03 Display) with an arrow icon, 72 px tall on the phone; "How it works →" as a quiet text link, not a button; entrance stagger on first load only | T4 |
| How to play | SVG schematic (three devices, "ABCDEF", a BUZZ tile) instead of the PNG; numbered steps with a vertical rule; Setup / Play labels; speaker icon, not 🔊 | T2 T4 |
| Join `/join`, `/join/<CODE>` | Centred column ≤ 420 px, no card on the phone; the six-cell code field in the display face with `0/6` and `0/30` tabular counters; full-width "Join game" on the phone with Cancel as a ghost link above; prefilled code muted; error strip red-on-red-soft | T5 |
| Host create | Presets as a horizontally scrolling chip row on the phone (no scrollbar), wrapped on desktop; genre tiles with a drawn-in check, selected = orange-soft fill + orange border, "(N selected)" in the title; decades as one segmented control; sticky bottom "Create game" bar on the phone with the "3 genres · 80s, 90s" caption; no tap flash | T6 |
| Team `/team/<CODE>` — waiting / idle / pending / winner / locked-other | Waiting: `--surface-2` button, muted label, wordmark centred above. Idle: flat orange with a **black** BUZZ label in the display face at `clamp(3rem, 14vw, 7rem)`, pulse ring running. Winner: flat green, black label. Locked-other: flat red, white label. Identity chip top-left and standing chip top-right on translucent `--surface`; no text-shadow, no gradient | T7 |
| Console — waiting / playing / buzzed / claimed / soundtrack / expiry | One-row header: large tabular code chip, status pill (`WAITING` outline bone / `PLAYING` green / `ENDED` muted), round counter right; two icon+text ghost utility buttons; player strip with 1 px border; song title in the display face, artist in the text face, film icon on soundtrack rounds; token chips fill orange-soft with a check when claimed; 2×2 score grid — Correct Song / Correct Artist green outline, Wrong red outline + icon, Bonus bone outline; Continue (secondary) + Next (primary orange) 2-up; End game as a red ghost link; all of it above the fold on a phone | T8 |
| Display — waiting / playing / buzzed / revealed / soundtrack / hebrew | 8+4 grid at ≥ 769 px: board left, sidebar right (reveal rows, countdown, QR pinned to the bottom); very large tabular code chip in the header; buzz banner full-width orange with the team name in the display face, sliding down; reveal rows with note/mic/film icons, masked as five `--surface-2` blocks (no `???`), unmasking with a left→right wipe; countdown as a 4 px orange bar; rank rings (orange for 1, bone for 2–3, hairline for 4–5), names ≥ 2 rem display face, scores in bone at 3 rem; rows slide on reorder; "+8 more teams playing"; QR on a light inset | T9 |
| Final Results (all three roles) | Three podium columns, centre tallest; laurel/crown line icon + "Winner" caption, no ★; cards rise staggered, one light sweep over the winner; no confetti; top-5 table + "and N more teams"; export buttons restyled | T9 |
| Toasts / dialogs / fallback / error | Toast: `--surface`, hairline, 3 px tone bar, slides in 8 px; ConfirmDialog: 70 % black backdrop, panel scales 0.98→1; route fallback: pulsing monochrome mark; error boundary: `--surface` card, same copy, Reload | T3 |
| Admin `/admin/songs` (inherits only) | Dark tokens, new fonts, restyled buttons/inputs; the table still a `<table>`; nothing bespoke | T1 |

- [ ] **E.5 Motion spot-checks you can only see.** The D.1 script saves three mid-animation frames of the Display: `display-buzz-banner-mid.png` (120 ms after the race — the banner partially off-canvas, sliding, never squashed: transform only), `display-reveal-mid.png` (180 ms after Correct Song — the title row mid-wipe: clipped text, not faded) and `display-reorder-mid.png` (420 ms after Correct Song — the winner's row mid-flight, overlapping a neighbour). The timings are heuristics: if a frame already shows the end state, retake it by hand with the Playwright MCP browser on a second short game (`browser_take_screenshot` immediately after the action) before calling the animation missing (P2, `04` §5 rows 19, 21, 22). Also confirm, from the E.1 log, that `/team/<CODE>` while `playing` has exactly one infinite animation (the pulse) and the wordmark bars are paused (`[data-round-live="true"]`).

- [ ] **E.6 Performance budget.** Fill the `06` §5 table in the report: eager JS gzip (A.4), CSS gzip (A.4), fonts total bytes (A.3), the largest raster in `frontend/public` (`find frontend/public -type f \( -name '*.png' -o -name '*.jpg' \) -size +200k` → only the pre-existing `og-image.jpg` / PWA icons, decision 9), the bundle guard (E.3), the buzz latency (D.4), the Tempo p95 (D.5). Lighthouse (mobile preset, `/` and `/join`, Performance + Accessibility + Best Practices) is optional here: `npx lighthouse https://www.soundclash.org/ --preset=perf --form-factor=mobile --output=json --output-path=scratchpad/lh-home.json` runs without touching `package.json`; if you skip it, say so and leave it to the maintainer in DevTools. Accessibility must be ≥ the baseline value recorded in the first run of this file (no baseline yet → record this run as the baseline).

- [ ] **E.7 The device checklist for the maintainer (you cannot do these).** Put this list verbatim in the report under "Owed to the maintainer", ticked by them:

```
- [ ] iPhone (Safari 17/18): /join → /team → one buzz race, one Correct Song, one Wrong, End → podium. Check: dvh fill, no tap flash, black label on orange legible outdoors, fonts load, View Transitions or instant swap with no glitch.
- [ ] Android Chrome (mid-range): same flow; the idle pulse stays smooth (60 fps) with the phone at 50 % brightness; INP on the BUZZ press feels instant.
- [ ] Samsung Internet: /team only — buzz works, tones correct.
- [ ] TV / laptop → HDMI Chrome 1920×1080, from 3 m: code chip and rank numerals readable, QR scannable from a phone, board reorder visible, podium readable.
- [ ] Firefox desktop: / → Host → Play → Display: instant swaps, no blank frame, no console error.
- [ ] Two real phones in one game (06 §9): both join by QR, race, score every button once, soundtrack round, Keep playing +1h (only if within 20 min of expiry), End → podium on both, Export on the host.
- [ ] Chrome "Install app" still offered on prod (PWA unchanged).
```

- [ ] **E.8 Record + commit.** All E outputs (trimmed), the per-route sentences, the screenshot file names, the device checklist; `git add docs/planning/ui-redesign/validation/ && git commit -m "Final validation report: Part E"`.

## Part F — Triage, fixes, report, verdict

- [ ] **F.1 One row per finding.** Number them `F-01`, `F-02`, … in the order found. Columns: id · severity (§0.2) · where found (Part/step or scenario) · route + state · symptom (one line) · evidence (log line, screenshot name, DB row) · spec reference (`01`/`04`/`05` section, or `game-rules.md`/`02` §4 for behaviour) · proposed fix (file + one line) · status.

- [ ] **F.2 Fix loop (P0, P1, and every P2 the spec decides).** For each, in severity order:

1. `git checkout main && git pull && git checkout -b fix/ui-<slug>`.
2. Reproduce with a **failing test first**: a vitest for markup/attribute/copy/logic (`frontend/src/**/*.test.tsx`), an e2e assertion for layout/fit (`tests/e2e/…`), or an added case in `scratchpad/audit-lib.mjs` for a visual rule the suites cannot see (say so in the PR if the only proof is the audit script). Run it, watch it fail.
3. Minimal fix. Respect the `07` Global Constraints (never `BuzzButton.tsx` / `useBuzzer.ts` / `useGameChannel.ts` / `src/lib/`; CSS-only on the buzz screen; hover rules under `(hover: hover)`; compositor properties only).
4. Gate: `cd frontend && npm run format:check && npm run lint && npm run typecheck && npm run test:run && npm run build`; plus the affected e2e spec(s) locally when the Team, Console or Display page changed.
5. CHANGELOG `[Unreleased]` line if a user would notice (`.claude/rules/changelog.md`); one-line commit; `gh pr create` with the default Summary / Test plan body; label `run-e2e` when Team/Console/Display changed.
6. Carry it to merge-ready: `gh pr checks <n> --watch`; list and resolve **bot-authored** review threads (`06` §2.2 GraphQL recipe); confirm `gh pr view <n> --json mergeStateStatus` → `CLEAN`. Never merge.
7. Back in the report: status `fix PR #n (merge-ready)` and, under "Re-verify after merge", the Part/step to re-run once the maintainer merges and Cloudflare deploys.

Findings you do **not** fix (ambiguous P2, every P3, anything needing a dependency or a `.github/workflows/` change) get a recommendation in the row and, if they must survive this session, one GitHub issue each (`gh issue create --title "UI redesign validation: <symptom>" --body-file …`, label none) — never comment on or close issues you did not create.

- [ ] **F.3 Report template** (`docs/planning/ui-redesign/validation/<YYYY-MM-DD>-final-validation.md`):

```markdown
# UI redesign — final validation, <YYYY-MM-DD>

Mode: full | partial (tasks live: T0 … T11; skipped tags: …). Prod build: index-<hash>.js (main @ <sha>). Prod window (UTC): <start>–<end>. Session model: Fable 5.1 (subagents Opus).

## Verdict: GO | NO-GO
<one paragraph: what passed, what is open, what the maintainer must do next>

## Findings
| id | sev | where | route / state | symptom | evidence | spec | proposed fix | status |
|---|---|---|---|---|---|---|---|---|

## Re-verify after merge
- <Part/step> — after PR #n deploys

## Owed to the maintainer
<the Part E.7 device checklist, verbatim>

## Part A — automated gates
<summary lines: tests count vs 521 baseline, coverage %, build sizes vs baseline, sweeps, backend suite, stress loop, CI on main>

## Part B — local e2e
<per batch: N passed; repeats 18/18; firefox/webkit results + triage>

## Part C — prod protocol
<post_deploy / buzzer_recovery / prod_realtime results; api-matrix ALL PASS (N); rate-limit observation; load smoke + final-1x30 verdict, violations, misses, sockets; leftovers query>

## Part D — prod real-browser game
<game code; the S1–S20 PASS/FAIL block; console/network per role; latency numbers; Tempo p50/p95 now vs baseline; Loki lines; DB cross-check; Sentry>

## Part E — design conformance
<E.1 VIOLATIONS count + lines; E.2 AUDIT lines; E.3 artefact checks; E.4 one sentence per route; E.5 motion frames; E.6 budget table>

## Screenshots (scratchpad, not committed)
<file names with one-line descriptions>
```

- [ ] **F.4 Verdict rules.** **GO** when: Parts A–D have no open P0/P1 (fixed = merge-ready PR exists and, if already merged, re-verified); every P2 is either fixed (merge-ready) or listed with a recommendation the maintainer can accept in one click; P3s are listed. **NO-GO** otherwise, with the blocking finding ids in the verdict paragraph. Partial mode can only reach "GO for the tasks live so far".

- [ ] **F.5 Finish.** Push the report branch and open its PR (docs-only; CodeQL is the only check):

```bash
git add docs/planning/ui-redesign/validation/ tests/load/FINDINGS.md
git commit -m "UI redesign final validation report <YYYY-MM-DD>"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -u origin feature/ui-final-validation-report
gh pr create --title "UI redesign: final validation report <YYYY-MM-DD>" --body-file scratchpad/report-pr-body.md
```

Final message to the maintainer, in this order: the verdict line; the findings table; the fix-PR links (each with its merge state); the "Re-verify after merge" list; the device checklist; the report PR link. Nothing else.

---

## Appendix A — `scratchpad/api-matrix.sh` (Part C.4 / C.5)

Bash + curl + jq only; asserts on response bodies (never `-w`). Reads the Supabase URL and anon key from `frontend/.env.production`. Run with the sandbox disabled. `--rate-limit-only` runs just the burst test.

```bash
#!/usr/bin/env bash
# api-matrix.sh — prod negative-path matrix for the REST + direct-RPC surface.
# Usage: bash scratchpad/api-matrix.sh            # full matrix (creates + ends one game)
#        bash scratchpad/api-matrix.sh --rate-limit-only
set -uo pipefail
API="https://api.soundclash.org"
SUPA="$(grep '^VITE_SUPABASE_URL=' frontend/.env.production | cut -d= -f2- | tr -d '\r')"
ANON="$(grep '^VITE_SUPABASE_ANON_KEY=' frontend/.env.production | cut -d= -f2- | tr -d '\r')"
PASSES=0; FAILS=0
pass() { PASSES=$((PASSES+1)); echo "PASS $*"; }
fail() { FAILS=$((FAILS+1)); echo "FAIL $*"; }
check() { # check <case> <actual> <expected>
  if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1: got '$2' expected '$3'"; fi
}
rest() { # rest <method> <path> [json-body] [token]
  local m="$1" p="$2" b="${3:-}" t="${4:-}"
  local args=(-s -X "$m" "$API$p" -H "Content-Type: application/json")
  [ -n "$t" ] && args+=(-H "X-Manager-Token: $t")
  [ -n "$b" ] && args+=(-d "$b")
  curl "${args[@]}"
}
rest_status_only() { # for 204 responses: prints "204" via --fail-with-body semantics, else the body
  local out; out="$(curl -s -o /dev/null --fail-with-body -X "$1" "$API$2" -H "X-Manager-Token: $3" && echo 204)"; echo "${out:-error}"
}
rpc() { # rpc <fn> <json-args>
  curl -s -X POST "$SUPA/rest/v1/rpc/$1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" -d "$2"
}
END_GAMES=()
cleanup() { for g in "${END_GAMES[@]:-}"; do [ -n "$g" ] && rest POST "/games/${g%%:*}/end" "" "${g#*:}" >/dev/null; done; }
trap cleanup EXIT

if [ "${1:-}" = "--rate-limit-only" ]; then
  GENRE="$(curl -s "$API/genres" | jq -r '.[0].id')"
  limited=0
  for i in $(seq 1 11); do
    r="$(rest POST /games "{\"selected_genres\":[\"$GENRE\"]}")"
    code="$(echo "$r" | jq -r '.game_code // empty')"; err="$(echo "$r" | jq -r '.error // empty')"
    [ -n "$code" ] && END_GAMES+=("$code:$(echo "$r" | jq -r .manager_token)")
    [ "$err" = "rate_limited" ] && limited=1 && echo "create #$i -> rate_limited"
  done
  echo "RATE-LIMIT observation: rate_limited seen = $limited (1 = per-IP limiter active from this machine; 0 = record for issue #247, not a redesign finding)"
  exit 0
fi

echo "== health"; check health "$(curl -s "$API/health" | jq -r .status)" ok

echo "== create-game validation"
check create-slugs "$(rest POST /games '{"selected_genres":["rock"]}' | jq -r .error)" validation_error
check create-empty "$(rest POST /games '{"selected_genres":[]}' | jq -r .error)" validation_error
GENRES="$(curl -s "$API/genres")"
G_ROCK="$(echo "$GENRES" | jq -r '.[] | select(.slug=="rock") | .id')"
G_POP="$(echo "$GENRES" | jq -r '.[] | select(.slug=="pop") | .id')"
CREATE="$(rest POST /games "{\"selected_genres\":[\"$G_ROCK\",\"$G_POP\"],\"selected_decades\":[1980,1990,2000,2010,2020]}")"
CODE="$(echo "$CREATE" | jq -r .game_code)"; TOKEN="$(echo "$CREATE" | jq -r .manager_token)"
[ "${#CODE}" = 6 ] && pass "create ($CODE)" || fail "create: $CREATE"
END_GAMES+=("$CODE:$TOKEN")
EXP0="$(echo "$CREATE" | jq -r .expires_at)"

echo "== team-name validation + joins"
LONG="$(printf 'x%.0s' $(seq 1 31))"
check join-31chars "$(rest POST "/games/$CODE/teams" "{\"name\":\"$LONG\"}" | jq -r .error)" validation_error
check join-whitespace "$(rest POST "/games/$CODE/teams" '{"name":"   "}' | jq -r .error)" validation_error
check join-bidi-stripped "$(rest POST "/games/$CODE/teams" "{\"name\":\"\\u202eAlpha\"}" | jq -r .name)" Alpha
A_ID="$(rest POST "/games/$CODE/teams" '{"name":"Alpha"}' | jq -r .id)"     # same name -> reclaim of the row above
B="$(rest POST "/games/$CODE/teams" '{"name":"Bravo"}')"; B_ID="$(echo "$B" | jq -r .id)"
check join-unknown-code "$(rest POST /games/ZZZZZZ/teams '{"name":"Nope"}' | jq -r .error)" not_found
check join-same-name-reclaims-id "$(rest POST "/games/$CODE/teams" '{"name":"Alpha"}' | jq -r .id)" "$A_ID"

echo "== bonus auth + bounds"
check bonus-no-token "$(rest POST "/games/$CODE/bonus" "{\"team_id\":\"$A_ID\",\"points\":4}" | jq -r .error)" unauthorized
check bonus-wrong-token "$(rest POST "/games/$CODE/bonus" "{\"team_id\":\"$A_ID\",\"points\":4}" 00000000-0000-4000-8000-000000000000 | jq -r .error)" unauthorized
check bonus-0 "$(rest POST "/games/$CODE/bonus" "{\"team_id\":\"$A_ID\",\"points\":0}" "$TOKEN" | jq -r .error)" validation_error
check bonus-51 "$(rest POST "/games/$CODE/bonus" "{\"team_id\":\"$A_ID\",\"points\":51}" "$TOKEN" | jq -r .error)" validation_error
check bonus-50 "$(rest POST "/games/$CODE/bonus" "{\"team_id\":\"$A_ID\",\"points\":50}" "$TOKEN" | jq -r .team_total_score)" 50

echo "== rejoin token"
check rejoin-token-no-auth "$(curl -s "$API/games/$CODE/teams/$A_ID/rejoin-token" | jq -r .error)" unauthorized
RT="$(curl -s "$API/games/$CODE/teams/$A_ID/rejoin-token" -H "X-Manager-Token: $TOKEN" | jq -r .rejoin_token)"
check rejoin-by-token-same-id "$(rest POST "/games/$CODE/rejoin" "{\"token\":\"$RT\"}" | jq -r .id)" "$A_ID"
check rejoin-by-token-keeps-score "$(rest POST "/games/$CODE/rejoin" "{\"token\":\"$RT\"}" | jq -r .score)" 50
check rejoin-bogus-token "$(rest POST "/games/$CODE/rejoin" '{"token":"00000000-0000-4000-8000-000000000000"}' | jq -r .error)" not_found

echo "== RPC gates before the game starts"
check buzz-while-waiting "$(rpc buzz_in "{\"p_game_code\":\"$CODE\",\"p_team_id\":\"$A_ID\"}" | jq -r '.[0].locked')" false
check select-wrong-token "$(rpc select_next_song "{\"p_game_code\":\"$CODE\",\"p_manager_token\":\"00000000-0000-4000-8000-000000000000\",\"p_song_id\":null}" | jq -r .message)" manager_token_required
R1="$(rpc select_next_song "{\"p_game_code\":\"$CODE\",\"p_manager_token\":\"$TOKEN\",\"p_song_id\":null}")"
ROUND="$(echo "$R1" | jq -r '.[0].round_id')"; check select-round-1 "$(echo "$R1" | jq -r '.[0].round_number')" 1
check award-no-buzz "$(rpc award_attempt "{\"p_game_code\":\"$CODE\",\"p_round_id\":\"$ROUND\",\"p_correct_title\":true,\"p_correct_artist\":false,\"p_wrong\":false,\"p_manager_token\":\"$TOKEN\"}" | jq -r .message)" no_buzz_to_score

echo "== the lock"
check buzz-A-wins "$(rpc buzz_in "{\"p_game_code\":\"$CODE\",\"p_team_id\":\"$A_ID\"}" | jq -r '.[0].locked')" true
check buzz-B-loses-sees-A "$(rpc buzz_in "{\"p_game_code\":\"$CODE\",\"p_team_id\":\"$B_ID\"}" | jq -r '.[0].locked_team_id')" "$A_ID"
check buzz-foreign-team "$(rpc buzz_in "{\"p_game_code\":\"$CODE\",\"p_team_id\":\"00000000-0000-4000-8000-000000000000\"}" | jq -r '.[0].locked')" false
AWARD() { rpc award_attempt "{\"p_game_code\":\"$CODE\",\"p_round_id\":\"$ROUND\",\"p_correct_title\":$1,\"p_correct_artist\":$2,\"p_wrong\":$3,\"p_manager_token\":\"$TOKEN\"}"; }
check award-wrong-plus-title "$(AWARD true false true | jq -r .message)" wrong_buzz_with_correct
check award-title-plus-10 "$(AWARD true false false | jq -r '.[0].points_delta')" 10
check award-title-again "$(AWARD true false false | jq -r .message)" title_already_claimed
REL="$(rpc release_buzz_lock "{\"p_game_code\":\"$CODE\",\"p_manager_token\":\"$TOKEN\"}")"   # void function: PostgREST returns an empty body on success
if [ -z "$REL" ] || [ "$REL" = "null" ]; then REL=ok; else REL="$(echo "$REL" | jq -r '.message // "ok"')"; fi
check release-lock "$REL" ok
check buzz-B-after-release "$(rpc buzz_in "{\"p_game_code\":\"$CODE\",\"p_team_id\":\"$B_ID\"}" | jq -r '.[0].locked')" true
check award-wrong-free-guess-0 "$(AWARD false false true | jq -r '.[0].points_delta')" 0
check buzz-B-again "$(rpc buzz_in "{\"p_game_code\":\"$CODE\",\"p_team_id\":\"$B_ID\"}" | jq -r '.[0].locked')" true
check award-wrong-minus-3 "$(AWARD false false true | jq -r '.[0].points_delta')" -3
check peek-returns-row "$(rpc peek_next_song "{\"p_game_code\":\"$CODE\",\"p_manager_token\":\"$TOKEN\"}" | jq -r 'length')" 1
EXP1="$(rpc extend_game "{\"p_game_code\":\"$CODE\",\"p_manager_token\":\"$TOKEN\"}" | tr -d '"')"
[ "$EXP1" \> "$EXP0" ] && pass "extend-game ($EXP0 -> $EXP1)" || fail "extend-game: $EXP0 -> $EXP1"

echo "== kick + advance"
check kick-B "$(rest_status_only DELETE "/games/$CODE/teams/$B_ID" "$TOKEN")" 204
check buzz-kicked-B "$(rpc buzz_in "{\"p_game_code\":\"$CODE\",\"p_team_id\":\"$B_ID\"}" | jq -r '.[0].locked')" false
check select-round-2 "$(rpc select_next_song "{\"p_game_code\":\"$CODE\",\"p_manager_token\":\"$TOKEN\",\"p_song_id\":null}" | jq -r '.[0].round_number')" 2

echo "== end"
check end-wrong-token "$(rest POST "/games/$CODE/end" "" 00000000-0000-4000-8000-000000000000 | jq -r .error)" unauthorized
check end-ok "$(rest POST "/games/$CODE/end" "" "$TOKEN" | jq -r .status)" ended
check join-after-end "$(rest POST "/games/$CODE/teams" '{"name":"Late"}' | jq -r .error)" gone
check select-after-end "$(rpc select_next_song "{\"p_game_code\":\"$CODE\",\"p_manager_token\":\"$TOKEN\",\"p_song_id\":null}" | jq -r .message)" game_ended
check extend-after-end "$(rpc extend_game "{\"p_game_code\":\"$CODE\",\"p_manager_token\":\"$TOKEN\"}" | jq -r .message)" game_ended
check buzz-after-end "$(rpc buzz_in "{\"p_game_code\":\"$CODE\",\"p_team_id\":\"$A_ID\"}" | jq -r '.[0].locked')" false

echo; if [ "$FAILS" = 0 ]; then echo "ALL PASS ($PASSES cases)"; else echo "$FAILS FAILED / $PASSES passed"; exit 1; fi
```

## Appendix B — `scratchpad/redesign-audit.mjs` (Part B.3 / E.1)

Static-route audit. Loads Playwright from `tests/e2e/node_modules` (no install). Flags: `--base <url>` (default prod), `--browser chromium|firefox|webkit`, `--routes-only` (console/error capture only; used for Firefox/WebKit and the local dev server). Uses Appendix E.

```js
// redesign-audit.mjs — static routes × viewports × engine; reduced motion; view transitions (Part B.3 / E.1)
import { mkdirSync } from "node:fs";
import { loadPlaywright, attachCapture, auditPage, tabWalk } from "./audit-lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "https://www.soundclash.org").replace(/\/$/, "");
const ENGINE = arg("--browser", "chromium");
const ROUTES_ONLY = process.argv.includes("--routes-only");
const pw = loadPlaywright();
const ROUTES = ["/", "/how-to-play", "/join", "/join/ABCDEF", "/manager/create", "/display"];
const VIEWPORTS = [
  { name: "1280x800", viewport: { width: 1280, height: 800 } },
  { name: "1920x1080", viewport: { width: 1920, height: 1080 } },
  { name: "iphone12", ...pw.devices["iPhone 12"], phone: true },
  { name: "360x640", viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, phone: true },
];
mkdirSync("scratchpad/shots", { recursive: true });
let total = 0;
const report = (route, vp, check, lines) => {
  for (const l of lines) { total++; console.log(`VIOLATION ${route} ${vp} ${l}`); }
  if (!lines.length) console.log(`OK ${route} ${vp} ${check}`);
};
const countTransitions = () => { window.__vt = 0; const o = document.startViewTransition?.bind(document); if (o) document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; };
const browser = await pw[ENGINE].launch();
try {
  for (const vp of ROUTES_ONLY ? [VIEWPORTS[0]] : VIEWPORTS) {
    const { name, phone, ...ctxOpts } = vp;
    if (ENGINE === "firefox") delete ctxOpts.isMobile; // firefox rejects isMobile
    const ctx = await browser.newContext(ctxOpts);
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const cap = attachCapture(page, `${route}@${name}`);
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `scratchpad/shots/static-${route.replace(/\//g, "_") || "_home"}-${name}.png`, fullPage: true });
      report(route, name, "routes", [...cap.errors, ...cap.csp, ...cap.failed].map((l) => `routes: ${l}`));
      if (!ROUTES_ONLY) {
        report(route, name, "audit", (await auditPage(page, { profile: "default", phone })).violations);
        report(route, name, "focus-ring", await tabWalk(page));
        report(route, name, "fonts-cache", cap.fontHeaders.filter((h) => !/immutable/.test(h)).map((h) => `fonts: ${h}`));
        if (route === "/") report(route, name, "copy", await page.evaluate(() => {
          const v = []; const t = document.body.innerText;
          if (/Welcome to/i.test(t)) v.push("copy: 'Welcome to' present");
          const h1 = document.querySelector("h1")?.textContent.trim();
          if (h1 !== "Name the song. Buzz first.") v.push(`copy: h1 '${h1}'`);
          if (!t.includes("Real-time music trivia for a room full of people and one TV.")) v.push("copy: subhead missing");
          const links = [...document.querySelectorAll("a")].map((a) => a.textContent.trim().toLowerCase());
          const idx = ["host", "play", "display"].map((w) => links.findIndex((l) => l.startsWith(w)));
          if (idx.some((i) => i < 0) || !(idx[0] < idx[1] && idx[1] < idx[2])) v.push(`copy: role links order ${JSON.stringify(links.slice(0, 6))}`);
          return v;
        }));
        if (route.startsWith("/join")) report(route, name, "copy", await page.evaluate(() => (document.body.innerText.includes("Already had a team? Enter the same name to rejoin and keep your score.") ? [] : ["copy: rejoin hint drifted"])));
      }
      await page.close();
    }
    await ctx.close();
  }
  if (!ROUTES_ONLY && ENGINE === "chromium") {
    const rm = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
    await rm.addInitScript(countTransitions);
    for (const route of ROUTES) {
      const page = await rm.newPage();
      await page.goto(BASE + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      const n = await page.evaluate(() => document.getAnimations().length);
      report(route, "reduced", "reduced-motion", n ? [`reduced-motion: ${n} animation(s) running`] : []);
      await page.close();
    }
    const p = await rm.newPage();
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.getByRole("link", { name: /host/i }).first().click();
    await p.waitForURL(/\/manager\/create/);
    report("/", "reduced", "reduced-motion", (await p.evaluate(() => window.__vt)) ? ["reduced-motion: startViewTransition called under reduce"] : []);
    await rm.close();

    const vt = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await vt.addInitScript(countTransitions);
    const page = await vt.newPage();
    const cap = attachCapture(page, "view-transition");
    const v = [];
    for (const [name, urlRe] of [[/host/i, /\/manager\/create/], [/play/i, /\/join/]]) {
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.evaluate(() => window.scrollTo(0, 300));
      await page.getByRole("link", { name }).first().click();
      await page.waitForURL(urlRe);
      await page.waitForTimeout(400);
      const calls = await page.evaluate(() => window.__vt);
      if (calls !== 1) v.push(`view-transition: ${calls} startViewTransition call(s) for Home → ${name} (want 1)`);
      if ((await page.evaluate(() => scrollY)) !== 0) v.push(`view-transition: scrollY not 0 after Home → ${name}`);
      if (!(await page.getByText("Sound Clash").first().isVisible())) v.push("view-transition: wordmark missing after navigation");
      await page.goBack();
      await page.waitForURL(/\/$/);
      await page.waitForTimeout(300);
      if ((await page.evaluate(() => window.__vt)) !== 1) v.push("view-transition: Back triggered a transition (must be instant)");
    }
    report("/", "1280x800", "view-transition", [...v, ...cap.errors.map((e) => `view-transition: console ${e}`)]);
    await vt.close();
  }
} finally {
  await browser.close();
}
console.log(`VIOLATIONS: ${total}`);
process.exit(total ? 1 : 0);
```

## Appendix C — source guards (Part A.2)

`scratchpad/hover-guard.mjs` — run from the repo root. Walks every `.css` under `frontend/src`, tracks `@media` nesting by brace depth, and prints each `:hover` selector that is not inside an `@media (hover: hover)` block.

```js
// hover-guard.mjs — every :hover rule must sit inside @media (hover: hover)   (07 Global Constraints)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".css")) files.push(p);
  }
})("frontend/src");
let bad = 0;
for (const f of files) {
  const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const stack = [];
  let buf = "", line = 1, guarded = 0;
  for (const ch of css) {
    if (ch === "\n") line++;
    if (ch === "{") {
      const sel = buf.trim();
      const isGuard = /^@media[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(sel);
      stack.push(isGuard);
      if (isGuard) guarded++;
      if (sel.includes(":hover") && guarded === 0) { bad++; console.log(`${f}:${line}  ${sel}`); }
      buf = "";
    } else if (ch === "}") { if (stack.pop()) guarded--; buf = ""; }
    else if (ch === ";") buf = "";
    else buf += ch;
  }
}
console.log(bad ? `${bad} :hover rule(s) outside @media (hover: hover)` : "hover-guard OK");
process.exit(bad ? 1 : 0);
```

## Appendix D — `scratchpad/prod-game.mjs` (Part D)

The 13-team real-browser game. Same loader as Appendix B; uses Appendix E for the in-game audits. Prints `PASS S<n>` / `FAIL S<n>: …`, `AUDIT <role> <state>: …`, `LATENCY …`, `CONSOLE <role>: …`, and ends its game in a `finally`.

```js
// prod-game.mjs — the 13-team real-browser game on prod (Part D, scenarios S1–S20)
import { mkdirSync, readFileSync } from "node:fs";
import { loadPlaywright, attachCapture, captureSummary, auditPage, fitConsole, fitDisplay } from "./audit-lib.mjs";
const BASE = "https://www.soundclash.org", API = "https://api.soundclash.org";
const env = readFileSync("frontend/.env.production", "utf8");
const SUPA = env.match(/^VITE_SUPABASE_URL=(.+)$/m)[1].trim();
const ANON = env.match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m)[1].trim();
const pw = loadPlaywright();
mkdirSync("scratchpad/shots", { recursive: true });
const results = []; let fails = 0;
const pass = (s, note = "") => { results.push(`PASS ${s}${note ? " — " + note : ""}`); console.log(results.at(-1)); };
const fail = (s, why) => { fails++; results.push(`FAIL ${s}: ${why}`); console.log(results.at(-1)); };
const expect = (s, cond, why) => (cond ? pass(s) : fail(s, why));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };
const rest = async (m, p, body, token) => { const r = await fetch(API + p, { method: m, headers: { "Content-Type": "application/json", ...(token ? { "X-Manager-Token": token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.status === 204 ? { status: 204 } : r.json(); };
const rpc = async (fn, args) => (await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args) })).json();
const get = async (q) => (await fetch(`${SUPA}/rest/v1/${q}`, { headers: H })).json();
const scores = async () => Object.fromEntries((await get(`game_teams?game_code=eq.${CODE}&select=id,name,score`)).map((t) => [t.name, t]));
const currentSong = async () => (await get(`game_rounds?game_code=eq.${CODE}&order=round_number.desc&limit=1&select=round_number,songs(title,artist)`))[0];
const songInGenre = async (slug) => { const g = (await get(`genres?slug=eq.${slug}&select=id`))[0]; return (await get(`song_genres?genre_id=eq.${g.id}&select=song_id&limit=1`))[0].song_id; };
const hebrew = (s) => /[֐-׿]/.test(s ?? "");

const browser = await pw.chromium.launch();
const caps = [];
const roles = [];
async function newRole(name, opts = {}) { const ctx = await browser.newContext(opts); const page = await ctx.newPage(); caps.push(attachCapture(page, name)); const r = { ctx, page, name }; roles.push(r); return r; }
const shot = (r, state) => r.page.screenshot({ path: `scratchpad/shots/${r.name}-${state}.png` }).catch(() => {});
const tone = (t) => t.page.getByTestId("buzz").getAttribute("data-tone");
const waitTone = async (t, want, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await tone(t)) === want) return true; await sleep(100); } return false; };
const buzz = (t) => t.page.getByTestId("buzz").dispatchEvent("pointerdown", { button: 0 });
const audit = async (r, state, opts) => { const { violations, infinite } = await auditPage(r.page, opts); console.log(`AUDIT ${r.name} ${state}: ${violations.length ? violations.join(" | ") : "OK"}${opts.profile === "hot" ? ` infinite=${infinite}` : ""}`); return infinite; };
let CODE = "", TOKEN = "";
let host, display;
const teams = {};
const click = async (id) => { await host.page.getByTestId(id).click(); await sleep(1200); }; // human-paced: the console's busy flag (lessons-learned 2026-06-24)
const toast = (re) => host.page.getByText(re).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
const round = (n) => host.page.getByText(new RegExp(`Round ${n}$`)).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
const disabled = (id) => host.page.getByTestId(id).isDisabled();
const claimed = (id) => host.page.getByTestId(id).getAttribute("data-claimed");
const revealed = (id) => display.page.getByTestId(id).getAttribute("data-revealed");
async function joinUI(name) {
  const t = await newRole(name, pw.devices["iPhone 12"]);
  await t.page.goto(`${BASE}/join/${CODE}`);
  await t.page.getByLabel(/team name/i).fill(name);
  await t.page.getByRole("button", { name: /join game/i }).click();
  await t.page.waitForURL(new RegExp(`/team/${CODE}`));
  teams[name] = t; return t;
}
async function openTeamTab(name, id) {
  const t = await newRole(name, pw.devices["iPhone 12"]);
  await t.page.goto(`${BASE}/`);
  await t.page.evaluate(([c, v]) => localStorage.setItem(`game:${c}:team`, v), [CODE, JSON.stringify({ id, name })]);
  await t.page.goto(`${BASE}/team/${CODE}`);
  teams[name] = t; return t;
}
let roundNo = 0;
const next = async () => { roundNo++; await click("start-round"); return round(roundNo); };

try {
  // S1 — create through the real UI
  host = await newRole("host", { viewport: { width: 1280, height: 800 } });
  await host.page.goto(`${BASE}/manager/create`);
  await host.page.getByRole("button", { name: /hot now/i }).click();
  await host.page.getByLabel(/^soundtracks$/i).check();
  await host.page.getByLabel(/israeli pop/i).check();
  await host.page.getByLabel(/80s/i).check();
  await host.page.getByRole("button", { name: /create game/i }).click();
  await host.page.waitForURL(/\/manager\/game\/([A-Z0-9]{6})/, { timeout: 60000 });
  CODE = host.page.url().match(/\/manager\/game\/([A-Z0-9]{6})/)[1];
  TOKEN = await host.page.evaluate((c) => localStorage.getItem(`game:${c}:manager-token`), CODE);
  console.log(`GAME ${CODE} token ${TOKEN}`);
  const stranger = await newRole("stranger", { viewport: { width: 1280, height: 800 } });
  await stranger.page.goto(`${BASE}/manager/game/${CODE}`);
  const notHost = await stranger.page.getByText(/not the host of this game/i).isVisible({ timeout: 8000 }).catch(() => false);
  expect("S1", CODE.length === 6 && !!TOKEN && (await host.page.getByText(/waiting/i).first().isVisible()) && notHost, `code=${CODE} token=${!!TOKEN} notHost=${notHost}`);
  await stranger.ctx.close();
  await shot(host, "waiting");

  // S2 — display code entry
  display = await newRole("display", { viewport: { width: 1920, height: 1080 } });
  await display.page.goto(`${BASE}/display`);
  await display.page.getByPlaceholder(/ABCDEF/i).fill(CODE);
  await display.page.getByRole("button", { name: /open/i }).click();
  await display.page.waitForURL(new RegExp(`/display/${CODE}`));
  expect("S2", (await display.page.getByText(/waiting for teams/i).isVisible({ timeout: 8000 })) && (await display.page.getByText(new RegExp(`/join/${CODE}`)).first().isVisible()), "waiting banner or QR link missing");
  await shot(display, "waiting");

  // S3 — thirteen joins (six real phones, six REST, one bad code)
  for (let i = 1; i <= 6; i++) await joinUI(`FV-0${i}`);
  for (let i = 7; i <= 12; i++) await rest("POST", `/games/${CODE}/teams`, { name: `FV-${String(i).padStart(2, "0")}` });
  const bad = await newRole("badcode", pw.devices["iPhone 12"]);
  await bad.page.goto(`${BASE}/join/ZZZZZZ`); await bad.page.getByLabel(/team name/i).fill("Nope"); await bad.page.getByRole("button", { name: /join game/i }).click();
  const badMsg = await bad.page.getByText(/does not exist/i).isVisible({ timeout: 8000 }).catch(() => false); await bad.ctx.close();
  await sleep(1500);
  const s3 = [];
  if ((await display.page.locator("li[data-team-id]").count()) !== 5) s3.push("display rows != 5");
  if ((await display.page.getByTestId("more-teams").textContent())?.trim() !== "+7 more teams playing") s3.push("more-teams text");
  for (const t of Object.values(teams)) {
    if (!/^#\d+$/.test((await t.page.getByTestId("standing-rank").textContent())?.trim() ?? "")) s3.push(`${t.name} standing-rank`);
    if ((await t.page.getByTestId("standing-score").textContent())?.trim() !== "0 pts") s3.push(`${t.name} standing-score`);
    if (!(await waitTone(t, "waiting", 5000))) s3.push(`${t.name} tone ${await tone(t)}`);
  }
  if (!badMsg) s3.push("bad code message");
  expect("S3", s3.length === 0, s3.join(", "));
  await shot(teams["FV-01"], "waiting"); await shot(display, "13-teams");
  await audit(display, "waiting", { profile: "display", expectBoard: true });
  await audit(teams["FV-01"], "waiting", { profile: "hot", phone: true });

  // S4 — start
  await host.page.locator('[data-testid="youtube-player"][data-ready="true"]').waitFor({ timeout: 45000 });
  const ok4 = await next();
  const idle = (await Promise.all(Object.values(teams).map((t) => waitTone(t, "idle")))).every(Boolean);
  const players = await host.page.locator('[data-testid^="youtube-player"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));
  expect("S4", ok4 && idle && players.length === 2 && players.every(Boolean), `round=${ok4} idle=${idle} players=${JSON.stringify(players)}`);
  await shot(host, "playing-idle"); await shot(teams["FV-01"], "playing-idle"); await shot(display, "playing");
  const inf = await audit(teams["FV-01"], "playing-idle", { profile: "hot", phone: true });
  expect("S4-pulse", inf === 1 && (await teams["FV-01"].page.locator('[data-round-live="true"]').count()) === 1, `infinite animations=${inf} (want 1 = the buzz pulse); data-round-live present=${await teams["FV-01"].page.locator('[data-round-live="true"]').count()}`);
  await audit(host, "playing-idle", { profile: "hot" });

  // S5 — six-way race
  const racers = Object.values(teams);
  await Promise.all([...racers.map(buzz), sleep(120).then(() => shot(display, "buzz-banner-mid"))]);
  await sleep(1500);
  const tones = {}; for (const t of racers) tones[t.name] = await tone(t);
  const winners = Object.entries(tones).filter(([, v]) => v === "winner").map(([k]) => k);
  const losers = Object.values(tones).filter((v) => v === "locked-other").length;
  const winner = winners[0];
  const statusOk = await host.page.locator('[role="status"]').filter({ hasText: /buzzed in/i }).filter({ hasText: winner ?? "∅" }).first().isVisible({ timeout: 8000 }).catch(() => false);
  const bannerOk = await display.page.getByRole("status").filter({ hasText: winner ?? "∅" }).first().isVisible({ timeout: 8000 }).catch(() => false);
  const timerTxt = (await display.page.getByRole("timer").textContent().catch(() => "")) ?? "";
  const secs = parseInt(timerTxt.replace(/\D/g, ""), 10);
  expect("S5", winners.length === 1 && losers === 5 && statusOk && bannerOk && secs >= 1 && secs <= 10, `tones=${JSON.stringify(tones)} status=${statusOk} banner=${bannerOk} timer='${timerTxt}'`);
  await shot(host, "buzzed"); await shot(display, "buzzed"); await shot(teams[winner], "winner"); await shot(racers.find((t) => t.name !== winner), "locked-other");
  await audit(host, "buzzed", { profile: "hot" }); await audit(display, "buzzed", { profile: "display", expectBoard: true }); await audit(teams[winner], "winner", { profile: "hot", phone: true });
  for (const vp of [[390, 844], [375, 667], [360, 640]]) {
    const c = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, isMobile: true, hasTouch: true });
    const p = await c.newPage(); await p.goto(`${BASE}/`); await p.evaluate(([code, tok]) => localStorage.setItem(`game:${code}:manager-token`, tok), [CODE, TOKEN]);
    await p.goto(`${BASE}/manager/game/${CODE}`); await p.getByTestId("score-title").waitFor({ timeout: 20000 });
    const v = await fitConsole(p); console.log(`AUDIT host fit-${vp[0]}x${vp[1]}: ${v.length ? v.join(" | ") : "OK"}`);
    await p.screenshot({ path: `scratchpad/shots/host-buzzed-${vp[0]}x${vp[1]}.png` }); await c.close();
  }
  for (const vp of [[1920, 1080], [1280, 720]]) {
    await display.page.setViewportSize({ width: vp[0], height: vp[1] }); await sleep(600);
    const v = await fitDisplay(display.page, 12); console.log(`AUDIT display fit-${vp[0]}x${vp[1]}: ${v.length ? v.join(" | ") : "OK"}`);
  }
  await display.page.setViewportSize({ width: 1920, height: 1080 });

  // S6 — Correct Song
  let before = await scores();
  await Promise.all([click("score-title"), sleep(180).then(() => shot(display, "reveal-mid")), sleep(420).then(() => shot(display, "reorder-mid"))]);
  const song = await currentSong();
  const s6 = [];
  if (!(await toast(new RegExp(`\\+10 to ${winner}`)))) s6.push("toast");
  if (!(await waitTone(teams[winner], "winner", 3000))) s6.push("floor not kept");
  if ((await claimed("token-chip-title")) !== "true") s6.push("chip");
  if ((await revealed("display-reveal-title")) !== "true") s6.push("reveal attr");
  await sleep(1200);
  if (!(await display.page.getByTestId("display-reveal-title").textContent())?.includes(song.songs.title)) s6.push("reveal text");
  if (!(await disabled("score-title"))) s6.push("score-title enabled");
  const after = await scores();
  if (after[winner].score !== before[winner].score + 10) s6.push(`db ${before[winner].score}→${after[winner].score}`);
  if ((await teams[winner].page.getByTestId("standing-score").textContent())?.trim() !== `${after[winner].score} pts`) s6.push("chip score");
  const rowScore = await display.page.locator(`li[data-team-id="${after[winner].id}"] > span:nth-child(3)`).textContent().catch(() => null);
  if (rowScore !== null && rowScore.replace(/\D/g, "") !== String(after[winner].score)) s6.push(`display row ${rowScore}`);
  expect("S6", s6.length === 0, s6.join(", "));
  await shot(display, "claimed-title"); await shot(host, "claimed-title");
  await audit(display, "claimed-title", { profile: "display", expectBoard: true });

  // S7 — Continue, second team, Correct Artist, both claimed
  await click("continue-round");
  const allIdle = (await Promise.all(racers.map((t) => waitTone(t, "idle")))).every(Boolean);
  await buzz(teams["FV-02"]); const w2 = await waitTone(teams["FV-02"], "winner");
  before = await scores(); await click("score-artist");
  const s7 = [];
  if (!allIdle) s7.push("not all idle after Continue"); if (!w2) s7.push("FV-02 did not win");
  if (!(await toast(/\+5 to FV-02/))) s7.push("toast");
  if ((await claimed("token-chip-artist")) !== "true") s7.push("artist chip");
  if ((await revealed("display-reveal-artist")) !== "true") s7.push("artist reveal");
  await sleep(1200);
  if (!(await display.page.getByTestId("display-reveal-artist").textContent())?.includes(song.songs.artist)) s7.push("artist text");
  for (const id of ["score-title", "score-artist", "continue-round"]) if (!(await disabled(id))) s7.push(`${id} enabled`);
  if ((await scores())["FV-02"].score !== before["FV-02"].score + 5) s7.push("db");
  expect("S7", s7.length === 0, s7.join(", "));
  await shot(host, "claimed-both"); await shot(display, "claimed-both");
  await audit(host, "claimed-both", { profile: "hot" }); await audit(display, "claimed-both", { profile: "display", expectBoard: true });

  // S8 — Next round resets the round UI
  const ok8 = await next();
  const s8 = [];
  if (!ok8) s8.push("round 2"); if (!(await Promise.all(racers.map((t) => waitTone(t, "idle")))).every(Boolean)) s8.push("tones");
  for (const id of ["display-reveal-title", "display-reveal-artist"]) if ((await revealed(id)) !== "false") s8.push(`${id} not masked`);
  for (const id of ["token-chip-title", "token-chip-artist"]) if ((await claimed(id)) !== "false") s8.push(`${id} not open`);
  if ((await display.page.locator("body").innerText()).includes("???")) s8.push("literal ??? on display");
  expect("S8", s8.length === 0, s8.join(", "));
  await shot(display, "masked");

  // S9 — Wrong twice, no lock-out, no free guess yet
  before = await scores();
  const s9 = [];
  for (let i = 0; i < 2; i++) {
    await buzz(teams["FV-03"]); if (!(await waitTone(teams["FV-03"], "winner"))) s9.push(`buzz ${i + 1}`);
    await click("score-wrong"); if (!(await toast(/[-−]3 to FV-03/))) s9.push(`toast ${i + 1}`);
    if (!(await waitTone(teams["FV-03"], "idle"))) s9.push(`lock not cleared ${i + 1}`);
  }
  if ((await scores())["FV-03"].score !== before["FV-03"].score - 6) s9.push("db");
  expect("S9", s9.length === 0, s9.join(", "));

  // S10 — free-guess waiver and its consumption
  const step = async (team, btn, delta) => { const b = (await scores())[team].score; await buzz(teams[team]); if (!(await waitTone(teams[team], "winner"))) return `${team} no win`; await click(btn); await sleep(800); const a = (await scores())[team].score; return a === b + delta ? "" : `${team} ${btn} ${b}→${a} want ${delta}`; };
  const s10 = [];
  s10.push(await step("FV-04", "score-title", 10)); await click("continue-round");
  s10.push(await step("FV-03", "score-wrong", 0));
  s10.push(await step("FV-05", "score-wrong", -3));
  s10.push(await step("FV-06", "score-artist", 5));
  expect("S10", s10.every((x) => !x), s10.filter(Boolean).join(", "));

  // S11 — Bonus to a REST-only team
  await click("score-bonus");
  const picker = host.page.locator('[data-testid^="bonus-team-"]');
  const n11 = await picker.count();
  const label = await host.page.getByRole("button", { name: "Award +4 bonus to FV-12" }).count();
  before = await scores();
  await host.page.getByRole("button", { name: "Award +4 bonus to FV-12" }).first().click(); await sleep(1200);
  expect("S11", n11 === 12 && label === 1 && (await toast(/\+4 to FV-12/)) && (await scores())["FV-12"].score === before["FV-12"].score + 4, `picker=${n11} label=${label}`);

  // S12 — Next round with a held buzz abandons the tokens
  await buzz(teams["FV-01"]); await waitTone(teams["FV-01"], "winner");
  before = await scores(); const ok12 = await next();
  expect("S12", ok12 && (await scores())["FV-01"].score === before["FV-01"].score && (await waitTone(teams["FV-01"], "idle")), "round/score/tone");

  // S13 — soundtrack round (manual pick)
  roundNo++; await rpc("select_next_song", { p_game_code: CODE, p_manager_token: TOKEN, p_song_id: await songInGenre("soundtracks") });
  await host.page.getByTestId("score-soundtrack").waitFor({ timeout: 15000 });
  const s13 = [];
  if ((await host.page.getByTestId("soundtrack-badge").count()) < 1) s13.push("badge");
  if ((await host.page.getByTestId("score-title").count()) || (await host.page.getByTestId("score-artist").count())) s13.push("title/artist buttons present");
  await sleep(1000);
  if ((await display.page.locator('[data-testid^="display-reveal-"]').count()) !== 1) s13.push("display rows != 1");
  const st = await currentSong(); before = await scores();
  await buzz(teams["FV-02"]); if (!(await waitTone(teams["FV-02"], "winner"))) s13.push("no win");
  await click("score-soundtrack"); if (!(await toast(/\+15 to FV-02/))) s13.push("toast");
  await sleep(1200);
  if ((await scores())["FV-02"].score !== before["FV-02"].score + 15) s13.push("db");
  if (!(await display.page.locator('[data-testid^="display-reveal-"]').first().textContent())?.includes(st.songs.artist)) s13.push("work name not revealed");
  expect("S13", s13.length === 0, s13.join(", "));
  await shot(host, "soundtrack"); await shot(display, "soundtrack");
  await audit(host, "soundtrack", { profile: "hot" }); await audit(display, "soundtrack", { profile: "display", expectBoard: true });
  await click("continue-round");

  // S14 — Hebrew round (manual pick)
  roundNo++; await rpc("select_next_song", { p_game_code: CODE, p_manager_token: TOKEN, p_song_id: await songInGenre("israeli-pop") });
  await sleep(2500);
  const s14 = [];
  const line = await host.page.locator('[class*="songLine"]').first().textContent().catch(() => "");
  if (!hebrew(line)) s14.push(`console song line '${line}' not Hebrew`);
  await buzz(teams["FV-01"]); if (!(await waitTone(teams["FV-01"], "winner"))) s14.push("no win");
  await click("score-title"); await sleep(1500);
  const row = display.page.getByTestId("display-reveal-title");
  if ((await row.getAttribute("data-revealed")) !== "true") s14.push("not revealed");
  if (!hebrew(await row.textContent())) s14.push("display title not Hebrew");
  if ((await row.locator('[dir="auto"]').count()) + ((await row.getAttribute("dir")) === "auto" ? 1 : 0) === 0) s14.push("no dir=auto");
  if (await row.evaluate((el) => el.scrollWidth > el.clientWidth + 1)) s14.push("clipped");
  if (!(await display.page.evaluate(() => [...document.fonts].some((f) => /Secular One|Heebo/.test(f.family) && f.status === "loaded")))) s14.push("Hebrew face not loaded");
  expect("S14", s14.length === 0, s14.join(", "));
  await shot(host, "hebrew"); await shot(display, "hebrew"); await shot(teams["FV-01"], "hebrew");
  await audit(display, "hebrew", { profile: "display", expectBoard: true });

  // S15 — reloads
  const scBefore = (await teams["FV-01"].page.getByTestId("standing-score").textContent())?.trim();
  await teams["FV-01"].page.reload(); await teams["FV-01"].page.getByTestId("buzz").waitFor({ timeout: 20000 });
  const s15 = [];
  if (!(await waitTone(teams["FV-01"], "winner"))) s15.push("floor lost after reload");
  if ((await teams["FV-01"].page.getByTestId("standing-score").textContent())?.trim() !== scBefore) s15.push("score chip changed");
  await click("continue-round"); if (!(await waitTone(teams["FV-01"], "idle"))) s15.push("not idle after continue");
  await host.page.reload(); if (!(await round(roundNo))) s15.push("console did not resume");
  await display.page.reload(); await sleep(2500); if ((await display.page.locator("li[data-team-id]").count()) !== 5) s15.push("display rows after reload");
  expect("S15", s15.length === 0, s15.join(", "));

  // S16 — host recovery link, team rescue QR, same-name rejoin
  const s16 = [];
  await host.page.getByTestId("host-link-toggle").click();
  const hostUrl = (await host.page.getByTestId("host-link-url").textContent())?.trim() ?? "";
  if (!hostUrl.includes("#mt=")) s16.push("host link has no #mt=");
  const rec = await newRole("host-recovered", { viewport: { width: 1280, height: 800 } });
  await rec.page.goto(hostUrl); if (!(await rec.page.getByTestId("score-title").isVisible({ timeout: 20000 }).catch(() => false))) s16.push("recovered console unusable");
  await rec.ctx.close();
  const map = await scores();
  await host.page.getByTestId("rescue-open").click();
  await host.page.getByTestId(`rescue-team-${map["FV-07"].id}`).click();
  const rescueUrl = (await host.page.getByTestId("rescue-url").textContent())?.trim() ?? "";
  if (!rescueUrl.includes("#rt=")) s16.push("rescue url has no #rt=");
  await host.page.getByTestId("rescue-close").click();
  const rescued = await newRole("FV-07-rescued", pw.devices["iPhone 12"]);
  await rescued.page.goto(rescueUrl); await rescued.page.waitForURL(new RegExp(`/team/${CODE}`), { timeout: 20000 }).catch(() => s16.push("rescue did not land on /team"));
  if ((await rescued.page.getByTestId("standing-score").textContent().catch(() => ""))?.trim() !== `${map["FV-07"].score} pts`) s16.push("rescued score");
  const again = await newRole("FV-08-again", pw.devices["iPhone 12"]);
  await again.page.goto(`${BASE}/join/${CODE}`); await again.page.getByLabel(/team name/i).fill("FV-08"); await again.page.getByRole("button", { name: /join game/i }).click();
  await again.page.waitForURL(new RegExp(`/team/${CODE}`));
  const stored = JSON.parse(await again.page.evaluate((c) => localStorage.getItem(`game:${c}:team`), CODE) ?? "{}");
  if (stored.id !== map["FV-08"].id) s16.push("same-name join made a new team");
  if (Object.keys(await scores()).length !== 12) s16.push("team count changed");
  expect("S16", s16.length === 0, s16.join(", "));

  // S17 — kick
  const k = await rest("DELETE", `/games/${CODE}/teams/${map["FV-06"].id}`, null, TOKEN);
  const redirected = await teams["FV-06"].page.waitForURL(/soundclash\.org\/?$/, { timeout: 8000 }).then(() => true, () => false);
  await click("score-bonus"); const n17 = await picker.count(); await host.page.keyboard.press("Escape");
  expect("S17", k.status === 204 && redirected && n17 === 11 && (await display.page.getByText("FV-06").count()) === 0, `status=${k.status} redirected=${redirected} picker=${n17}`);
  delete teams["FV-06"];

  // S18 — extend, late joiner, race with a new phone
  const exp0 = (await get(`active_games?game_code=eq.${CODE}&select=expires_at`))[0].expires_at;
  await rpc("extend_game", { p_game_code: CODE, p_manager_token: TOKEN });
  const exp1 = (await get(`active_games?game_code=eq.${CODE}&select=expires_at`))[0].expires_at;
  const late = await rest("POST", `/games/${CODE}/teams`, { name: "FV-13" });
  const t13 = await openTeamTab("FV-13", late.id);
  await sleep(1500);
  const more = (await display.page.getByTestId("more-teams").textContent())?.trim();
  const ok18 = await next(); await buzz(t13); const w13 = await waitTone(t13, "winner");
  await click("score-wrong");
  expect("S18", exp1 > exp0 && (await host.page.getByTestId("expiry-banner").count()) === 0 && more === "+7 more teams playing" && ok18 && w13, `exp ${exp0}→${exp1} more='${more}' round=${ok18} win=${w13}`);

  // S19 — no-buzz skip, then the latency probe
  before = await scores(); const ok19 = await next(); const same = JSON.stringify(await scores()) === JSON.stringify(before);
  await next();
  const p1 = teams["FV-01"].page;
  const reqP = p1.waitForRequest(/buzz_in/);
  const t0 = await p1.evaluate(() => { const b = document.querySelector('[data-testid="buzz"]'); window.__tPending = null; new MutationObserver(() => { if (b.dataset.tone === "pending" && window.__tPending == null) window.__tPending = performance.now(); }).observe(b, { attributes: true, attributeFilter: ["data-tone"] }); const t = performance.now(); b.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, pointerId: 1, pointerType: "touch" })); return { t, origin: performance.timeOrigin }; });
  const req = await reqP; const res = await req.response(); const timing = req.timing();
  const pending = await p1.evaluate(() => window.__tPending);
  const toPending = pending == null ? null : pending - t0.t;
  const toRequest = timing.startTime - (t0.origin + t0.t);
  const rtt = timing.responseEnd;
  console.log(`LATENCY pointerdown→pending ${toPending?.toFixed(1)} ms; pointerdown→buzz_in request ${toRequest.toFixed(1)} ms; buzz_in rtt ${rtt.toFixed(0)} ms; status ${res?.status()}`);
  await waitTone(teams["FV-01"], "winner"); await click("score-wrong");
  expect("S19", ok19 && same && toPending != null && toPending < 16 && toRequest < 5, `skip=${ok19} scoresSame=${same} pending=${toPending} request=${toRequest}`);

  // S20 — end game
  await host.page.getByTestId("end-game").click();
  const dlg = host.page.getByRole("dialog");
  const undone = await dlg.getByText("This cannot be undone.").isVisible({ timeout: 5000 }).catch(() => false);
  await dlg.getByRole("button", { name: /^end game$/i }).click();
  await sleep(2500);
  const s20 = [];
  if (!undone) s20.push("dialog copy");
  for (const r of [host, display, ...Object.values(teams)]) {
    if (!(await r.page.getByRole("heading", { name: /final results/i }).isVisible({ timeout: 10000 }).catch(() => false))) s20.push(`${r.name} heading`);
    if ((await r.page.getByText("WINNER", { exact: true }).count()) < 1) s20.push(`${r.name} WINNER`);
  }
  for (const id of ["export-download", "export-playlist"]) if ((await host.page.getByTestId(id).count()) !== 1) s20.push(id);
  if ((await teams["FV-01"].page.getByTestId("final-scoreboard").count()) !== 1) s20.push("phone final-scoreboard");
  if (!/and \d+ more teams/.test((await teams["FV-01"].page.getByTestId("final-scoreboard-more").textContent().catch(() => "")) ?? "")) s20.push("phone final-scoreboard-more");
  if ((await get(`active_games?game_code=eq.${CODE}&select=status`))[0]?.status !== "ended") s20.push("db status");
  const lateJoin = await newRole("late-join", pw.devices["iPhone 12"]);
  await lateJoin.page.goto(`${BASE}/join/${CODE}`); await lateJoin.page.getByLabel(/team name/i).fill("Late"); await lateJoin.page.getByRole("button", { name: /join game/i }).click();
  if (!(await lateJoin.page.getByText(/already ended/i).isVisible({ timeout: 8000 }).catch(() => false))) s20.push("join after end");
  expect("S20", s20.length === 0, s20.join(", "));
  await shot(host, "ended"); await shot(display, "ended"); await shot(teams["FV-01"], "ended");
  await audit(host, "ended", { profile: "hot" }); await audit(display, "ended", { profile: "display" }); await audit(teams["FV-01"], "ended", { profile: "hot", phone: true });
} catch (e) {
  fail("SCRIPT", `${e.message}\n${e.stack}`);
} finally {
  if (CODE && TOKEN) await rest("POST", `/games/${CODE}/end`, null, TOKEN).catch(() => {});
  for (const c of caps) console.log(captureSummary(c));
  console.log(results.join("\n"));
  console.log(`FINAL SCORES ${JSON.stringify(CODE ? await scores().catch(() => ({})) : {})}`);
  await browser.close();
  process.exit(fails ? 1 : 0);
}
```

## Appendix E — `scratchpad/audit-lib.mjs` (shared by B and D)

Exports: `loadPlaywright()`, `attachCapture(page, role)`, `captureSummary(cap)`, `auditPage(page, opts)`, `tabWalk(page)`, `fitConsole(page)`, `fitDisplay(page, teamCount)`. `auditPage` options: `profile` = `"hot"` (Team, Console), `"display"`, or `"default"`; `phone` = true on phone viewports (tap targets); `expectBoard` = true when the Display board (not the podium) is on screen. It returns `{ violations: string[], infinite: number }` — `infinite` is the count of running infinite animations (the Team page during `playing` must report exactly 1).

```js
// audit-lib.mjs — machine checks for 01 (tokens, fonts, banned list), 04 (animated properties), 06 (a11y, fit), 02 §4 (Display markup)
import { createRequire } from "node:module";
export function loadPlaywright() {
  const req = createRequire("C:/Users/yulin/GBA/Sound-Clash/tests/e2e/package.json");
  return req("@playwright/test"); // { chromium, firefox, webkit, devices }
}

export function attachCapture(page, role) {
  const cap = { role, errors: [], csp: [], failed: [], fontHeaders: [] };
  page.on("console", (m) => {
    const t = m.text();
    if (/compute-pressure/i.test(t)) return; // YouTube third-party noise (§0.5)
    if (/Refused|Content Security Policy|CSP|violat/i.test(t)) cap.csp.push(t);
    else if (m.type() === "error") cap.errors.push(t);
  });
  page.on("pageerror", (e) => cap.errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => { if (!/youtube|ytimg|googlevideo|sentry|faro|grafana/.test(r.url())) cap.failed.push(`${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (/\/fonts\//.test(r.url())) cap.fontHeaders.push(`${r.url().split("/").pop()} ${r.status()} ${r.headers()["cache-control"] ?? "(no cache-control)"}`); });
  return cap;
}
export const captureSummary = (c) =>
  `CONSOLE ${c.role}: errors=${c.errors.length} csp=${c.csp.length} failed=${c.failed.length}` +
  (c.errors.length + c.csp.length + c.failed.length ? "\n  " + [...c.errors, ...c.csp, ...c.failed].join("\n  ") : "") +
  (c.fontHeaders.length ? "\n  fonts: " + c.fontHeaders.join(" | ") : "");

const IN_PAGE = ({ profile, phone, expectBoard }) => {
  const v = [];
  const cs = (el, p) => getComputedStyle(el, p);
  const root = cs(document.documentElement);
  const want = { "--bg": "#000000", "--surface": "#121111", "--accent": "#FF7A00", "--accent-ink": "#000000", "--bone": "#E9E4D9", "--text-muted": "#B4A88F", "--positive": "#4ADE80", "--negative": "#F2352B", "--warning": "#F6CC00" };
  for (const [k, val] of Object.entries(want)) { const got = root.getPropertyValue(k).trim(); if (got.toUpperCase() !== val) v.push(`tokens: ${k}='${got}' want ${val}`); }
  if (cs(document.body).backgroundColor !== "rgb(0, 0, 0)") v.push(`tokens: body background ${cs(document.body).backgroundColor}`);
  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.getAttribute("content") ?? "";
  if (meta("color-scheme") !== "dark") v.push(`tokens: meta color-scheme '${meta("color-scheme")}'`);
  if (meta("theme-color").toLowerCase() !== "#000000") v.push(`tokens: meta theme-color '${meta("theme-color")}'`);

  const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/"/g, ""), status: f.status }));
  for (const fam of ["Anton", "Instrument Sans"]) {
    const hit = faces.filter((f) => f.family === fam);
    if (!hit.length) v.push(`fonts: no @font-face for ${fam}`);
    else if (!hit.some((f) => f.status === "loaded")) v.push(`fonts: ${fam} ${hit.map((f) => f.status).join(",")}`);
  }
  const isFam = (el, fam) => new RegExp(`^"?${fam}"?`).test(cs(el).fontFamily);
  if (!isFam(document.body, "Instrument Sans")) v.push(`fonts: body font-family ${cs(document.body).fontFamily}`);
  for (const h of document.querySelectorAll("h1, h2")) if (!isFam(h, "Anton")) v.push(`fonts: ${h.tagName} '${h.textContent.trim().slice(0, 30)}' font-family ${cs(h).fontFamily}`);
  const buzz = document.querySelector('[data-testid="buzz"]');
  if (buzz && !isFam(buzz, "Anton")) v.push(`fonts: BUZZ font-family ${cs(buzz).fontFamily}`);

  const emoji = document.body.innerText.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{2605}]/gu);
  if (emoji) v.push(`emoji: ${[...new Set(emoji)].join(" ")}`);

  const desc = (el) => `${el.tagName.toLowerCase()}${el.dataset?.testid ? `[data-testid=${el.dataset.testid}]` : ""}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}`;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = cs(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const gradientAllowed = (el) => el.matches('input[maxlength="6"]') || !!el.closest('[class*="podium"], [class*="winner"], [class*="Winner"]');
  for (const el of document.querySelectorAll("body *")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const s = cs(el, pseudo);
      if (s.backgroundImage.includes("gradient") && !gradientAllowed(el)) v.push(`gradients: ${desc(el)}${pseudo ?? ""}`);
      if (pseudo) continue;
      if (s.backdropFilter && s.backdropFilter !== "none") v.push(`backdrop-filter: ${desc(el)}`);
      if (s.transitionDuration.split(",").some((d) => parseFloat(d) > 0) && s.transitionProperty.split(",").map((x) => x.trim()).includes("all")) v.push(`transition-all: ${desc(el)}`);
      if (s.boxShadow !== "none" && !el.closest('[role="dialog"], [aria-label="Notifications"]')) v.push(`resting-shadow: ${desc(el)}`);
    }
  }

  const okProps = new Set(["transform", "opacity", "filter", "clipPath", "clip-path", "visibility"]);
  const softProps = new Set(["backgroundColor", "background-color", "borderColor", "border-color", "color", "outlineColor", "outline-color", "strokeDashoffset", "stroke-dashoffset"]);
  let infinite = 0;
  for (const a of document.getAnimations()) {
    const t = a.effect?.target;
    const props = new Set((a.effect?.getKeyframes?.() ?? []).flatMap((k) => Object.keys(k).filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p))));
    for (const p of props) {
      if (okProps.has(p)) continue;
      if (profile !== "hot" && softProps.has(p)) continue;
      v.push(`animations: '${p}' on ${t ? desc(t) : "?"}${a.effect?.pseudoElement ?? ""}`);
    }
    if (a.effect?.getTiming?.().iterations === Infinity) infinite++;
  }

  for (const el of document.querySelectorAll('button, a, [role="button"]')) {
    if (!visible(el)) continue;
    const th = cs(el).getPropertyValue("-webkit-tap-highlight-color").trim();
    if (th && th !== "rgba(0, 0, 0, 0)") v.push(`hover-touch: tap-highlight ${th} on ${desc(el)}`);
  }
  for (const el of document.querySelectorAll("[aria-pressed]")) if (cs(el).touchAction !== "manipulation") v.push(`hover-touch: touch-action '${cs(el).touchAction}' on ${desc(el)}`);

  if (phone) {
    for (const el of document.querySelectorAll('button, input, select, [role="button"], a')) {
      if (!visible(el) || (el.tagName === "A" && cs(el).display === "inline")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) v.push(`tap-targets: ${Math.round(r.width)}×${Math.round(r.height)} ${desc(el)}`);
    }
  }

  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = "1"] = m[1].split(",").map((x) => parseFloat(x)); return { r, g, b, a: isNaN(a) ? 1 : a }; };
  const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const effectiveBg = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(cs(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let out = { r: 0, g: 0, b: 0 };
    for (const c of layers.reverse()) out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
    return out;
  };
  const dimmed = (el) => { for (let e = el; e; e = e.parentElement) { if (e.disabled || e.getAttribute("aria-disabled") === "true" || parseFloat(cs(e).opacity) < 1) return true; } return false; };
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el) || dimmed(el) || !el.closest("body")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = cs(el); const fg = parse(s.color); if (!fg) continue;
    const ratio = (Math.max(lum(fg), lum(effectiveBg(el))) + 0.05) / (Math.min(lum(fg), lum(effectiveBg(el))) + 0.05);
    const size = parseFloat(s.fontSize); const bold = parseInt(s.fontWeight, 10) >= 700;
    let min = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (profile === "display" && el.matches("li[data-team-id] > span")) min = 7;
    if (ratio < min) v.push(`contrast: ${ratio.toFixed(2)}:1 (min ${min}) '${el.textContent.trim().slice(0, 24)}' ${desc(el)}`);
  }

  if (profile === "display" && expectBoard) {
    if (!document.querySelector('main[data-density="normal"]')) v.push("display-contract: main[data-density=normal] missing");
    if (!document.querySelector('ol[style*="--rows"]')) v.push("display-contract: ol[style*=--rows] missing");
    for (const li of document.querySelectorAll("li[data-team-id]")) {
      if (!li.dataset.rank) v.push(`display-contract: li without data-rank (${li.dataset.teamId})`);
      if (li.children.length !== 3 || [...li.children].some((c) => c.tagName !== "SPAN")) v.push(`display-contract: row ${li.dataset.teamId} has ${li.children.length} children, want exactly 3 spans`);
    }
    if (document.body.innerText.includes("???")) v.push("display-contract: literal ??? placeholder still rendered (decision 8)");
  }
  return { violations: v, infinite };
};

export async function auditPage(page, opts = {}) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400); // let entrance animations start and toasts settle
  return page.evaluate(IN_PAGE, { profile: opts.profile ?? "default", phone: !!opts.phone, expectBoard: !!opts.expectBoard });
}

export async function tabWalk(page, max = 40) {
  const v = []; const seen = new Set();
  await page.evaluate(() => { document.body.focus?.(); window.scrollTo(0, 0); });
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return null; const s = getComputedStyle(el); return { key: (el.dataset.testid || el.id || el.textContent.trim().slice(0, 20)) + el.tagName, style: s.outlineStyle, width: parseFloat(s.outlineWidth), desc: el.tagName.toLowerCase() + (el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : "") }; });
    if (!r || seen.has(r.key)) break;
    seen.add(r.key);
    if (r.style === "none" || r.width < 2) v.push(`focus-ring: ${r.desc} outline ${r.style} ${r.width}px`);
  }
  return v;
}

export const fitConsole = (page) => page.evaluate(() => {
  window.scrollTo(0, 0);
  const v = []; const H = innerHeight;
  for (const id of ["score-title", "score-artist", "score-wrong", "score-bonus", "score-soundtrack", "continue-round", "start-round", "end-game"]) {
    const el = document.querySelector(`[data-testid="${id}"]`); if (!el) continue;
    const b = el.getBoundingClientRect().bottom; if (b > H) v.push(`fit-console: ${id} bottom ${Math.round(b)} > ${H}`);
  }
  if (document.documentElement.scrollHeight > H + 1) v.push(`fit-console: page scrolls (${document.documentElement.scrollHeight} > ${H})`);
  return v;
});

export const fitDisplay = (page, teamCount) => page.evaluate((n) => {
  const v = []; const H = innerHeight;
  if (document.documentElement.scrollHeight > H + 2) v.push(`fit-display: page scrolls (${document.documentElement.scrollHeight} > ${H})`);
  const rows = document.querySelectorAll("li[data-team-id]").length;
  if (rows !== Math.min(n, 5)) v.push(`fit-display: ${rows} rows for ${n} teams (want ${Math.min(n, 5)})`);
  const more = document.querySelector('[data-testid="more-teams"]');
  if (n > 5 && !more) v.push("fit-display: more-teams hint missing");
  if (n <= 5 && more) v.push("fit-display: more-teams hint present with ≤ 5 teams");
  if (n > 5 && more && more.textContent.trim() !== `+${n - 5} more team${n - 5 === 1 ? "" : "s"} playing`) v.push(`fit-display: more-teams text '${more.textContent.trim()}'`);
  for (const li of document.querySelectorAll("li[data-team-id]")) { const r = li.getBoundingClientRect(); if (r.top < -1 || r.bottom > H + 1) v.push(`fit-display: row ${li.dataset.teamId} outside viewport`); }
  return v;
}, teamCount);
```
