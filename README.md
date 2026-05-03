# Sound Clash

A real-time multiplayer music trivia game. Teams compete to identify songs by buzzing in fastest, with a manager-evaluated scoring system.

[![CI](https://github.com/BenArtzi4/Sound-Clash/actions/workflows/backend.yml/badge.svg)](https://github.com/BenArtzi4/Sound-Clash/actions/workflows/backend.yml)
[![Frontend](https://github.com/BenArtzi4/Sound-Clash/actions/workflows/frontend.yml/badge.svg)](https://github.com/BenArtzi4/Sound-Clash/actions/workflows/frontend.yml)
[![Coverage](https://codecov.io/gh/BenArtzi4/Sound-Clash/branch/main/graph/badge.svg)](https://codecov.io/gh/BenArtzi4/Sound-Clash)

## What is this?

Sound Clash is a buzzer game played in groups. Three roles connect to a shared game code:

- **Manager** — picks genres, advances rounds, judges answers
- **Teams** (typically on phones) — race to buzz in when they recognize the song
- **Display** — public scoreboard for the room ("TV screen")

Each round, the manager plays a YouTube clip. Teams buzz; first wins the lock. The manager evaluates the team's verbal answer and awards points (title=10, artist=5, source=5). Game ends after N rounds; scoreboard is shown; data is auto-deleted after 4 hours.

## Stack

100% free-tier (excluding domain):

- **Backend**: Python 3.11 + FastAPI on Render
- **Database + Realtime + RPC**: Supabase (Postgres 15)
- **Frontend**: React 18 + TypeScript + Vite on Cloudflare Pages
- **CI/CD**: GitHub Actions
- **Errors**: Sentry

The architectural keystone: the buzzer is a Postgres PL/pgSQL function called directly from the browser via Supabase RPC, with row-change events fanned out to all clients via Supabase Realtime. Python is **not** in the buzzer hot path — this is what makes <200ms buzzer latency possible on free hosting. See [`docs/realtime-design.md`](docs/realtime-design.md).

## Quick start

```bash
git clone https://github.com/BenArtzi4/Sound-Clash.git
cd Sound-Clash

# Start local Supabase (requires Docker)
supabase start

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload

# Frontend (separate terminal)
cd ../frontend
npm install
npm run dev
```

Open http://localhost:5173. Full setup details: [`docs/local-development.md`](docs/local-development.md).

## Documentation

| Doc | When to read |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Start here — overview with links |
| [`docs/realtime-design.md`](docs/realtime-design.md) | The central design decision |
| [`docs/tech-stack.md`](docs/tech-stack.md) | Service-by-service rationale |
| [`docs/game-rules.md`](docs/game-rules.md) | Gameplay flow + edge cases |
| [`docs/data-model.md`](docs/data-model.md) | Schema |
| [`docs/rpc-functions.md`](docs/rpc-functions.md) | The 5 PL/pgSQL functions |
| [`docs/security-rls.md`](docs/security-rls.md) | Auth + threat model |
| [`docs/api-contracts.md`](docs/api-contracts.md) | REST + Realtime contracts |
| [`docs/free-tier-budget.md`](docs/free-tier-budget.md) | Capacity planning |
| [`docs/local-development.md`](docs/local-development.md) | Dev setup |
| [`docs/runbook.md`](docs/runbook.md) | Production ops |

## Project status

- [ ] Phase 1 — Infrastructure setup
- [ ] Phase 2 — Data migration
- [ ] Phase 3 — Postgres logic
- [ ] Phase 4 — Backend port
- [ ] Phase 5 — Realtime wiring & frontend port
- [ ] Phase 6 — End-to-end testing
- [ ] Phase 7 — Deploy & cutover

Full plan: [`docs/roadmap.md`](docs/roadmap.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). PRs welcome; issues for bugs and feature requests.

## License

MIT — see [`LICENSE`](LICENSE).

## Predecessor

The legacy AWS version is at https://github.com/BenArtzi4/Sound-Clash-legacy (archived).
