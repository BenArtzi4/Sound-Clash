# Sound Clash - Simplified Buzzer Game Architecture

## Project Overview

Building an AWS-native multi-room pop culture buzzer game where teams compete to identify songs, artists, and movies/TV shows. **SIMPLIFIED VERSION** - no AI selection, no heatmap processing, fixed 5-second start time for all songs.

## Core Game Mechanics (Simplified)

### Song System
- **Fixed Start Time**: All songs start at 5 seconds
- **Single Difficulty**: No difficulty levels or variations
- **Simple Selection**: Random selection from filtered genres
- **Basic Metadata**: Title, Artist, YouTube ID, Genres only

### Scoring System
- **Fixed Points**: Song name (10 pts), Artist (5 pts), Movie/TV (5 pts)
- **Total Possible**: 20 points per song (no multipliers)
- **Penalties**: Timeout (-2 points), Wrong answer (0 points)

### Game Flow
1. Host creates game and selects genres
2. Teams join with any Unicode names
3. Manager selects genre for each round
4. System randomly picks song from selected genre
5. Song plays from 5-second mark
6. Teams buzz and answer within 10 seconds
7. Manager evaluates answers and awards points
8. Repeat until manager ends game

## Simplified Database Schema

**PostgreSQL (Persistent Data):**
- `songs`: id, title, artist, youtube_id, created_at, is_active
- `genres`: id, name, slug, category, is_active  
- `song_genres`: song_id, genre_id (many-to-many)
- `game_history`: game_id, songs_played, teams, winner (optional)

**DynamoDB (Ephemeral, 4-hour TTL):**
- `active_games`: gameCode, teams, current_song, scores, settings
- `game_sessions`: gameCode, roundId, song_id, buzz_winner, answers
- `buzz_events`: gameCode, timestamp, team_name, reaction_time
- `team_connections`: gameCode, teamName, connection_status

## Simplified Architecture Components

### Backend Services
1. **Game Management Service** - Game lifecycle, team joining, waiting room
2. **Song Management Service** - Basic CRUD operations, simple selection
3. **Game API Service** - Buzzer logic, scoring, music control
4. **WebSocket Service** - Real-time communication
5. **Manager Console Service** - Host interface
6. **Public Display Service** - Spectator interface

### Song Selection Logic (Simplified)
```
Random Selection Algorithm:
1. Filter songs by selected genre(s)
2. Exclude recently played songs (same game)
3. Random selection from remaining pool
4. Return song with fixed 5-second start time
```

### Genre Categories (Simplified)
- **Israeli Music**: Israeli Rock, Israeli Pop, Hafla, Israeli Classics
- **Musical Styles**: Rock, Pop, Hip-Hop, Electronic, Country, R&B
- **Decades**: 60s-70s, 80s, 90s, 2000s, 2010s, 2020s
- **Media**: Movie Soundtracks, TV Themes, Disney, Video Games

## Current Implementation Status

✅ **Infrastructure**: VPC, ECS, RDS, Security Groups working
✅ **Database Connectivity**: Song Management Service connected
✅ **Basic Endpoints**: Health checks and status operational
⏳ **Current Task**: Implement basic song CRUD operations

## Next Implementation (Task 2.1 Simplified)

**Goal**: Basic song management without AI or complex selection

**Components to Build**:
1. Simple database schema and models
2. Basic song CRUD operations
3. Simple genre management
4. Random song selection by genre
5. Basic admin interface for song management

## Removed Complexity

❌ AI-driven selection algorithms
❌ Heatmap processing or analysis  
❌ Multiple difficulty levels
❌ Difficulty-based timestamps
❌ Machine learning components
❌ Complex recommendation systems
❌ YouTube Most Replayed API integration
❌ Intelligent song analysis
❌ Dynamic point calculations

## Technology Stack (Simplified)

**Backend**: FastAPI, PostgreSQL, DynamoDB, Redis
**Frontend**: React TypeScript
**Infrastructure**: AWS ECS, ALB, RDS, VPC
**Real-time**: WebSocket connections
**Media**: YouTube iframe API (fixed 5-second start)

This simplified approach focuses on core buzzer game functionality with reliable, straightforward song management and gameplay mechanics.
