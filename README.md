# Sound Clash

A real-time multiplayer music trivia game. Teams compete to identify songs by buzzing in fastest, with a manager-evaluated scoring system.

[![CI](https://github.com/BenArtzi4/Sound-Clash/actions/workflows/backend.yml/badge.svg)](https://github.com/BenArtzi4/Sound-Clash/actions/workflows/backend.yml)
[![Frontend](https://github.com/BenArtzi4/Sound-Clash/actions/workflows/frontend.yml/badge.svg)](https://github.com/BenArtzi4/Sound-Clash/actions/workflows/frontend.yml)
[![Coverage](https://codecov.io/gh/BenArtzi4/Sound-Clash/branch/main/graph/badge.svg)](https://codecov.io/gh/BenArtzi4/Sound-Clash)

## Play it now

**[https://soundclash.org](https://soundclash.org)**: open it in any browser. Hosting a game is free and takes seconds: pick genres and round count, share the 6-character code with your room, players join from their phones, you run the round on a TV or projector. No accounts, no install.

## What is this?

Sound Clash is a buzzer game played in groups. Three roles connect to a shared game code:

- **Manager**: picks genres, advances rounds, judges answers
- **Teams** (typically on phones): race to buzz in when they recognize the song
- **Display**: public scoreboard for the room ("TV screen")

Each round, the manager plays a YouTube clip. Teams buzz; first one wins the lock. The manager evaluates the answer with toggle buttons: **Correct Song +10**, **Correct Artist +5**, **Wrong buzz -3**. The host can also grant any team a **Bonus +4** at any time (off-the-cuff awards for clever guesses, callbacks, etc). Game ends after N rounds; the scoreboard is shown on the Display screen; all game data is auto-deleted after 4 hours.

## Stack

100% free-tier (excluding the domain):

- **Backend**: Python 3.11 + FastAPI on Render
- **Database + Realtime + RPC**: Supabase (Postgres 15)
- **Frontend**: React 18 + TypeScript + Vite on Cloudflare Pages
- **CI/CD**: GitHub Actions
- **Errors**: Sentry

The architectural keystone: the buzzer is a Postgres PL/pgSQL function called directly from the browser via Supabase RPC, with row-change events fanned out to all clients via Supabase Realtime. Python is **not** in the buzzer hot path; this is what makes <200ms buzzer latency possible on free hosting. The full design discussion lives in `docs/realtime-design.md` if you're curious.

## Project status

- [x] Phase 1: Infrastructure setup
- [x] Phase 2: Data migration
- [x] Phase 3: Postgres logic
- [x] Phase 4: Backend port
- [x] Phase 5: Realtime wiring & frontend port
- [x] Phase 6: End-to-end testing
- [x] Phase 7: Deploy & cutover

The game is live and playable at [https://soundclash.org](https://soundclash.org).

## License

MIT. See [`LICENSE`](LICENSE).
