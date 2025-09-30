# Task 2.4 Complete - Game State Transitions

## Overview

Complete implementation of game state management system from waiting room through active gameplay to winner determination.

## What Was Built

### 1. Core Game State System
**Files**: `backend/websocket-service/models/game_state.py`

- `GameState`: waiting → playing → finished
- `RoundState`: not_started → song_playing → buzzer_locked → evaluating → completed
- Data models for games, rounds, scores, answers

### 2. Song Selection Service
**Files**: `backend/websocket-service/services/song_selector.py`

- Communicates with Song Management API
- Selects random songs from specified genres
- Excludes already-played songs
- Returns full song metadata

### 3. Round Management Service
**Files**: `backend/websocket-service/services/round_manager.py`

- Game lifecycle management (create, start, end)
- Round lifecycle (start, complete)
- Buzzer system (first team locks buzzer)
- Answer submission and evaluation
- Scoring calculation: 10+5+5 points, -2 penalty
- Winner determination

### 4. Complete WebSocket Integration
**Files**: `backend/websocket-service/main_complete.py`

- Full API endpoints for all game actions
- WebSocket connections for teams and managers
- Real-time broadcasting of game events
- Integrated with round manager and song selector

## Game Flow

```
1. Waiting Room
   - Teams join via WebSocket
   - Manager sees team list
   
2. Manager Starts Game
   → State: WAITING → PLAYING
   → Broadcast: game_started
   
3. Manager Starts Round
   → Select random song from genres
   → Broadcast: round_started (with song info)
   → YouTube player loads at 5-second mark
   
4. Song Playing
   → Teams press buzzer
   → First team locks buzzer
   → Broadcast: buzzer_locked
   
5. Team Submits Answer
   → Song name, artist, movie/TV
   → Broadcast to manager: answer_submitted
   
6. Manager Evaluates
   → Mark each field correct/incorrect
   → Calculate points (10+5+5)
   → Update scores
   → Broadcast: round_completed
   
7. Next Round (repeat 3-6)
   
8. Game Ends
   → Determine winner (highest score)
   → Broadcast: game_finished
   → State: PLAYING → FINISHED
```

## API Endpoints

### Game Management
- `POST /api/game/{code}/notify` - Register game
- `GET /api/game/{code}/status` - Get game state
- `POST /api/game/{code}/start` - Start game
- `POST /api/game/{code}/end` - End game

### Round Management
- `POST /api/game/{code}/round/start` - Start next round
- `POST /api/game/{code}/timeout` - Handle timeout

### Gameplay
- `POST /api/game/{code}/buzzer` - Team buzzes
- `POST /api/game/{code}/answer` - Submit answer
- `POST /api/game/{code}/evaluate` - Manager evaluates

### WebSocket
- `WS /ws/team/{code}` - Team connection
- `WS /ws/manager/{code}` - Manager connection

## WebSocket Messages

### Broadcasts (to all clients)
```json
{"type": "team_joined", "team_name": "...", "teams": [...]}
{"type": "game_started", "max_rounds": 10}
{"type": "round_started", "round_number": 1, "song": {...}}
{"type": "buzzer_locked", "team_name": "..."}
{"type": "round_completed", "score": {...}, "team_scores": {...}}
{"type": "game_finished", "winner": "...", "scores": {...}}
```

### Manager-only
```json
{"type": "answer_submitted", "team_name": "...", "answer": {...}}
```

## Scoring System

| Event | Points |
|-------|--------|
| Song name correct | +10 |
| Artist correct | +5 |
| Movie/TV correct | +5 |
| Buzzer timeout | -2 |
| Wrong answer | 0 |
| **Max per round** | **20** |

## Testing

### Local Test (No Database)
```powershell
.\scripts\test-complete-flow-local.ps1
```

Tests all components in isolation.

### CloudShell Test (Full Integration)
```bash
cd ~/Sound-Clash
chmod +x scripts/cloudshell/test-complete-flow.sh
./scripts/cloudshell/test-complete-flow.sh
```

Tests complete game flow with real database:
- Creates game with 3 rounds
- Starts game and rounds
- Tests buzzer locking
- Tests answer submission
- Tests scoring (correct answers)
- Tests timeout scenario
- Ends game and determines winner

## Files Created

```
backend/websocket-service/
├── models/
│   ├── __init__.py
│   └── game_state.py (Game/Round states, data models)
├── services/
│   ├── __init__.py
│   ├── song_selector.py (Song API integration)
│   └── round_manager.py (Game lifecycle)
└── main_complete.py (Full WebSocket service)

scripts/
├── test-complete-flow-local.ps1 (Local test)
└── cloudshell/
    └── test-complete-flow.sh (Full E2E test)

docs/
└── TASK_2_4_COMPLETE.md (This file)
```

## Dependencies

Added to requirements:
- `aiohttp` - HTTP client for song API
- `pydantic` - Data validation (already present)

## Design Decisions

1. **In-memory game state** - Games stored in RoundManager, ephemeral
2. **Manager evaluation** - Points decided by manager, not automatic
3. **First buzzer wins** - Once pressed, others locked out
4. **Fixed 5-second start** - All songs start at same position
5. **Single answer attempt** - One chance per team per round

## Next Steps (Future Work)

**Phase 4**: Frontend Integration
- GamePlayPage with YouTube player
- Buzzer button UI
- Answer submission form
- Real-time scoreboard

**Phase 5**: Manager Interface
- Evaluation controls
- Round progression UI
- Winner announcement screen

## Deployment Notes

### Environment Variables
```
SONG_MANAGEMENT_URL=http://alb-url:8001
PORT=8002
```

### Docker
Service can be deployed as-is to ECS. Uses existing Dockerfile.

### Database
Requires PostgreSQL with songs data. Use CloudShell scripts to populate.

## Verification

All tests pass:
- ✅ Game state transitions
- ✅ Round lifecycle
- ✅ Song selection from database
- ✅ Buzzer locking mechanism
- ✅ Answer submission
- ✅ Scoring calculation
- ✅ Winner determination

## Success Criteria Met

- [x] Manager can start game
- [x] Rounds progress automatically
- [x] Songs selected from database
- [x] Buzzer locks to first team
- [x] Answers submitted and evaluated
- [x] Scores calculated correctly (10+5+5)
- [x] Timeouts apply penalty (-2)
- [x] Winner determined by highest score
- [x] All state changes broadcast in real-time

## Architecture

```
┌─────────────┐         ┌──────────────────┐
│   Manager   │◄───────►│                  │
│  WebSocket  │         │   WebSocket      │
└─────────────┘         │    Service       │
                        │                  │
┌─────────────┐         │  - Connection    │         ┌──────────────┐
│   Team A    │◄───────►│    Manager       │        │              │
│  WebSocket  │         │  - Round         │◄──────►│ Song Mgmt    │
└─────────────┘         │    Manager       │        │   Service    │
                        │  - Song          │        │              │
┌─────────────┐         │    Selector      │        └──────────────┘
│   Team B    │◄───────►│                  │              │
│  WebSocket  │         └──────────────────┘              │
└─────────────┘                                           ▼
                                                    ┌──────────────┐
                                                    │  PostgreSQL  │
                                                    │   (Songs)    │
                                                    └──────────────┘
```

## Known Limitations

1. **In-memory state** - Games lost on service restart
2. **No persistence** - Round history not saved to database
3. **Single song start time** - Always 5 seconds (simplified)
4. **No reconnection** - Teams/managers must rejoin if disconnected

These are acceptable for MVP and can be enhanced in future iterations.
