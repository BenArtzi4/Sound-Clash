# Sound Clash - Simplified Project Structure (Updated)

## Project Overview

Building an AWS-native multi-room pop culture buzzer game where teams compete to identify songs, artists, and movies/TV shows. **SIMPLIFIED VERSION** - no AI selection, no heatmap processing, fixed 5-second start time for all songs.

## Simplified Game Logic

### Song System
- **Fixed Start Time**: All songs start at 5 seconds
- **No Difficulty Levels**: Single difficulty for all songs
- **Simple Selection**: Random selection from filtered genres
- **Basic Metadata**: Title, Artist, YouTube ID, Genres only

### Scoring System
- **Fixed Points**: Song name (10 pts), Artist (5 pts), Movie/TV (5 pts)
- **No Difficulty Multipliers**: Same points for all songs
- **Total Possible**: 20 points per song

### Database Schema (Simplified)

**PostgreSQL Tables:**
```sql
-- Songs table (simple)
songs: id, title, artist, youtube_id, created_at, updated_at, is_active

-- Genres table (basic categories)
genres: id, name, slug, category, is_active

-- Song-Genre relationship
song_genres: song_id, genre_id

-- Game history (optional for later)
game_history: game_id, songs_played, teams, winner, created_at
```

**DynamoDB Tables** (ephemeral, 4-hour TTL):
```
active_games: gameCode, teams, current_song, scores, settings
game_sessions: gameCode, roundId, song_id, buzz_winner, answers
buzz_events: gameCode, timestamp, team_name, reaction_time
```

## Next Task: Simple Song Management Implementation

### Task 2.1 Simplified: Basic Song CRUD Operations (2-3 days)

**Goal**: Implement basic song management without AI or complex selection

**Day 1: Database Schema & Models**
- Create simple PostgreSQL tables
- Implement basic SQLAlchemy models
- Add simple genre categories

**Day 2: Song CRUD API**
- Basic song endpoints (create, read, update, delete)
- Simple genre management
- Random song selection by genre

**Day 3: Frontend Integration**
- Song management admin interface
- Genre selection for games
- Testing and validation

### Simplified Genre Categories (No Hierarchies)

**4 Main Categories:**
1. **Israeli Music**: Israeli Rock, Israeli Pop, Hafla, Israeli Classics
2. **Musical Styles**: Rock, Pop, Hip-Hop, Electronic, Country, R&B
3. **Decades**: 60s-70s, 80s, 90s, 2000s, 2010s, 2020s
4. **Media**: Movie Soundtracks, TV Themes, Disney, Video Games

### Simplified Song Selection Logic

```python
def select_random_songs(genres: List[str], count: int = 1):
    # Simple random selection from filtered genres
    # No AI, no difficulty analysis, no heatmaps
    # Just: "Give me random songs from these genres"
    pass
```

### YouTube Integration (Simplified)

- **Fixed Start**: Always start at 5 seconds
- **Basic Player**: Just play/pause/stop controls
- **No Heatmap Processing**: Remove all heatmap-related code
- **Manager Control**: Simple playback control only

## Current Implementation Status

✅ **Infrastructure**: VPC, ECS, RDS, Security Groups - All working
✅ **Database Connectivity**: Song Management Service connects to PostgreSQL
✅ **Basic Service**: Health checks and status endpoints working

## Next Implementation Steps

1. **Create simple database schema**
2. **Implement basic song CRUD operations** 
3. **Add simple genre management**
4. **Create song selection API (random from genres)**
5. **Build basic admin interface for song management**

## Removed Complexity

❌ **No AI-driven selection algorithms**
❌ **No heatmap processing or analysis**
❌ **No difficulty-based timestamps**
❌ **No machine learning components**
❌ **No complex song recommendation systems**
❌ **No YouTube API heatmap integration**

## File Structure (Updated for Simplicity)

```
backend/song-management/
├── api/
│   ├── songs.py          # Basic CRUD endpoints
│   ├── genres.py         # Simple genre management
│   └── selection.py      # Random song selection
├── models/
│   ├── song_models.py    # Simplified Pydantic models (current)
│   └── db_models.py      # SQLAlchemy models (to create)
├── services/
│   ├── song_service.py   # Basic business logic
│   └── genre_service.py  # Genre operations
└── database/
    ├── connection.py     # DB connection (existing)
    └── schema.sql        # Simple table definitions
```

This simplified approach focuses on core functionality without complex AI or analysis features, making it easier to implement and maintain.
