# Sound Clash: Tooling & Automation Guide

This is the guide to every tool that touches the repo or the development workflow. The runtime services that the live game depends on (Supabase, Render, Cloudflare Pages) are documented in [`tech-stack.md`](tech-stack.md). This file covers everything *else*: CI workflows, code health, dependency bots, coverage, deploy automation, monitoring, and what runs on every PR.

---

## 1. What runs on every PR

Quick reference: the checks that fire when a PR is opened against `main`.

| Check | Source | Required to merge? | What it does |
|---|---|---|---|
| **Backend / lint + type + test** | `.github/workflows/backend.yml` | Yes (when `backend/` changes) | ruff check + format, mypy, pytest with branch coverage, `--cov-fail-under=90` |
| **Frontend / lint + type + test** | `.github/workflows/frontend.yml` | Yes (when `frontend/` changes) | eslint, prettier, tsc, vitest with coverage, `npm run build`, service-role-leak check |
| **CodeQL** | GitHub Default Setup | Advisory | Static analysis for security issues (JS/TS + Python) |
| **Codecov / patch + project** | `codecov/codecov-action@v6` upload from CI | Advisory | Comments coverage delta on the PR |
| **E2E / Playwright** | `.github/workflows/e2e.yml` | No (label-gated: `run-e2e`) | Playwright multi-context against `Sound-Clash-Preview` Supabase |
| **Buzz race stress (100×)** | `e2e.yml` second job | No (label-gated: `run-stress`) | Race-test stress loop against an ephemeral Postgres service |
| **DB Migrate** | `.github/workflows/db-migrate.yml` | Manual dispatch only | Applies migrations to chosen env; never auto-fires |

