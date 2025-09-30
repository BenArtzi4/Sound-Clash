# Sound Clash - Simplified Buzzer Game Architecture

## Project Overview

Building an AWS-native multi-room pop culture buzzer game where teams compete to identify songs and artists/content. This is a **social verbal game** where teams speak their answers and the manager evaluates them in real-time. **SIMPLIFIED VERSION** - no AI selection, no heatmap processing, fixed 5-second start time for all songs.
<<<<<<< Updated upstream
=======

## Three Screen Types

The application has three distinct screen types for different roles:

### 1. Team Screen (Mobile/Tablet)
**Purpose**: Simple buzzer interface only
**Device**: One mobile device per team
**Audio**: No audio (teams hear from manager's device)

### 2. Manager Screen (Laptop/Desktop)
**Purpose**: Full game control and answer evaluation
**Device**: Manager's laptop/desktop
**Audio**: YouTube player audio through room speakers

### 3. Display Screen (TV/Projector)
**Purpose**: Public view everyone watches
**Device**: Large TV or projector
**Audio**: No audio (no YouTube player, only scoreboard and info)
>>>>>>> Stashed changes

## Core Game Mechanics (Simplified)

### Song System
- **Fixed Start Time**: All songs start at 5 seconds
- **Single Difficulty**: No difficulty levels or variations
- **Simple Selection**: Random selection from filtered genres
- **Basic Metadata**: Title, Artist (or Content for soundtracks), YouTube ID, Genres only
- **Genre-Based Fields**: Regular songs have Artist, Soundtrack songs have Content (movie/TV/show)

### Scoring System (Verbal Answer Evaluation)
- **Fixed Points**: 
  - Song name: 10 pts
  - Artist OR Content: 5 pts (depends on genre)
- **Total Possible**: 15 points per round (not 20)
- **Penalties**: Wrong answer (-2 points)
- **No Timeouts**: Manager decides when to move on

### Answer Mechanism (Social/Verbal)
- Teams **speak** their answers out loud (not typed)
- Manager **listens** and evaluates verbally given answers
- Manager has buttons to approve/decline each component
- Teams can answer multiple components in one buzz if they know them
- Each component can be answered separately across multiple buzz cycles

### Game Flow
1. Manager creates game and selects genres
2. Teams join with any Unicode names (waiting room)
3. Manager starts game
4. Manager starts round → System randomly picks song from selected genre
<<<<<<< Updated upstream
5. Song plays from 5-second mark, all buzzers enabled
=======
5. Song plays from 5-second mark on manager's YouTube player, audio through room speakers
>>>>>>> Stashed changes
6. First team buzzes → **All buzzers lock**
7. Team **speaks** answer(s) out loud
8. Manager evaluates and approves/declines each component:
   - ✓ Approve Song Name → +10pts, locks song name component
   - ✓ Approve Artist/Content → +5pts, locks artist/content component
   - ✗ Wrong Answer → -2pts, nothing locked
9. Manager clicks "Restart Song" when ready
10. Song restarts from 5 seconds, buzzers re-enable (for unlocked components)
11. Repeat buzz cycles until both components answered OR manager skips round
12. Manager starts next round or ends game

### Round Completion
A round ends when:
- **Both components locked** (song name + artist/content answered correctly), OR
- **Manager skips round** (no penalties, move to next song)

Game continues until manager manually ends it (no max rounds).

## Simplified Database Schema

**PostgreSQL (Persistent Data):**
- `songs`: id, title, artist, youtube_id, created_at, is_active
- `genres`: id, name, slug, category, is_active  
- `song_genres`: song_id, genre_id (many-to-many)
- `game_history`: game_id, songs_played, teams, winner (optional)

**DynamoDB (Ephemeral, 4-hour TTL):**
- `active_games`: gameCode, teams, current_song, scores, settings
- `game_sessions`: gameCode, roundId, song_id, locked_components, scores_this_round
- `buzz_events`: gameCode, timestamp, team_name, reaction_time
- `team_connections`: gameCode, teamName, connection_status

## Simplified Architecture Components

### Backend Services
1. **Game Management Service** - Game lifecycle, team joining, waiting room
2. **Song Management Service** - Basic CRUD operations, simple selection
3. **WebSocket Service** - Real-time communication, buzzer logic, scoring
4. **Manager Console Service** - Host interface, answer evaluation
5. **Public Display Service** - Spectator interface

### Song Selection Logic (Simplified)
```
Random Selection Algorithm:
1. Filter songs by selected genre(s)
2. Exclude recently played songs (same game)
3. Random selection from remaining pool
4. Return song with fixed 5-second start time
5. Include genre info (is_soundtrack) to determine if Artist or Content field applies
```

### Genre Categories (Simplified)
- **Israeli Music**: Israeli Rock, Israeli Pop, Hafla, Israeli Classics
- **Musical Styles**: Rock, Pop, Hip-Hop, Electronic, Country, R&B
- **Decades**: 60s-70s, 80s, 90s, 2000s, 2010s, 2020s
- **Media (Soundtracks)**: Movie Soundtracks, TV Themes, Disney, Video Games

**Important**: Soundtrack genres use "Content" (movie/TV name) instead of "Artist"
<<<<<<< Updated upstream
=======

## Physical Room Setup

```
                    ┌─────────────────────────────┐
                    │  DISPLAY SCREEN (TV)        │
                    │                             │
                    │  • Scoreboard (prominent)   │
                    │  • Round info               │
                    │  • Buzz notifications       │
                    │  • NO YouTube player        │
                    │  • NO audio                 │
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
>>>>>>> Stashed changes

## Current Implementation Status

✅ **Infrastructure**: VPC, ECS, RDS, Security Groups working
✅ **Database Connectivity**: Song Management Service connected
✅ **Basic Endpoints**: Health checks and status operational
✅ **Game State System**: Complete game flow, buzzer logic, scoring implemented
✅ **WebSocket Service**: Real-time communication working
⏳ **Current Task**: Build frontend gameplay interface (Task 2.5)

## Next Implementation (Task 2.5: Frontend Gameplay Interface)

**Goal**: Build React UI for teams, manager, and spectators

**Components to Build**:
<<<<<<< Updated upstream
1. **Team Gameplay Screen**
   - YouTube player embed (song playback)
   - Large buzzer button (enabled/disabled states)
   - Round info display (which components still available)
   - Live scoreboard
   - Visual feedback (who buzzed, waiting for evaluation)

2. **Manager Console**
   - YouTube player (manager sees video too)
   - Correct answers display (song name, artist/content)
   - Team buzz notification (which team buzzed)
   - Evaluation buttons:
     - ✓ Approve Song Name (+10pts)
     - ✓ Approve Artist/Content (+5pts)
     - ✗ Wrong Answer (-2pts)
   - Playback controls:
     - Restart Song (from 5 seconds)
     - Skip Round (no penalties)
   - Round management:
     - Start Round
     - Next Round
     - End Game
   - Live scoreboard

3. **Public Display**
   - Read-only spectator view
   - Current round info
   - Live scores
   - Who buzzed notifications
=======

1. **Team Gameplay Screen**
   - Large buzzer button (enabled/disabled states)
   - Component status display
   - Visual feedback (who buzzed)
   - NO scoreboard, NO YouTube player

2. **Manager Console**
   - YouTube player (audio to room speakers)
   - Correct answers display (song name, artist/content)
   - Team buzz notification
   - Evaluation buttons (Approve Song/Artist/Content, Wrong Answer)
   - Playback controls (Restart Song, Skip Round)
   - Round management (Start Round, Next Round, End Game)
   - NO scoreboard (manager looks at display)

3. **Public Display**
   - Live scoreboard (main focus, large text)
   - Round info (round number, component status)
   - Buzz notifications
   - Round results (correct answers)
   - NO YouTube player, NO audio
>>>>>>> Stashed changes

## Removed Complexity

❌ AI-driven selection algorithms
❌ Heatmap processing or analysis  
❌ Multiple difficulty levels
❌ Difficulty-based timestamps
❌ Machine learning components
❌ Complex recommendation systems
❌ YouTube Most Replayed API integration
❌ Intelligent song analysis
❌ Typed answer submissions (replaced with verbal + manager evaluation)
❌ Automatic timeouts (manager controls pacing)
<<<<<<< Updated upstream
=======
❌ YouTube player on display screen (only manager has it)
❌ Scoreboard on manager screen (only display has it)
>>>>>>> Stashed changes

## Technology Stack (Simplified)

**Backend**: FastAPI, PostgreSQL, DynamoDB (not used yet, in-memory for now)
**Frontend**: React TypeScript
**Infrastructure**: AWS ECS, ALB, RDS, VPC
**Real-time**: WebSocket connections
**Media**: YouTube iframe API (fixed 5-second start, manager only)

<<<<<<< Updated upstream
This simplified approach focuses on core buzzer game functionality with reliable, straightforward song management and social gameplay mechanics where managers evaluate verbal answers in real-time.
=======
This simplified approach focuses on core buzzer game functionality with reliable, straightforward song management and social gameplay mechanics where managers evaluate verbal answers in real-time. The three screen types each serve a specific purpose: teams buzz, managers control everything, display shows scores to everyone.
>>>>>>> Stashed changes
