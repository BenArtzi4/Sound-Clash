# Sound Clash — Local Development

How to run the system on your laptop. Read this before opening a code editor.

The local stack is intentionally minimal: a local Supabase instance, a Python venv, and `npm run dev`. No Docker required for routine work (Docker is only for the production-build verification step).

## 1. Prerequisites

| Tool | Min version | Install |
|---|---|---|
| Python | 3.11 | https://www.python.org/downloads/ |
| Node.js | 20 | https://nodejs.org/ |
| Supabase CLI | latest | https://supabase.com/docs/guides/cli/getting-started |
| Docker Desktop | latest | https://www.docker.com/products/docker-desktop |
| Git | any recent | https://git-scm.com/ |
| (optional) `gh` CLI | any | https://cli.github.com/ |
| (optional) `direnv` | any | for auto-loading `.env` |

Docker is only required because Supabase CLI uses it to spin up local Postgres + Realtime + PostgREST containers. You don't write Dockerfiles for daily dev.

### Windows note

The user runs Windows 11. Supabase CLI works on Windows but Docker Desktop must be running. Use **PowerShell 7+** (not Windows PowerShell 5) for the better terminal UX. WSL2 also works if you prefer.

## 2. Clone & Initial Setup

```bash
git clone https://github.com/BenArtzi4/Sound-Clash.git
cd Sound-Clash
```

```
Sound-Clash/
├── backend/               # FastAPI app
├── frontend/              # React + Vite SPA
├── db/
│   ├── migrations/        # SQL files, ordered by prefix
│   └── seed/              # genre seed data
├── tests/
│   ├── db/                # pytest + testcontainers
│   ├── backend/           # pytest + httpx
│   └── e2e/               # Playwright
├── scripts/               # one-off scripts (data import, etc.)
└── .github/workflows/     # CI
```

### Environment variables

Copy the templates:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Fill them in (see §4 for what each value should be in dev).

## 3. Start Local Supabase

From the repo root:

```bash
supabase init       # one-time; creates supabase/ config
supabase start      # spins up Docker containers
```

This launches:
- **Postgres** at `localhost:54322`
- **PostgREST API** at `http://localhost:54321`
- **Realtime** (WebSocket) at the same `localhost:54321`
- **Studio UI** at `http://localhost:54323`
- **Mailcatcher** for auth emails (unused in MVP) at `http://localhost:54324`

`supabase start` prints the local anon key, service-role key, and JWT secret. Copy these into your `.env` files.

To stop: `supabase stop`. To reset (wipe all data): `supabase db reset`.

### Apply migrations

Each migration file in `db/migrations/` runs automatically when you `supabase db reset`. Or apply them to a running instance:

```bash
./db/migrate.sh local    # uses local Supabase URL + service-role key
```

### Seed data

```bash
psql postgres://postgres:postgres@localhost:54322/postgres -f db/seed/genres.sql
python scripts/import-songs.py --target local --source data/songs.csv
```

(Once `data/songs.csv` is exported from the legacy AWS RDS — see Phase 2 of the roadmap.)

## 4. Environment Variable Templates

### Root `.env.example`
```
# Used by docker-compose, scripts
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=<from `supabase start` output>
SUPABASE_SERVICE_ROLE_KEY=<from `supabase start` output>
DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres
```

### `backend/.env.example`
```
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=<from `supabase start` output>
ADMIN_PASSWORD=devpass123
PORT=8000
CORS_ORIGINS=http://localhost:5173
LOG_LEVEL=DEBUG
```

### `frontend/.env.example`
```
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<from `supabase start` output>
VITE_API_URL=http://localhost:8000
VITE_ADMIN_PASSWORD=devpass123
```

(`VITE_ADMIN_PASSWORD` is dev-only convenience. In production the user types it.)

## 5. Run the Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate         # PowerShell: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

Hits `http://localhost:8000`. Auto-generated Swagger UI at `http://localhost:8000/docs`.

Verify:
```bash
curl http://localhost:8000/health
# {"status":"ok",...}
```

## 6. Run the Frontend

```bash
cd frontend
npm install
npm run dev
```

Hits `http://localhost:5173`. Vite hot-reloads on save.

## 7. End-to-End Local Test

With local Supabase + backend + frontend all running:

1. Open http://localhost:5173 → home screen.
2. Click "I'm a host" → enter `devpass123` → "Create game" → fill in genres → submit.
3. Note the 6-character game code.
4. Open a second browser tab → http://localhost:5173 → "I'm a team" → enter the code, team name → join.
5. Open a third tab → "I'm a display" → enter the code → join.
6. Back in tab 1 (host) → "Start game" → "Next song" → song info appears.
7. In tab 2 (team) → press "Buzz!".
8. All three tabs should show the lock state within ~100ms (local Supabase has near-zero latency).

