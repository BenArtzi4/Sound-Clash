# Contributing to Sound Clash

Thanks for your interest. This is a small project; the contribution bar is "is it correct, tested, and consistent with the docs."

## Before you start

1. Read [`docs/architecture.md`](docs/architecture.md) (one page).
2. Skim [`docs/roadmap.md`](docs/roadmap.md) to know what phase the project is in.
3. Check [open issues](https://github.com/BenArtzi4/Sound-Clash/issues): pick one or open a new one to discuss before doing significant work.
4. For substantive changes, open the issue first. Code without a discussed direction may be closed without merge.

## Local setup

See [`docs/local-development.md`](docs/local-development.md). TL;DR: `supabase start`, `pip install -e backend[dev]`, `npm install` in frontend.

## Branching

- Main branch: `main` (protected; PRs only).
- Branch naming: `<type>/<short-desc>` where `<type>` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`. Examples: `feat/team-kick-button`, `fix/buzzer-race-on-reconnect`.
- Keep branches short-lived. Rebase rather than merge from `main` if your branch falls behind.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/) format: `<type>(<scope>): <subject>`.
- Examples:
  - `feat(buzzer): add server-time skew correction`
  - `fix(rls): tighten anon SELECT policy on game_teams`
  - `docs(runbook): add Sentry alert thresholds`
- Subject line < 72 chars. Imperative mood ("add", not "added").
- Body explains *why*, not *what* (the diff shows what).

## Pull requests

1. Open against `main`.
2. Fill in the PR template (auto-loaded from `.github/pull_request_template.md`).
3. CI must be green: `backend.yml`, `frontend.yml`, and `e2e.yml` (if labeled `run-e2e`).
4. While the project has a single maintainer, PRs don't require an approving review, but `main` is branch-protected: every change must go through a PR (direct pushes are blocked, including for the maintainer), conversations must be resolved, and force-pushes / deletions are denied.
5. Squash-merge by default. Merge commits only for substantial multi-commit features where individual commits matter.

## Code style

### Backend (Python)

- **Formatter**: `ruff format`
- **Linter**: `ruff check`
- **Type checker**: `mypy app/`
- **Tests**: `pytest`
- All four must pass locally before pushing. Pre-commit hook enforces formatter + linter on commit.

Conventions:
- Type hints on all public functions.
- No `print()`; use the `logging` module.
- No catch-all `except Exception` unless you re-raise or log + re-raise.
- Imports sorted by ruff (isort-compatible).
- Module docstrings only when non-obvious.

### Frontend (TypeScript)

- **Formatter**: `prettier`
- **Linter**: `eslint`
- **Type check**: `tsc --noEmit`
- **Tests**: `vitest run`

Conventions:
- Strict mode TypeScript; no `any` without a `// reason` comment.
- Functional components + hooks; no class components.
- Co-locate component tests next to the component (`Foo.tsx` + `Foo.test.tsx`).
- No CSS-in-JS dependencies; use plain CSS modules.
- No state management library (Redux, Zustand, etc.); local React state and Supabase Realtime are sufficient.

### SQL (migrations)

- One purpose per migration file. Use the numeric prefix to enforce order.
- All migrations idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, etc.
- DDL changes that affect callers require a corresponding code change in the same PR.
- `psql -f` must succeed against an empty Postgres 15 instance with `pg_cron` and `pgcrypto` extensions.

## Testing requirements

| Change | Required tests |
|---|---|
| New REST endpoint | `tests/backend/`: happy path + auth + at least one validation case |
| New PL/pgSQL function | `tests/db/`: happy path + at least one error case |
| New React component with logic | `tests/` co-located: at least one render + one interaction test |
| Buzzer-related change | A relevant `tests/e2e/` Playwright scenario |
| Migration | Re-run `db/migrate.sh` from a clean DB; commit only if successful |
| Bug fix | A regression test that fails on `main` and passes on your branch |

Coverage isn't gated, but PRs that *reduce* coverage will get a polite poke.

## Documentation

If your change touches anything covered by `docs/`, **update the doc in the same PR**. Out-of-date docs are worse than missing ones.

Specifically:
- New endpoint → update `docs/api-contracts.md`
- New table or column → update `docs/data-model.md`
- New PL/pgSQL function → update `docs/rpc-functions.md`
- New env var or secret → update `docs/runbook.md` and `docs/local-development.md`
- New gameplay rule → update `docs/game-rules.md`

## What we don't merge

- Changes that re-introduce dropped features (see `docs/data-model.md` §9: `play_count`, `is_active`, AI selection cache, etc.) without a discussed plan.
- Changes that put Python in the buzzer hot path. The `<200ms` requirement is structural; see `docs/realtime-design.md` §2.
- Changes that increase free-tier consumption substantially without an alert or upgrade plan in `docs/free-tier-budget.md`.
- "Cleanup" PRs that mix refactoring with feature work. Split them.
- Code without tests when tests are the obvious medium for verification.
- Generated code or AI-completed code that the author can't explain on review.

## Reporting bugs

Use the **Bug report** issue template. Include:
- What you did
- What happened
- What you expected
- Browser + OS (for frontend), Python version (for backend)
- Logs / Sentry link if you have it

## Reporting security issues

**Don't open a public issue for security bugs.** Email the maintainer at `benartzi4@gmail.com` with `[SECURITY] Sound Clash` in the subject. We'll triage and disclose responsibly.

## License

By contributing, you agree your contribution is licensed under the MIT License (the project's license).
