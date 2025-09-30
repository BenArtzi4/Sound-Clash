# Task 2.4 - Game State Transitions: REVISED Implementation Plan

## 🎯 What is Task 2.4 About?

**Goal**: Implement complete gameplay from waiting room → playing → finished

**Core Features**:
1. **Song playback** from YouTube (starts at 5 seconds)
2. **Buzzer system** - first team to buzz gets to answer
3. **Answer submission** - song name, artist, movie/TV
4. **Scoring system** - Manager awards points (10+5+5 = 20 max)
5. **Round progression** - Multiple rounds until game ends
6. **Winner determination** - Highest score wins

---

## 📊 Current State Analysis

### ✅ What We Already Have
- **Database connection**: `postgres.py` with `SongRepository` and `GenreRepository`
- **Sample data**: 120+ songs in `data/sample/songs_converted.csv`
- **Existing tables**: `songs_master`, `genres`, `song_genres` (based on postgres.py)
- **WebSocket infrastructure**: Real-time team communication working
- **Game Management**: Team joining and waiting room complete

### ❌ What's Missing
- Songs are NOT yet loaded into RDS database
- No song selection API endpoints
- No game state transitions (start game, next round, end game)
- No gameplay frontend pages
- No buzzer system
- No scoring/evaluation system

---

## 🔄 Revised 5-Phase Plan

### **Phase 1: Database Setup & Song Loading** (Day 1)
**NO new tables needed! Use existing schema from postgres.py**

**Tasks**:
1. Verify existing database schema (songs_master, genres, song_genres exist)
2. Create data loading script for CSV → PostgreSQL
3. Load 120+ songs from `songs_converted.csv`
4. Verify genre assignments

**Files to Create**:
```
backend/song-management/
├── scripts/
│   ├── check_schema.py (NEW - verify tables exist)
│   └── load_songs.py (NEW - import CSV data)
```