Branch protection enforces the two "Yes" rows; details in [§10](#10-branch-protection).

---

## 2. GitHub Actions workflows

Four workflow files under `.github/workflows/`. Each is path-filtered so it only runs when its area changes.

### 2.1 `backend.yml`

**Triggers**: push to `main` or PR with changes under `backend/**`, `tests/backend/**`, `tests/db/**`, or the workflow file itself. Also `workflow_dispatch` for manual reruns.

**Job: `test`**
1. Checkout
2. Set up Python 3.11 with pip cache keyed on `backend/pyproject.toml`
3. `pip install -e ".[dev]"` (the `[dev]` extras pull in pytest, ruff, mypy, etc.)
4. `ruff check .`
5. `ruff format --check .`
6. `mypy app` (strict mode, configured in `pyproject.toml`)
7. Reject `# pragma: no cover` in `app/` (banned per `testing-strategy.md` §2)
8. `pytest --cov=app --cov-branch --cov-report=xml --cov-report=term-missing --cov-fail-under=90`
9. Upload `coverage.xml` to Codecov (with `flags: backend`, `continue-on-error: true`)

**Job: `deploy` (main only)**

Runs after `test` succeeds, only on push to `main`. `curl -fsSL -X POST $RENDER_DEPLOY_HOOK` triggers the Render redeploy. If the secret isn't set the step prints a warning and exits 0 (handy for forks).

**Failure modes**:
- `ruff format --check` failure → run `ruff format .` locally
- `mypy` failure → strict mode is on; add types or guard with `cast`
- `--cov-fail-under=90` drop → add tests; never lower the threshold
- Render hook returns non-200 → check Render dashboard; usually a Docker build issue

### 2.2 `frontend.yml`

**Triggers**: push to `main` or PR with changes under `frontend/**` or the workflow file.

**Job: `test`**
1. Checkout
2. Set up Node 22 (npm cache disabled; see comment in the file about the unpinned `package-lock.json`)
3. `npm ci` (or `npm install --no-audit --no-fund` if no lockfile)
4. `npm run lint` (ESLint)
5. `npm run format:check` (Prettier)
6. `npm run typecheck` (`tsc --noEmit`)
7. Reject skipped tests (`it.skip`, `test.skip`, `xfail` outside generated code)
8. `npm run test:coverage` (vitest)
9. `npm run build` and grep `dist/` for `SUPABASE_SERVICE_ROLE`: fails the build if found
10. Upload `coverage/lcov.info` to Codecov (with `flags: frontend`)

**Job: `deploy` (main only)**

`npx wrangler@latest pages deploy dist --project-name=sound-clash --branch=main` using `CF_API_TOKEN` + `CF_ACCOUNT_ID`.

### 2.3 `e2e.yml`

**Triggers**: push to `main`, `workflow_dispatch`, **or** a PR labelled `run-e2e`. Label-gating keeps PR feedback fast since this job is heavy (~10–15 min).

**Job: `e2e`**
1. Checkout
2. Set up Node 20 + Python 3.11
3. Install backend + frontend + Playwright deps
4. `npx playwright install --with-deps chromium`
5. Run the suite against the **preview** Supabase project using `SUPABASE_PREVIEW_*` secrets

The frontend gets `VITE_API_URL=http://localhost:8000` and the spec helpers get `API_URL=http://localhost:8000`; the test fixtures spin up the FastAPI dev server inline.

**Job: `buzz_race_stress` (label-gated: `run-stress`)**

Heavy stress test; boots a Postgres 15 container as a workflow service, then runs `pytest -x -m stress ../tests/db/test_buzz_in_race.py` 100 times in a row, exiting on first failure. This is the Phase-3 race-correctness gate, kept around as the canary for any future change that touches `buzz_in`.

### 2.4 `db-migrate.yml`

**Triggers**: `workflow_dispatch` only. Two inputs:
- `target`: `preview` or `prod` (binds the `environment:` for env-secret resolution)
- `confirm`: must be the literal string `MIGRATE` or the job is gated out

**Steps**:
1. Install `postgresql-client` (`psql`)
2. Apply migrations via `./db/migrate.sh "$DATABASE_URL"`
3. **Re-apply** the same migrations to verify idempotency

Migrations are never auto-applied. The deploy playbook is in [`runbook.md`](runbook.md) §1.3.

---

## 3. Dependabot

Configured in `.github/dependabot.yml`. Five package ecosystems, all on a weekly Monday schedule:

| Ecosystem | Directory | Open-PR cap | Grouping | Labels |
|---|---|---|---|---|
| `github-actions` | `/` | 5 | – | `dependencies`, `ci` |
| `pip` | `/backend` | 5 | minor + patch grouped | `dependencies`, `backend` |
| `npm` | `/frontend` | 5 | minor + patch grouped | `dependencies`, `frontend` |
| `npm` | `/tests/e2e` | 3 | – | `dependencies`, `tests` |
| `docker` | `/backend` | 3 | – | `dependencies`, `docker` |

**Commit message prefixes**: `deps` for prod, `deps-dev` for dev deps, `ci` for actions bumps. Scope is included.

**How to interact with a Dependabot PR**:
- Status green + diff is patch/minor → review the diff, merge if it looks safe
- Major bump → read the upstream changelog before merging
- `@dependabot rebase`: re-sync against latest `main`
- `@dependabot ignore this minor version`: skip a single version
- `@dependabot ignore this dependency`: stop opening PRs for this dep entirely

Project rule: **flag any new dependency before installing it** (keep the project lean). Dependabot only bumps existing deps, so it never violates the rule; but reviewing its PRs is a good moment to spot transitive growth.

---

## 4. CodeQL

GitHub's static-analysis security scanner. We use **Default Setup** (Settings → Code security and analysis), not a workflow file. Default Setup runs on PR + push to `main` + a weekly schedule, with no maintenance burden.

The advanced workflow (`.github/workflows/codeql.yml`) was removed in commit `9956027` once Default Setup proved equivalent for the languages we use.

**Languages scanned**: JavaScript/TypeScript (frontend), Python (backend).

**Findings appear**:
- As PR review comments on the offending lines
- In the Security tab → "Code scanning alerts"

**Triage**:
- Real bug → fix it
- False positive → dismiss with reason via the Security tab
- In-code suppression: `// codeql[<rule-id>]` annotation; use sparingly and document why

CodeQL is advisory in branch protection; it can't block a merge; but a finding should never be ignored without justification.

---

## 5. Codecov

Coverage reporting service. The `coverage.xml` (backend) and `lcov.info` (frontend) files uploaded by the workflows are consumed by Codecov, which:

- Posts a coverage comment on every PR (delta vs `main`, line + branch)
- Maintains the `[![Coverage]](…)` badge in the root `README.md`
- Tracks coverage trends over time on the project dashboard

**Token**: `CODECOV_TOKEN` GitHub repo secret (single token for the repo).

**Flags**: backend uploads use `flags: backend`, frontend uses `flags: frontend`. This lets the dashboard show per-area coverage.

There is no `codecov.yml` config file; defaults are fine. The Codecov comment is **advisory**: coverage drops are reported but not enforced as a hard block. The actual hard gate lives in `pyproject.toml` (`--cov-fail-under=90`); see [`testing-strategy.md`](testing-strategy.md) §5 for ratchet plan.

---

## 6. Pre-commit hooks

Local hooks defined in `.pre-commit-config.yaml`. They run on `git commit` once installed.

**Install once per clone**:
```
pip install pre-commit
pre-commit install
```

**What runs**:

| Hook | Source | What it catches |
|---|---|---|
| `trailing-whitespace`, `end-of-file-fixer`, `mixed-line-ending` | `pre-commit-hooks` | Whitespace and EOL hygiene |
| `check-yaml`, `check-json`, `check-merge-conflict` | `pre-commit-hooks` | Syntax + leftover conflict markers |
| `check-added-large-files` (500 KB) | `pre-commit-hooks` | Accidental binary check-ins |
| `detect-private-key` | `pre-commit-hooks` | SSH/PGP keys |
| `ruff --fix`, `ruff-format` | `astral-sh/ruff-pre-commit` | Lint + format for `backend/**` |
| `no-jwt-leak` | local pygrep | Strings starting `eyJhbGciOi` (Supabase JWT prefix) |
| `no-skip-tests` | local pygrep | `it.skip`, `test.skip`, `xfail` outside generated code |
| `no-pragma-no-cover` | local pygrep | `# pragma: no cover` under `backend/app/` |

Project rule: **bypassing a hook with `--no-verify` is not allowed**: fix the underlying issue.

---

## 7. Deploy automation

### 7.1 Backend → Render

Triggered by the `deploy` job in `backend.yml` on push to `main`. The job curls a webhook URL stored in the `RENDER_DEPLOY_HOOK` secret. Render then:

1. Pulls `main`
2. Builds the Docker image (multi-stage, non-root user)
3. Health-checks `/health` (expects 200)
4. Swaps traffic if green; rolls back if not

**Cold-start budget after a deploy**: ~30s for the first request. The cron-job.org keepalive masks this in practice.

### 7.2 Frontend → Cloudflare Pages

`frontend.yml` calls `npx wrangler@latest pages deploy dist --project-name=sound-clash --branch=main` on push to `main`. Wrangler authenticates via `CF_API_TOKEN` and `CF_ACCOUNT_ID`.

Pages serves from:
- `https://sound-clash.pages.dev` (Cloudflare-issued)
- `https://www.soundclash.org` (custom domain)

The apex `soundclash.org` is a 301 redirect to `www.` (Cloudflare Page Rule).

### 7.3 Database (manual)

`db-migrate.yml` is the **one production write that requires human intervention**. Migrations are not auto-applied on push; you dispatch the workflow with the target env (`preview` or `prod`) and the confirmation string `MIGRATE`. See [`runbook.md`](runbook.md) §1.3 for the deploy-with-migration playbook.

---

## 8. Monitoring & observability

### 8.1 Sentry

Two projects:

| Project | Init location | Sample rate | PII |
|---|---|---|---|
| `sound-clash-frontend` | `frontend/src/main.tsx` | `tracesSampleRate: 0` | default scrubbing |
| `sound-clash-backend` | `backend/app/middleware/sentry.py` | `traces_sample_rate: 0.0` | `send_default_pii=False` |

Both projects are skipped when their DSN env var is empty (so `pytest` runs and local dev without DSNs don't ship junk events). The backend init also skips if `PYTEST_CURRENT_TEST` is set.

**Alerts**: workspace-default "new issue" email on both projects.

**DSNs** are GitHub repo secrets (`SENTRY_DSN_FRONTEND`, `SENTRY_DSN_BACKEND`) and also baked into the Render env / Cloudflare Pages env so the deployed builds have them.

### 8.2 Render keepalive: cron-job.org

The Render free tier sleeps after 15 min of idle. cron-job.org pings `https://api.soundclash.org/health` every 14 min to keep the worker warm.

Account credentials are kept out of the repo; see your password manager.

If the keepalive stops (cron-job.org outage, account locked), the symptom is a 30s wait on the first game-creation after an idle period. The buzzer is unaffected because it doesn't go through Render.

### 8.3 Supabase quota alerts

Configured in the Supabase dashboard under each project's settings. Email thresholds match `free-tier-budget.md` §4 (DB size 80%, egress 80%, Realtime msgs 80%).

---

## 9. PR-check timing

Approximate order in which checks complete on a typical PR:

1. **Pre-commit**: runs locally before the commit lands (sub-second)
2. **CodeQL**: completes ~2–5 min after push
3. **Backend / Frontend** workflows; complete ~3–7 min
4. **Codecov comment**: appears once the workflows have uploaded
5. **E2E** (only if labelled `run-e2e`): 10–15 min
6. **Stress** (only if labelled `run-stress`): up to 30 min

If a PR sits without checks running, the most likely cause is path filtering; the PR didn't change any file under the workflow's `paths:` filter. Force a run with `workflow_dispatch` or a no-op file touch.

---

## 10. Branch protection

Configured on `main`:

- Require pull request before merging
- Require status checks to pass: `Backend / lint + type + test`, `Frontend / lint + type + test`
- Require branches to be up to date before merging
- Do not allow force pushes
- Do not allow deletions

E2E, CodeQL, and Codecov are **not** required checks; they're advisory. Adding them as required checks is a one-line settings change but would block merges when the preview Supabase is being maintained.

Project rule: **changing branch protection requires explicit user approval**: automation tools should not modify it autonomously.

---

## 11. Cheat sheet

```sh
# Run the same checks CI does, locally:

# Backend
cd backend
ruff check .
ruff format --check .
mypy app
pytest --cov=app --cov-branch --cov-fail-under=90

# Frontend
cd frontend
npm run lint
npm run format:check
npm run typecheck
npm run test:coverage
npm run build

# E2E (against local stack)
cd tests/e2e
npm test
```

For the secrets you need locally, see [`local-development.md`](local-development.md) §4.