If any step fails, check:
- Browser console for errors
- Backend uvicorn logs
- Supabase Studio (http://localhost:54323) → Logs

## 8. Run Tests

### Backend (pytest)

```bash
cd backend
pytest                              # all backend tests
pytest tests/backend -k "test_games"   # subset
pytest -x --pdb                     # stop on first fail, drop into debugger
```

The DB layer tests (`tests/db/`) use **testcontainers** — they spin up an ephemeral Postgres container per test session. Requires Docker running.

### Frontend (vitest)

```bash
cd frontend
npm test                            # watch mode
npm test -- --run                   # single run, exit
npm test -- --coverage              # coverage report
```

### E2E (Playwright)

```bash
cd tests/e2e
npm install                         # one-time
npx playwright install              # one-time, installs browsers
npm test                            # runs against the local stack
npm test -- --ui                    # interactive mode
npm test buzzer_race                # specific spec
```

E2E expects local backend + frontend + Supabase running.

## 9. Common Workflows

### Add a new song manually
```bash
psql $DATABASE_URL -c "
  INSERT INTO songs (title, artist, youtube_id, start_time)
  VALUES ('My Song', 'Artist', 'abc12345678', 0);
"
```

Or via the admin UI: http://localhost:5173/admin/songs (login with `devpass123`).

### Add a new migration
1. Create `db/migrations/00X_my_change.sql`.
2. Apply to local: `./db/migrate.sh local`.
3. Verify in Supabase Studio.
4. Commit. CI will refuse if it's a syntax error.

### Generate a fresh game code
Game codes are server-generated by `POST /games`. To create one for testing:
```bash
curl -X POST http://localhost:8000/games \
  -H "X-Admin-Password: devpass123" \
  -H "Content-Type: application/json" \
  -d '{"total_rounds": 3, "selected_genres": []}'
```

(Empty `selected_genres` will be rejected by validation; use a real genre uuid from `SELECT id FROM genres LIMIT 1`.)

### Inspect Realtime traffic
Open the browser DevTools → Network → WS tab. Filter by "realtime". Click on the WebSocket connection → Messages. You'll see the `postgres_changes` events flowing through.

### Reset everything
```bash
supabase db reset                   # wipes Postgres data, re-runs migrations + seed
rm -rf backend/__pycache__ backend/.pytest_cache
rm -rf frontend/node_modules/.vite
```

## 10. Code Style & Linting

### Backend (ruff + mypy)

```bash
cd backend
ruff check .                        # lint
ruff format .                       # format (replaces black)
mypy app/                           # type check
```

Pre-commit hook: `pre-commit install` once, then formatting + linting runs on `git commit`.

### Frontend (eslint + prettier)

```bash
cd frontend
npm run lint                        # eslint
npm run format                      # prettier
npm run type-check                  # tsc --noEmit
```

CI rejects PRs with lint errors. Fix locally before pushing.

## 11. Troubleshooting

### `supabase start` fails

- Check Docker Desktop is running.
- `supabase stop` then `supabase start` again.
- If ports are in use: `supabase status` shows the ports; kill any conflicting process.
- On Windows: ensure WSL2 backend is enabled in Docker Desktop.

### Backend can't connect to local Supabase

- Verify `SUPABASE_URL=http://localhost:54321` (not `https://`, not the cloud URL).
- Verify the service-role key matches what `supabase status` reports.
- Test: `curl http://localhost:54321/rest/v1/genres -H "apikey: $SUPABASE_ANON_KEY"`.

### Frontend can't connect to backend

- Verify CORS: backend `CORS_ORIGINS` must include `http://localhost:5173`.
- Verify `VITE_API_URL=http://localhost:8000` in frontend `.env`.
- Hard refresh the browser (changes to `.env` require a Vite restart, not just HMR).

### `buzz_in` RPC returns 401

- The frontend must use the anon key, not the service-role key.
- Verify the `apikey` header is sent: DevTools → Network → request headers.

### Realtime events not arriving

- Check Supabase Studio → Database → Replication → ensure the table is in the `supabase_realtime` publication.
- Verify the channel filter matches the row's `game_code`.
- Check the WebSocket is open in DevTools.

### "Address already in use" on port 8000 / 5173 / 54321

```bash
# Find the process
lsof -i :8000        # or :5173, :54321
# Kill it
kill -9 <pid>
```

PowerShell:
```powershell
Get-NetTCPConnection -LocalPort 8000 | Select-Object OwningProcess
Stop-Process -Id <pid>
```

## 12. Optional: Use a Cloud Preview Supabase

If you don't want to run Docker, you can point local dev at a dedicated cloud Supabase project (`Sound-Clash-Preview`):

- Pros: no Docker; same environment as CI.
- Cons: data is shared across collaborators; Realtime quotas tick down; slower than local.

To use it: change `.env` files to point to the preview project's URL and keys. The rest of the workflow is identical.

Don't point local dev at the production Supabase project under any circumstances.

## 13. What This Doc Doesn't Cover

- IDE setup (VS Code recommended; install Python + ESLint extensions; that's about it)
- Debugger configuration (use uvicorn `--reload` + browser DevTools; stretch goal: launch.json for VS Code)
- Hot-reload of Python (uvicorn `--reload` is good enough; no need for fancier)
- Mocking the Supabase client in unit tests (see existing tests for patterns)

For anything not covered, ask in a GitHub discussion or read the upstream docs.