**Database Tables** (Already Exist - DON'T CREATE):
```sql
-- These should already exist based on postgres.py:
songs_master (id, title, artist, youtube_id, duration_seconds, is_active, ...)
genres (id, name, slug, category, is_active, ...)
song_genres (song_id, genre_id)
```

**Genres from CSV**:
- rock, pop, hip-hop, electronic, soundtracks
- mizrahit, israeli-rock-pop, israeli-pop, israeli-rap-hip-hop, israeli-cover
- alternative rock

---

###  **Phase 2: Song Selection API** (Day 2)
**Use existing SongRepository class**

**Tasks**:
1. Create API endpoints using existing `postgres.py` functions
2. Add song selection endpoint (random from genres)
3. Test with existing data

**Files to Create/Modify**:
```
backend/song-management/
├── api/
│   ├── __init__.py (NEW)
│   ├── songs.py (NEW - CRUD endpoints)
│   └── selection.py (NEW - Random selection)
└── main.py (UPDATE - add routes)
```

**Endpoints to Add**:
```python
GET  /api/songs - List songs (uses SongRepository.get_all_songs)
GET  /api/songs/{id} - Get song (uses SongRepository.get_song_by_id)
GET  /api/songs/genres - List genres (uses GenreRepository)
POST /api/songs/select - Random selection (uses SongRepository.get_songs_by_genres)
```

**Test Script**:
```powershell
# Test selection
curl -X POST http://localhost:8001/api/songs/select \
  -H "Content-Type: application/json" \
  -d '{"genres": ["rock", "pop"], "exclude_ids": []}'
```

---

### **Phase 3: Game State Transitions** (Days 3-4)
**Add round management to WebSocket service**

**Tasks**:
1. Add game states: `playing`, `round_active`, `round_scoring`, `finished`
2. Integrate song selection when round starts
3. Broadcast song info to all clients
4. Track round progression

**Files to Modify**:
```
backend/websocket-service/main_simple.py
  - Add round_manager.py logic
  - Add song selection integration
  - Add state transition broadcasting

backend/game-management/main.py
  - Add /api/games/{code}/start endpoint
  - Add /api/games/{code}/next-round endpoint
```

**New WebSocket Messages**:
```python
{
  "type": "game_started",
  "message": "Game is starting!",
  "total_rounds": 10
}

{
  "type": "round_started",
  "round_number": 1,
  "song": {
    "id": 5,
    "title": "Bohemian Rhapsody",
    "artist": "Queen",
    "youtube_id": "fJ9rUzIMcZQ"
  }
}

{
  "type": "round_ended",
  "round_number": 1,
  "scores": {...}
}
```

---

### **Phase 4: Buzzer & YouTube Player** (Days 5-6)
**Frontend gameplay implementation**

**Tasks**:
1. Create GamePlayPage with YouTube player
2. Implement buzzer button (large, prominent)
3. Create answer submission form
4. Handle buzzer locking (first team locks out others)

**Files to Create**:
```
frontend/src/
├── pages/game/
│   └── GamePlayPage.tsx (NEW)
├── components/game/
│   ├── YouTubePlayer.tsx (NEW)
│   ├── BuzzerButton.tsx (NEW)
│   └── AnswerForm.tsx (NEW)
└── hooks/
    └── useGamePlay.ts (NEW)
```

**Buzzer Logic**:
1. Song starts playing from 5-second mark
2. Teams can buzz anytime during playback
3. First team to buzz gets locked in
4. Other teams see "Team X buzzed first!"
5. Buzzing team has 10 seconds to submit answer
6. Timeout = -2 points

---

### **Phase 5: Scoring & Winner** (Days 7-8)
**Manager evaluation and game completion**

**Tasks**:
1. Manager evaluation interface
2. Point calculation (Song: 10, Artist: 5, Movie/TV: 5)
3. Real-time scoreboard updates
4. Game completion and winner announcement

**Files to Create**:
```
frontend/src/
├── pages/manager/
│   ├── RoundEvaluationPage.tsx (NEW)
│   └── GameSummaryPage.tsx (NEW)
├── components/game/
│   ├── Scoreboard.tsx (NEW)
│   └── WinnerAnnouncement.tsx (NEW)
└── pages/game/
    └── GameResultsPage.tsx (NEW)
```

**Scoring System**:
- Correct song name: **+10 points**
- Correct artist: **+5 points**
- Correct movie/TV: **+5 points**
- Buzzer timeout: **-2 points**
- Wrong answer: **0 points**
- Max per round: **20 points**

---

## 🚀 Deployment Steps

### Phase 1 Deployment (Database Setup)
```powershell
# 1. Check if tables exist
python backend/song-management/scripts/check_schema.py

# 2. Load songs from CSV
python backend/song-management/scripts/load_songs.py

# 3. Verify data loaded
curl http://localhost:8001/api/songs/test-data
```

### Phase 2 Deployment (Song API)
```powershell
cd backend/song-management

# Build and push
docker build -t song-management .
docker tag song-management:latest 381492257993.dkr.ecr.us-east-1.amazonaws.com/sound-clash-song-management:latest
docker push 381492257993.dkr.ecr.us-east-1.amazonaws.com/sound-clash-song-management:latest

# Deploy
aws ecs update-service --cluster sound-clash-cluster --service song-management --force-new-deployment --region us-east-1
```

### Phase 3-5 Deployment (Game Logic & Frontend)
```powershell
# Backend services
cd backend/websocket-service
docker build -t websocket-service .
docker push 381492257993.dkr.ecr.us-east-1.amazonaws.com/sound-clash-websocket:latest
aws ecs update-service --cluster sound-clash-cluster --service websocket-service --force-new-deployment --region us-east-1

cd backend/game-management
docker build -t game-management .
docker push 381492257993.dkr.ecr.us-east-1.amazonaws.com/sound-clash-game-management:latest
aws ecs update-service --cluster sound-clash-cluster --service game-management --force-new-deployment --region us-east-1

# Frontend
cd frontend
npm run build
aws s3 sync dist/ s3://sound-clash-frontend-381492257993-us-east-1/ --delete
```

---

## 📝 Key Differences from Original Plan

### What Changed:
1. **NO new database tables** - using existing `songs_master`, `genres`, `song_genres`
2. **Use existing SongRepository** - don't recreate database access code
3. **Load from CSV** - 120+ songs ready to import
4. **Simplified genres** - using genres from CSV (not creating new ones)

### What Stayed the Same:
- 5-phase implementation structure
- WebSocket-based real-time communication
- Fixed 5-second song start time
- Fixed scoring system (10+5+5)
- Buzzer locking mechanism
- Manager evaluation flow

---

## 🎮 Game Flow Example

```
1. Manager creates game → teams join (DONE ✅)
2. Manager clicks "Start Game"
   → WebSocket broadcasts: game_started
3. Round 1 begins:
   → Song selected from chosen genres
   → YouTube player loads, starts at 5 seconds
   → Buzzer enabled for all teams
4. Team A buzzes first:
   → Other teams' buzzers disabled
   → Team A gets answer form
   → 10-second countdown starts
5. Team A submits: "Bohemian Rhapsody, Queen, Wayne's World"
   → Manager sees answers
   → Manager marks: Song ✓ (10), Artist ✓ (5), Movie ✓ (5)
   → Team A gets +20 points
   → Scoreboard updates
6. Next round starts (repeat 3-5)
7. After 10 rounds:
   → Game ends
   → Winner announced
   → Results saved to database
```

---

## ✅ Success Criteria

- [ ] 120+ songs loaded into RDS
- [ ] Song selection API working
- [ ] Manager can start game
- [ ] YouTube player starts at 5 seconds
- [ ] Buzzer locks after first press
- [ ] Scoring system calculates correctly
- [ ] Scoreboard updates in real-time
- [ ] Winner announced at end
- [ ] Multiple games can run simultaneously

---

## 📌 Next Steps

1. **First, run ECR cleanup** to avoid costs
2. **Verify database schema** exists
3. **Load songs from CSV**
4. **Start Phase 1 implementation**

Ready to begin? Let me know if you want me to create the specific scripts for Phase 1!
