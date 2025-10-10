# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sound Clash is a real-time multiplayer music trivia buzzer game built with AWS microservices architecture. Teams compete to identify songs, artists, and media sources across multiple rounds.

**Game Type**: Social verbal game where teams speak their answers and the manager evaluates them in real-time.

**Simplified Approach**:
- Fixed 5-second start time for all songs (no AI selection, no heatmap processing)
- Manager controls game pacing (no automatic timeouts)
- Verbal answers evaluated by manager (not typed submissions)

## Development Commands

### Start Development Environment
```bash
# Start all services with Docker Compose (PostgreSQL, Redis, backend services, frontend)
npm run dev

# Start only frontend (requires backend services running)
npm run dev:frontend
```

### Build & Test
```bash
# Build frontend
npm run build

# Build for production
cd frontend && npm run build:production

# Lint frontend code
npm run lint
```

### Database Operations
```bash
# Import songs from CSV into PostgreSQL
python scripts/database/import_songs_from_csv.py

# Create database tables
python scripts/database/create_tables.py
```

### Deployment
```bash
# Deploy infrastructure (AWS CDK)
npm run deploy:infra

# Deploy backend services to AWS
npm run deploy:services
```

### Running Individual Backend Services
Each FastAPI service can be run independently for development:
```bash
cd backend/game-management
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Architecture Overview

### Microservices Design
The backend consists of FastAPI microservices that communicate via HTTP and WebSockets:

1. **Game Management Service (port 8000)** - Game lifecycle, team joining, game state
2. **Song Management Service (port 8001)** - Song database, genres, song selection
3. **WebSocket Service (port 8003)** - Real-time communication between teams, managers, and displays
4. **Game API Service (port 8002)** - Buzzer logic and scoring (planned)
5. **Manager Console Service (port 8004)** - Host interface API (planned)
6. **Public Display Service (port 8005)** - Spectator interface API (planned)

### Frontend Architecture
- **Framework**: React 18 + TypeScript with Vite
- **Routing**: React Router v6 with lazy-loaded pages
- **State Management**: Context API (GameContext, AuthContext)
- **Styling**: CSS variables + modular CSS
- **Real-time**: Socket.io client for WebSocket communication

### Three Distinct Screen Types

The application has three different screen types for different roles in the physical room setup:

**1. Team Screen (Mobile/Tablet - One per team)**
- Purpose: Simple buzzer interface only
- Audio: No audio (teams hear from manager's device/room speakers)
- Interface: Large buzzer button, minimal feedback, component status
- No YouTube player, no scoreboard

**2. Manager Screen (Laptop/Desktop)**
- Purpose: Full game control and answer evaluation
- Audio: YouTube player audio plays through room speakers
- Interface: YouTube player, correct answers reference, evaluation buttons, full controls
- Manager sees correct answers but NOT the scoreboard (watches the display)

**3. Display Screen (TV/Projector - Public view)**
- Purpose: Everyone in the room watches this for game info
- Audio: No audio (no YouTube player)
- Interface: Prominent scoreboard, round info, buzz notifications
- No YouTube player - only visual information for spectators

### Key Frontend Routes

**Team Routes:**
- `/team/join` - Enter game code and team name
- `/team/game/:gameCode` - Buzzer interface

**Manager Routes:**
- `/manager/create` - Create game and select genres
- `/game/:gameCode/lobby` - Waiting room
- `/manager/game/:gameCode` - Manager console with full controls

**Display Routes:**
- `/display/join` - Enter game code
- `/display/join/:gameCode` - Pre-game instructions with QR code
- `/display/game/:gameCode` - Main scoreboard display
- `/display/winner/:gameCode` - Winner announcement

**Admin Routes:**
- `/admin/login` - Admin login (password required)
- `/admin/*` - Admin panel for song management (requires authentication)

### Data Storage Strategy
- **PostgreSQL (RDS)**: Persistent data (users, songs, genres, historical game data)
- **DynamoDB**: Ephemeral game state with TTL (currently disabled pending dependency resolution)
- **Redis (ElastiCache)**: Caching and session management

### Database Schema
Key PostgreSQL tables:
- `songs_master` - Song catalog with YouTube IDs, titles, artists
- `genres` - Genre hierarchy with categories (Israeli Music, Musical Styles, Media)
- `song_genres` - Many-to-many junction table
- `games` - Game records
- `teams` - Team records linked to games

### Shared Code Architecture
The `backend/shared/` directory contains code shared across all microservices:
- `models/game_models.py` - Pydantic models for game state (ActiveGame, TeamMember, GameRound, GameSettings)
- `models/enhanced_song.py` - Song-related models
- `requirements.txt` - Common dependencies (FastAPI, SQLAlchemy, boto3, redis, pydantic)

Services import shared models using: `from shared.models.game_models import ...`

### Service Integration Patterns

**Game Management ↔ WebSocket Service**:
- Game Management notifies WebSocket service when games are created
- WebSocket service tracks team connections and real-time state
- Use `websocket_integration.py` module for cross-service communication

**Song Management Service**:
- Provides genre-based song selection
- Returns songs with YouTube IDs for playback
- Supports filtering by genre categories (Israeli Music, Styles, Media)

### Environment Configuration
Environment files are stored in `.env/` directory:
- `local.env` - Local development (used by docker-compose)
- `production.env` - Production AWS deployment
- Service-specific `.env` files for microservice configuration

## Key Implementation Details

### Game State Management
Games follow this lifecycle:
1. **WAITING** - Host creates game, teams join
2. **ACTIVE** - Game in progress, rounds being played
3. **PAUSED** - Game temporarily paused
4. **COMPLETED** - Game finished, winner determined

Game state is managed through:
- PostgreSQL for persistence (`database/service.py` in game-management)
- DynamoDB for real-time state (temporarily disabled)
- WebSocket broadcasts for real-time updates

### Scoring System (Simplified)
Fixed point values defined in `shared/models/game_models.py`:
- Song title correct: 10 points
- Artist/Content correct: 5 points (field type depends on genre)
- Wrong answer penalty: -2 points
- Total possible per round: 15 points (not 20)

**Genre-Based Answer Fields:**
- Regular songs: Song Name (10pts) + Artist (5pts)
- Soundtrack songs: Song Name (10pts) + Content (5pts) - movie/TV/game name
- System automatically determines field type from song's genre category

### Component Locking System
This is a unique game mechanic:
1. Team buzzes and speaks their answer(s) out loud
2. Manager listens and evaluates each component separately
3. Correctly answered components are "locked" and cannot be answered again
4. Buzzers re-enable for teams to answer remaining unlocked components
5. Round ends when both components are locked OR manager skips the round
6. Teams can answer multiple components in one buzz if they know both

**Example flow:**
- Round starts: "Song Name | Artist" both available
- Team A buzzes, says song name correctly → Song locked: "~~Song Name~~ | Artist"
- Buzzers re-enable for artist component only
- Team B buzzes, says artist correctly → Both locked, round complete

### WebSocket Events

**Connection URL:**
```
ws://<ALB-DNS>/ws/game/{gameCode}?role={team|manager|display}&teamName={name}
```

**Server → Client Events:**
- `game_started` - Game moved from waiting to playing
- `round_started` - New song selected (includes YouTube ID, song info)
- `buzzer_locked` - First team buzzed, show which team
- `answer_evaluated` - Manager approved/declined components, scores updated
- `round_completed` - Both components locked or round skipped
- `game_ended` - Winner announced with final scores

**Client → Server Actions:**
- `buzz_pressed` - Team pressed buzzer (only available when unlocked)
- `evaluate_answer` - Manager approved/declined song name and artist/content
- `restart_song` - Manager restarts YouTube playback from 5 seconds
- `skip_round` - Manager moves to next song (no penalties)
- `start_round` - Manager starts new round (selects random song)
- `end_game` - Manager ends game and determines winner

### Admin Authentication & Security

**Admin Panel Access:**
- Protected routes using `ProtectedRoute` component
- Authentication managed via `AuthContext`
- Password stored in environment variable `VITE_ADMIN_PASSWORD`
- Session stored in sessionStorage (expires when tab closes)
- CRUD operations for songs, genres, and bulk imports

**IMPORTANT SECURITY NOTES:**
1. **Change Admin Password**: The default password must be changed in production
2. **Environment Files**: Frontend `.env` and `.env.production` are now in `.gitignore`
3. **Example File**: Use `frontend/.env.production.example` as a template
4. **Production Setup**: Set `VITE_ADMIN_PASSWORD` to a strong password (20+ characters)
5. **HTTPS Required**: Always use HTTPS in production to protect password transmission

## Development Notes

### Docker Compose Services
The `docker-compose.yml` defines:
- `postgres` - PostgreSQL 14 on port 5432
- `redis` - Redis 7 on port 6379
- `game-management` - Port 8000
- `song-management` - Port 8001
- `frontend` - Port 3000

Services use health checks to ensure proper startup order.

### Common Development Patterns

**Adding a New Endpoint**:
1. Define Pydantic request/response models in `shared/models/`
2. Add endpoint to appropriate service's `main.py`
3. Update frontend API client (typically in `src/services/`)
4. Add TypeScript types matching Pydantic models

**Working with Shared Models**:
- Always import from `shared.models` in backend services
- Keep Pydantic models in sync with TypeScript interfaces
- Use `BaseModel` for all data transfer objects

**Database Migrations**:
- Schema changes should be applied via migration scripts in `scripts/database/`
- Test locally with docker-compose before deploying to production

### AWS Infrastructure
The project uses AWS CDK for infrastructure (infrastructure/ directory):
- ECS for container orchestration
- ALB for load balancing with path-based routing
- VPC with public/private subnets
- RDS PostgreSQL for persistent storage
- ElastiCache Redis for caching
- CloudFront + S3 for frontend hosting

Path-based ALB routing:
- `/api/games/*` → Game Management Service
- `/api/songs/*` → Song Management Service
- `/ws/*` → WebSocket Service

## Production Deployment

### Production URLs
- **Frontend**: https://www.soundclash.org (also: https://soundclash.org redirects)
- **Backend API**: https://api.soundclash.org
- **Status Endpoint**: https://api.soundclash.org/api/songs/status
- **WebSocket**: wss://api.soundclash.org/ws/...

### Domain Configuration
- **Domain**: soundclash.org (registered via Namecheap)
- **SSL Certificate**: AWS ACM (free, auto-renewing)
- **CDN**: CloudFront for frontend
- **Load Balancer**: ALB with HTTPS listener on port 443

### Deployment Commands
```bash
# Deploy infrastructure changes
cd infrastructure && cdk deploy --all

# Deploy frontend
cd frontend && npm run build:production
aws s3 sync dist/ s3://sound-clash-frontend-381492257993-us-east-1/ --delete
aws cloudfront create-invalidation --distribution-id E3DNQ80BLT42Z2 --paths "/*"

# Deploy backend services
npm run deploy:services
```

## Testing

### Local Testing
Access services directly:
- Frontend: http://localhost:3000
- Game Management API: http://localhost:8000/docs (FastAPI auto-docs)
- Song Management API: http://localhost:8001/docs

### Production Testing
- Frontend: https://www.soundclash.org
- API Health: https://api.soundclash.org/health
- Song API: https://api.soundclash.org/api/songs/status

### Health Checks
All services expose `/health` endpoints returning:
```json
{
  "status": "healthy",
  "service": "service-name",
  "version": "1.0.0"
}
```

### Test Scripts
CloudShell test scripts in `scripts/cloudshell/`:
- `test-complete-flow.sh` - Full game flow test
- `test-game-state.sh` - Game state verification
- `load-songs.sh` - Load test data

## Important Constraints

### Current Limitations
- DynamoDB integration is disabled pending dependency conflicts
- Game state currently stored in PostgreSQL only
- WebSocket service integration is partially implemented
- Fixed 5-second start time for all songs (no dynamic timestamp selection)
- In-memory game state (games lost on service restart)

### Simplified Design Decisions
**What's NOT included (intentionally simplified):**
- ❌ AI-driven song selection algorithms
- ❌ Heatmap processing or YouTube Most Replayed API
- ❌ Multiple difficulty levels or difficulty-based timestamps
- ❌ Typed answer submissions (replaced with verbal evaluation)
- ❌ Automatic timeouts (manager controls game pacing)
- ❌ YouTube player on display screen (only manager has it)
- ❌ Scoreboard on manager screen (manager watches display)

### Cross-Service Communication
Services should communicate via:
1. Direct HTTP calls for synchronous operations
2. WebSocket broadcasts for real-time updates
3. Shared database state for persistence

When adding new service-to-service calls, use proper error handling and fallback mechanisms as shown in game-management service.

## Physical Room Setup

Understanding the physical setup helps when developing features:

```
                    ┌─────────────────────────────┐
                    │  DISPLAY SCREEN (TV)        │
                    │  • Scoreboard (prominent)   │
                    │  • Round info               │
                    │  • Buzz notifications       │
                    │  • NO YouTube player        │
                    └─────────────────────────────┘
                                 ▲
                                 │ Everyone watches
                                 │

🔊 Audio from manager's laptop → Room speakers

┌─────────────────────┐         ┌─────────┐ ┌─────────┐ ┌─────────┐
│  MANAGER LAPTOP     │         │ Team A  │ │ Team B  │ │ Team C  │
│                     │         │ Phone   │ │ Tablet  │ │ Phone   │
│  [YouTube Player]   │         │         │ │         │ │         │
│  Song: "..."        │         │ [BUZZ]  │ │ [BUZZ]  │ │ [BUZZ]  │
│  Artist: "..."      │         │         │ │         │ │         │
│                     │         │ Song ✓  │ │ Song ✓  │ │ Song ✓  │
│  ✓ Song  ✓ Artist   │         │ Artist  │ │ Artist  │ │ Artist  │
│  ✗ Wrong Answer     │         └─────────┘ └─────────┘ └─────────┘
│                     │
│  [Start Round]      │
│  [Restart Song]     │
│  [Skip Round]       │
└─────────────────────┘
```

This setup influences UI decisions:
- Teams only need buzzer (no distractions)
- Manager needs all controls but watches display for scores
- Display must be highly visible with large text
- Audio routing is manager's device only
