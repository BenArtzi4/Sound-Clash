# Sound Clash - Services Architecture

Complete documentation of all services used in the Sound Clash web application.

---

## Table of Contents
1. [Backend Services](#backend-services)
2. [Frontend](#frontend)
3. [AWS Infrastructure Services](#aws-infrastructure-services)
4. [Development Services](#development-services)
5. [Service Communication](#service-communication)

---

## Backend Services

### 1. Game Management Service (Port 8000)

**Purpose:** Manages game lifecycle and team operations

**What it does:**
- Creates and manages game rooms with unique game codes
- Handles team joining and registration
- Tracks game state (WAITING → PLAYING → COMPLETED)
- Manages team scores and leaderboards
- Persists game history to database

**Technology Stack:**
- FastAPI (Python)
- PostgreSQL (persistent storage)
- Redis (caching/sessions)

**Key Endpoints:**
- `POST /api/games` - Create new game
- `POST /api/games/{gameCode}/join` - Team joins game
- `GET /api/games/{gameCode}` - Get game state
- `GET /health` - Health check

**File Location:** `backend/game-management/`

---

### 2. Song Management Service (Port 8001)

**Purpose:** Song database and selection management

**What it does:**
- Stores and manages song library (PostgreSQL)
- Categorizes songs by genres (Israeli Music, Styles, Media)
- Provides random song selection with filters
- Prevents duplicate songs within same game
- Admin CRUD operations for songs

**Technology Stack:**
- FastAPI (Python)
- PostgreSQL (song catalog)
- YouTube API integration (song playback)

**Key Endpoints:**
- `GET /api/songs` - List all songs (paginated)
- `POST /api/songs/select` - Select random songs by genre
- `GET /api/songs/genres/all` - Get all genres
- `POST /api/songs` - Add new song (admin)
- `GET /api/songs/status` - Service health

**File Location:** `backend/song-management/`

---

### 3. WebSocket Service (Port 8003)

**Purpose:** Real-time communication for all clients

**What it does:**
- Maintains WebSocket connections for teams, managers, and displays
- Broadcasts game events in real-time:
  - Round started (song info sent to all)
  - Buzzer pressed (team locked in)
  - Answer evaluated (scores updated)
  - Round completed
  - Game ended
- Manages game rooms and connection state
- Tracks which songs have been played

**Technology Stack:**
- FastAPI + WebSockets (Python)
- In-memory game state management
- Socket.io protocol

**Key Events:**
- `round_started` - New song selected, sent to all
- `buzzer_locked` - Team buzzed first
- `answer_evaluated` - Manager scored answer
- `buzzers_enabled` - Manager continues round
- `round_completed` - Both components answered
- `game_ended` - Winner announced

**Connection URL:**
```
wss://api.soundclash.org/ws/{role}/{gameCode}
```
Where role = `team`, `manager`, or `display`

**File Location:** `backend/websocket-service/`

---

### 4. Shared Module

**Purpose:** Common code used by all backend services

**What it contains:**
- Pydantic models (data validation)
  - `ActiveGame` - Game state model
  - `TeamMember` - Team information
  - `GameRound` - Round data
  - `GameSettings` - Configuration
- Common utilities
- Shared database models

**File Location:** `backend/shared/`

---

## Frontend

### React TypeScript Application

**Purpose:** User interface for all game participants

**What it does:**
- Serves 3 different interfaces:
  1. **Team Interface** - Simple buzzer for players
  2. **Manager Interface** - Full game control with YouTube player
  3. **Display Interface** - Public scoreboard for audience
- Admin panel for song management
- Responsive design (mobile, tablet, desktop)

**Technology Stack:**
- React 18 + TypeScript
- Vite (build tool)
- React Router v6 (routing)
- Socket.io client (WebSocket)
- Axios (HTTP requests)
- CSS Modules (styling)

**Key Routes:**
```
Team Routes:
/team/join                    - Enter game code
/team/game/:gameCode          - Buzzer interface

Manager Routes:
/manager/create               - Create game + select genres
/game/:gameCode/lobby         - Waiting room
/manager/game/:gameCode       - Control panel

Display Routes:
/display/join                 - Enter game code
/display/join/:gameCode       - Pre-game with QR code
/display/game/:gameCode       - Live scoreboard
/display/winner/:gameCode     - Winner announcement

Admin Routes:
/admin/login                  - Admin authentication
/admin/*                      - Song management CRUD
```

**File Location:** `frontend/`

---

## AWS Infrastructure Services

Sound Clash uses AWS CDK (Infrastructure as Code) with the following services:

### 1. VPC (Virtual Private Cloud)

**Purpose:** Network isolation and security

**What it does:**
- Creates isolated network in AWS (CIDR: 10.0.0.0/16)
- 3 Availability Zones for high availability
- Subnets:
  - **Public** (10.0.0-2.0/24) - ALB, NAT Gateway
  - **Private** (10.0.3-5.0/24) - ECS tasks
  - **Isolated** (10.0.6-8.0/24) - Databases (future)
- 1 NAT Gateway for internet access ($45/month)

**CDK Stack:** `infrastructure/stacks/vpc_stack.py`

---

### 2. ECS (Elastic Container Service)

**Purpose:** Container orchestration for backend services

**What it does:**
- Runs Docker containers for backend services
- Auto-scaling based on load
- Health checks and automatic recovery
- 2x t3.small EC2 instances (~$30/month)

**Services Running:**
- game-management (no longer used in production)
- song-management
- websocket-service

**CDK Stack:** `infrastructure/stacks/ecs_stack.py`

---

### 3. ALB (Application Load Balancer)

**Purpose:** Routes traffic to correct backend service

**What it does:**
- Listens on ports 80 (HTTP) and 443 (HTTPS)
- Path-based routing:
  - `/api/songs/*` → song-management service
  - `/api/games/*` → game-management service (deprecated)
  - `/ws/*` → websocket service
  - `/health` → service health checks
- SSL certificate management
- Sticky sessions for WebSocket connections

**DNS:** `api.soundclash.org`

**CDK Stack:** `infrastructure/stacks/alb_stack.py`

---

### 4. RDS (Relational Database Service) - PostgreSQL

**Purpose:** Persistent data storage

**What it stores:**
- Song catalog (songs_master table)
- Genres and song-genre relationships
- Game history
- Team records

**Configuration:**
- Engine: PostgreSQL 14
- Instance: db.t4g.micro (free tier eligible)
- Storage: 20GB GP3 (auto-scaling to 100GB)
- Backup: 1 day retention
- Multi-AZ: Disabled (development)

**Tables:**
- `songs_master` - Song catalog
- `genres` - Genre categories
- `song_genres` - Many-to-many junction
- `games` - Game records
- `teams` - Team information

**Cost:** Free tier, then ~$15/month

**CDK Stack:** `infrastructure/stacks/database_stack.py`

---

### 5. DynamoDB

**Purpose:** Ephemeral game state with auto-expiration

**What it stores:**
- Active games (4-hour TTL)
- Game sessions (round data)
- Buzz events
- Team connections

**Why DynamoDB:**
- Automatic TTL (data expires after 4 hours)
- Serverless (pay only for what you use)
- Fast NoSQL queries

**Status:** Currently disabled pending dependency resolution

**Tables (when enabled):**
- `sound-clash-active-games`
- `sound-clash-game-sessions`
- `sound-clash-buzz-events`
- `sound-clash-team-connections`

**Cost:** Pay-per-request, ~$1/month

**CDK Stack:** `infrastructure/stacks/database_stack.py`

---

### 6. ElastiCache (Redis)

**Purpose:** In-memory caching and session management

**What it does:**
- Caches frequently accessed data
- Session storage
- Real-time data sharing between services

**Configuration:**
- Node type: cache.t3.micro
- Engine: Redis 7.0
- Nodes: 1 (single-node cluster)

**Cost:** ~$12/month

**CDK Stack:** `infrastructure/stacks/database_stack.py`

---

### 7. ECR (Elastic Container Registry)

**Purpose:** Docker image storage

**What it does:**
- Stores Docker images for backend services
- Version control for deployments
- Integrated with ECS for deployments

**Repositories:**
- `sound-clash/websocket-service`
- `sound-clash/song-management`
- `sound-clash/game-management`

**Storage:** 0.5 GB free tier, $0.10/GB/month after

**CDK Stack:** `infrastructure/stacks/ecr_stack.py`

---

### 8. CloudFront + S3 (Frontend)

**Purpose:** Global content delivery for React app

**What it does:**
- **S3** - Stores static files (HTML, JS, CSS)
- **CloudFront** - CDN for fast global access
- HTTPS with AWS Certificate Manager
- Caches static assets worldwide

**Configuration:**
- S3 Bucket: `sound-clash-frontend-381492257993-us-east-1`
- CloudFront Distribution: `E3DNQ80BLT42Z2`
- Custom Domain: `www.soundclash.org`

**Cost:**
- S3: Minimal (~$0.50/month)
- CloudFront: ~$1/month

**CDK Stack:** `infrastructure/stacks/frontend_stack.py`

---

### 9. ACM (AWS Certificate Manager)

**Purpose:** SSL/TLS certificates for HTTPS

**What it does:**
- Provides free SSL certificates
- Auto-renewal every 90 days
- Covers: `soundclash.org` and `*.soundclash.org`

**Domains:**
- `www.soundclash.org` (CloudFront)
- `api.soundclash.org` (ALB)

**Cost:** FREE

---

### 10. Route 53 (DNS) - External

**Purpose:** Domain name management

**What it does:**
- DNS routing for soundclash.org
- Currently managed via Namecheap, not Route 53

**DNS Records (Namecheap):**
- `www.soundclash.org` → CloudFront
- `api.soundclash.org` → ALB
- `soundclash.org` → Redirect to www

---

## Development Services

Services used only in local development:

### 1. Docker Compose

**Purpose:** Local development environment

**What it runs:**
- PostgreSQL 14 (port 5432)
- Redis 7 (port 6379)
- game-management service (port 8000)
- song-management service (port 8001)
- frontend dev server (port 3000)

**File:** `docker-compose.yml`

**Start command:**
```bash
npm run dev
```

---

### 2. PostgreSQL (Local)

**Purpose:** Local database for development

**Connection:**
- Host: localhost
- Port: 5432
- Database: soundclash_local
- User: dev
- Password: devpass

---

### 3. Redis (Local)

**Purpose:** Local caching for development

**Connection:**
- Host: localhost
- Port: 6379

---

## Service Communication

### How Services Talk to Each Other

```
┌─────────────────────────────────────────────────────────┐
│                        USERS                            │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│  CloudFront (www.soundclash.org)                        │
│  └─> S3 Bucket (React Frontend)                         │
└─────────────────────────────────────────────────────────┘
               │
               │ API Calls (HTTPS)
               │ WebSocket (WSS)
               ▼
┌─────────────────────────────────────────────────────────┐
│  Application Load Balancer (api.soundclash.org)         │
│  ├─> /api/songs/* → Song Management Service             │
│  ├─> /api/games/* → Game Management Service             │
│  └─> /ws/* → WebSocket Service                          │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  ECS Cluster (Docker Containers)                        │
│  ├─> song-management (Port 8001)                        │
│  ├─> game-management (Port 8000) [deprecated]           │
│  └─> websocket-service (Port 8003)                      │
└──────────┬──────────────────────────────────────────────┘
           │
           │ Database Queries
           ▼
┌─────────────────────────────────────────────────────────┐
│  Data Layer                                             │
│  ├─> RDS PostgreSQL (Persistent)                        │
│  ├─> ElastiCache Redis (Cache)                          │
│  └─> DynamoDB (Ephemeral) [disabled]                    │
└─────────────────────────────────────────────────────────┘
```

### Communication Protocols

1. **Frontend ↔ Backend**
   - REST API (HTTPS): Song queries, game creation
   - WebSocket (WSS): Real-time game events

2. **Backend ↔ Database**
   - PostgreSQL: asyncpg (async driver)
   - Redis: redis-py
   - DynamoDB: boto3 (when enabled)

3. **Services ↔ Services**
   - Currently: Independent (no inter-service communication)
   - Future: HTTP calls for cross-service operations

---

## Service Flow for a Typical Game

### 1. Pre-Game

```
Manager → CloudFront → Frontend
Manager → /api/songs/genres/all → Song Service
Manager → WebSocket /ws/manager/{gameCode} → WebSocket Service
Teams → /team/join → Frontend → /ws/team/{gameCode} → WebSocket Service
Display → /display/join/{gameCode} → Frontend → /ws/display/{gameCode}
```

### 2. During Game

```
Manager: Start Round
  → WebSocket Service: "start_round" event
  → Song Service: Get random song (excluding played)
  → WebSocket: Broadcast "round_started" to all

Team: Press Buzzer
  → WebSocket Service: "buzz_pressed" event
  → WebSocket: Broadcast "buzzer_locked" to all

Manager: Evaluate Answer
  → WebSocket Service: "evaluate_answer" event
  → Update scores in memory
  → WebSocket: Broadcast "answer_evaluated" to all
  → Display: Shows updated scoreboard
```

### 3. End Game

```
Manager: End Game
  → WebSocket Service: "end_game" event
  → Calculate winner
  → PostgreSQL: Save game results
  → WebSocket: Broadcast "game_ended" to all
  → Display: Navigate to /display/winner/{gameCode}
```

---

## Cost Summary

| Service | Monthly Cost | Purpose |
|---------|--------------|---------|
| **EC2 (ECS)** | ~$30 | Backend containers |
| **NAT Gateway** | ~$45 | Private subnet internet |
| **ALB** | ~$16 | Load balancing |
| **RDS PostgreSQL** | Free tier* | Database |
| **ElastiCache Redis** | ~$12 | Caching |
| **CloudFront** | ~$1 | CDN |
| **DynamoDB** | ~$1 | Ephemeral data |
| **ACM** | FREE | SSL certificates |
| **ECR** | FREE | Docker images |
| **S3** | <$1 | Static files |
| **Total** | **~$105/month** | |

*Free tier for first 12 months, then ~$15/month

**Cost optimization applied:** ~$36-42/month with cleanup

---

## Technology Stack Summary

### Backend
- **Language:** Python 3.9+
- **Framework:** FastAPI
- **Database:** PostgreSQL 14
- **Cache:** Redis 7
- **WebSocket:** Socket.io + FastAPI WebSockets
- **Validation:** Pydantic
- **ORM:** SQLAlchemy (async)
- **Deployment:** Docker + ECS

### Frontend
- **Language:** TypeScript
- **Framework:** React 18
- **Build Tool:** Vite
- **Routing:** React Router v6
- **HTTP Client:** Axios
- **WebSocket:** Socket.io-client
- **Styling:** CSS Modules
- **Deployment:** S3 + CloudFront

### Infrastructure
- **IaC:** AWS CDK (Python)
- **Orchestration:** Docker Compose (local), ECS (production)
- **CI/CD:** Manual deployment scripts
- **Monitoring:** CloudWatch Logs + Container Insights

---

## Security

### Authentication
- **Admin Panel:** Password-protected (environment variable)
- **Game Access:** Game code only (no auth required for players)
- **API:** No authentication (public game service)

### Network Security
- **HTTPS:** All production traffic encrypted
- **VPC:** Backend services in private subnets
- **Security Groups:** Strict ingress/egress rules
- **Database:** Not publicly accessible (private subnet in future)

### Data Security
- **Game Codes:** 5-character random codes (26^5 = 11.8M combinations)
- **TTL:** Game data auto-expires after 4 hours
- **No PII:** No personal information collected

---

## Monitoring & Logging

### CloudWatch Logs
- Log groups per service
- Retention: 3 days (cost optimized)
- Real-time log streaming

### Health Checks
- ALB target health checks (every 30s)
- ECS task health checks
- Application `/health` endpoints

### Metrics
- Container Insights (disabled for cost)
- ECS service metrics (CPU, memory, task count)
- ALB metrics (requests, latency, errors)

---

*Last Updated: 2025-10-18*
