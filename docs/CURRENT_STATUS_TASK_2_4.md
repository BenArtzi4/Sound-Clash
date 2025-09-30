# Task 2.4 - Current Status & Next Steps

## 📋 Overview
We're implementing **Game State Transitions** - the core gameplay from waiting room → playing → finished.

## ✅ What's Already Done

### Phase 1: Database Setup ✅ (COMPLETE)
- ✅ Database schema exists (`songs_master`, `genres`, `song_genres`)
- ✅ Scripts created:
  - `backend/song-management/scripts/check_schema.py`
  - `backend/song-management/scripts/load_songs.py`
- ⚠️ **Need to verify**: Are songs actually loaded in RDS?

### Phase 2: Song Selection API ✅ (COMPLETE)
- ✅ API endpoints created in `backend/song-management/api/songs.py`:
  - `GET /api/songs/` - List songs with pagination
  - `GET /api/songs/{id}` - Get single song
  - `GET /api/songs/genres` - List genres
  - `POST /api/songs/select` - Random selection
  - `POST /api/songs/search` - Search songs
- ✅ Service deployed to ECS
- ⚠️ **Need to test**: API endpoints with real data

## ❌ What's Not Done Yet

### Phase 3: Game State Transitions (CURRENT TASK)
**Goal**: Add round management and song playback to WebSocket service

**What needs to be built**:
1. Game state management (`waiting` → `playing` → `finished`)
2. Round management (start round, end round, track progress)
3. Song selection integration (call song-management service)
4. WebSocket message broadcasting for game events
5. Manager controls (start game, next round, end game)

**Files to create/modify**:
```
backend/websocket-service/
├── models/
│   └── game_state.py (NEW - game state enums and models)
├── services/
│   ├── round_manager.py (NEW - round lifecycle management)
│   └── song_selector.py (NEW - integration with song-management API)
└── main_simple.py (MODIFY - add game state transitions)

backend/game-management/
└── main.py (MODIFY - add start/next-round endpoints)
```

### Phase 4: Buzzer & YouTube Player (NOT STARTED)
- Frontend GamePlayPage
- YouTube player component
- Buzzer button
- Answer submission form

### Phase 5: Scoring & Winner (NOT STARTED)
- Manager evaluation interface
- Scoreboard updates
- Winner determination

---

## 🚀 Immediate Action Plan

### Step 1: Verify Current State (5 minutes)
**Check if songs are loaded in database**:
```powershell
# Set environment variables
$env:POSTGRES_HOST="soundclashdatabasestack-postgresdatabase0a8a7373-ziraggvukmsd.c87k2dh7p3l9.us-east-1.rds.amazonaws.com"
$env:POSTGRES_PORT="5432"
$env:POSTGRES_DB="soundclash"
$env:POSTGRES_USER="postgres"
$env:POSTGRES_PASSWORD="your_password_here"

# Run check
python backend/song-management/scripts/check_schema.py
```

### Step 2a: If Songs NOT Loaded
```powershell
# Load songs from CSV
python backend/song-management/scripts/load_songs.py
```

### Step 2b: If Songs Already Loaded
**Skip to Step 3**

### Step 3: Test Song API (5 minutes)
```powershell
# Test locally first
cd backend/song-management
$env:POSTGRES_HOST="your_rds_host"
$env:POSTGRES_PASSWORD="your_password"

# Start service
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# In another terminal, test:
curl http://localhost:8001/api/songs/
curl http://localhost:8001/api/songs/genres
curl -X POST http://localhost:8001/api/songs/select -H "Content-Type: application/json" -d '{"genres": ["rock"], "exclude_ids": [], "count": 1}'
```

### Step 4: Start Phase 3 Implementation
**Once Phase 1 & 2 are verified working**, we'll implement Phase 3 in small sub-phases:

**Sub-Phase 3.1**: Game State Models (30 minutes)
- Create game state enums
- Create round state models
- Add state transition logic

**Sub-Phase 3.2**: Round Manager (1-2 hours)
- Create round lifecycle management
- Add song selection integration
- Track round progress

**Sub-Phase 3.3**: WebSocket Integration (1-2 hours)
- Add game state broadcasting
- Handle state transitions
- Add manager control endpoints

**Sub-Phase 3.4**: Testing (1 hour)
- Test state transitions
- Test song selection
- Test WebSocket broadcasting

---

## 🔧 Environment Setup

**Required Environment Variables** (for local testing):
```powershell
$env:POSTGRES_HOST="soundclashdatabasestack-postgresdatabase0a8a7373-ziraggvukmsd.c87k2dh7p3l9.us-east-1.rds.amazonaws.com"
$env:POSTGRES_PORT="5432"
$env:POSTGRES_DB="soundclash"
$env:POSTGRES_USER="postgres"
$env:POSTGRES_PASSWORD="<GET_FROM_SECRETS>"

# For WebSocket service
$env:SONG_MANAGEMENT_URL="http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com:8001"
```

---

## 📝 Important Notes

1. **Database is publicly accessible**: We modified the RDS security group to allow connections from anywhere (0.0.0.0/0) for development
2. **No data will be lost**: All changes are additive, no destructive operations
3. **Songs CSV ready**: 120+ songs in `data/sample/songs_converted.csv`
4. **WebSocket infrastructure working**: Real-time team connections functional
5. **Stack separation**: Each phase can be tested independently

---

## ⚠️ Known Issues from Previous Chat

1. **ECR cleanup needed**: Running low on storage
2. **Auto-registration fails**: WebSocket service registration requires manual script
3. **CloudFront blocks WebSockets**: Use ALB directly for WebSocket connections

---

## 🎯 Success Criteria for Phase 3

- [ ] Manager can click "Start Game" button
- [ ] Game transitions from `waiting` to `playing`
- [ ] First round automatically starts
- [ ] Song selected from chosen genres
- [ ] Song info broadcasted to all clients (teams + manager)
- [ ] Manager can advance to next round
- [ ] Round counter increments correctly
- [ ] Game can be ended by manager
- [ ] All state changes broadcasted in real-time

---

## 📞 Next Command to Run

**First, let's verify the current state**:

```powershell
cd C:\Users\galbenar\Sound-Clash

# Check database status
python backend/song-management/scripts/check_schema.py
```

This will tell us:
- ✅ If tables exist
- ✅ If songs are loaded
- ✅ How many songs we have
- ✅ What genres exist

Then we'll know exactly where to continue from!
