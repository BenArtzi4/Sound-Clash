# Backend (FastAPI) tests

Tests for FastAPI routes; admin auth, game lifecycle, song CRUD, rate limits, validation.

Each test runs against an in-process FastAPI app, with a testcontainer Postgres + applied migrations as the DB. `httpx.AsyncClient` is used to call routes.

**Phase 4 deliverable.** Phase 1 contains only a smoke test.

## Planned test files

See [`docs/testing-strategy.md`](../../docs/testing-strategy.md) §4.2.

## Running

```bash
cd backend
pytest ../tests/backend
pytest ../tests/backend -k test_admin_auth   # subset
```

## Conventions

- One file per router (`test_games_router.py`, `test_admin_songs.py`, etc.) plus cross-cutting (`test_admin_auth.py`, `test_rate_limits.py`).
- Use the `app_with_db` fixture (added in Phase 4): gives you a configured TestClient.
- Test the auth gate on every protected endpoint (lazy way: parametrized fixture).
- For validation, test edge-of-spec values (max-length team name, empty genres, etc.), not just happy path.
