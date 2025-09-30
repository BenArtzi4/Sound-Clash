# Sound Clash - Simplified Project Structure (Updated)

## Project Overview

Building an AWS-native multi-room pop culture buzzer game where teams compete to identify songs and artists/content. This is a **social verbal game** where teams speak their answers and the manager evaluates them in real-time. **SIMPLIFIED VERSION** - no AI selection, no heatmap processing, fixed 5-second start time for all songs.
<<<<<<< Updated upstream
=======

## Three Screen Types

The application has three distinct screen types for different roles:

### 1. Team Screen (Mobile/Tablet)
**Purpose**: Simple buzzer interface for each team
**Device**: One mobile device per team
**Audio**: No audio (teams hear from manager's device)
**Pages**:
- Join Page - Enter game code and team name
- Buzzer Page - Large buzzer button with minimal feedback

### 2. Manager Screen (Laptop/Desktop)
**Purpose**: Full game control and answer evaluation
**Device**: Manager's laptop/desktop
**Audio**: YouTube player audio through room speakers
**Pages**:
- Create Game - Select genres, generate code
- Waiting Room - See teams, start game
- Manager Console - YouTube player, evaluation, controls

### 3. Display Screen (TV/Projector)
**Purpose**: Public view everyone watches
**Device**: Large TV or projector
**Audio**: No audio (no YouTube player)
**Pages**:
- Pre-Game - Game code, QR code, joined teams
- Main Display - Scoreboard, round info, notifications
- Winner Screen - Final scores, celebration
>>>>>>> Stashed changes

## Simplified Game Logic

### Song System
- **Fixed Start Time**: All songs start at 5 seconds
- **No Difficulty Levels**: Single difficulty for all songs
- **Simple Selection**: Random selection from filtered genres
- **Basic Metadata**: Title, Artist (or Content for soundtracks), YouTube ID, Genres only
- **Genre-Based Answer Fields**: 
  - Regular songs: Song Name + Artist
  - Soundtrack songs: Song Name + Content (movie/TV/show)

### Scoring System (Verbal Answers)
- **Fixed Points**: Song name (10 pts), Artist/Content (5 pts)
- **No Difficulty Multipliers**: Same points for all songs
- **Total Possible**: 15 points per round (not 20)
- **Penalties**: Wrong answer (-2 pts)
- **No Timeouts**: Manager controls game pace

### Answer Mechanism
- **Verbal Answers**: Teams speak out loud, manager listens
- **Manager Evaluation**: Manager clicks buttons to approve/decline
- **Component Locking**: Each correct answer locks that component
- **Multiple Attempts**: Buzzers re-enable after evaluation until all components locked
- **Multiple Components**: Teams can answer both in one buzz if they know them

### Game Flow Detailed

**1. Pre-Game (Waiting Room)**
<<<<<<< Updated upstream
- Manager creates game, selects genres
- Teams join via game code
- Manager sees all joined teams
- Manager starts game when ready

**2. Round Start**
- Manager clicks "Start Round"
- System randomly selects song from chosen genres
- Manager sees correct answers (for reference)
- Song loads, starts at 5 seconds
- All team buzzers enabled

**3. Buzz Cycle** (Repeats until round complete)
- Song playing, all teams can buzz
- First team to buzz → **All buzzers lock**
- Manager screen shows: "Team X buzzed!"
- Team X **speaks** their answer(s)
- Manager evaluates:
  - ✓ Approve Song Name → +10pts to Team X, locks song name
  - ✓ Approve Artist/Content → +5pts to Team X, locks artist/content
  - ✗ Wrong Answer → -2pts to Team X, nothing locked
- Manager clicks "Restart Song" when ready
- Song restarts from 5 seconds
- Buzzers re-enable (for remaining unlocked components)
=======
- Manager creates game on manager screen, selects genres
- Display screen shows game code with QR code
- Teams scan QR or manually enter code on their phones
- All screens show joined teams in real-time
- Manager starts game when ready

**2. Round Start**
- Manager clicks "Start Round" on manager console
- System randomly selects song from chosen genres
- Manager sees correct answers (for reference)
- Song loads in manager's YouTube player, starts at 5 seconds
- Audio plays through room speakers from manager's device
- All team buzzers enabled on team screens
- Display screen shows round info and scoreboard

**3. Buzz Cycle** (Repeats until round complete)
- Song playing from manager's device
- All teams see enabled buzzer on their screens
- First team to buzz → **All buzzers lock**
- Display screen shows: "Team X just buzzed!"
- Team screens show: "You buzzed!" or "Team X buzzed first"
- Manager screen shows: "Team X buzzed!"
- Team X **speaks** their answer(s) out loud
- Manager evaluates on manager console:
  - ✓ Approve Song Name → +10pts to Team X, locks song name
  - ✓ Approve Artist/Content → +5pts to Team X, locks artist/content
  - ✗ Wrong Answer → -2pts to Team X, nothing locked
- Display screen scoreboard updates immediately
- Team screens show updated component status: "Song ✓ | Artist"
- Manager clicks "Restart Song" when ready
- Song restarts from 5 seconds on manager's YouTube player
- Buzzers re-enable on team screens (for remaining unlocked components)
>>>>>>> Stashed changes
- Repeat buzz cycle

**4. Round End**
Round ends when:
- Both components locked (song + artist/content), OR
- Manager clicks "Skip Round" (no penalties)

<<<<<<< Updated upstream
**5. Next Round or Game End**
- Manager clicks "Next Round" → New song selected, repeat
- Manager clicks "End Game" → Winner announced (highest score)
=======
Display screen shows correct answers when round completes.

**5. Next Round or Game End**
- Manager clicks "Next Round" → New song selected, repeat
- Manager clicks "End Game" → All screens show winner announcement

### Physical Room Setup

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

**Game State (In-Memory for now, DynamoDB later):**
```
active_games: {
  gameCode: string,
  state: "waiting" | "playing" | "finished",
  teams: [{name, score}],
  current_round: {
    song_id: int,
    song_name: string,
    artist_or_content: string,
    youtube_id: string,
    is_soundtrack: boolean,
    locked_components: {
      song_name: boolean,
      artist_content: boolean
    }
  },
  rounds_played: int
}
```

## Current Implementation Status

✅ **Infrastructure**: VPC, ECS, RDS, Security Groups - All working
✅ **Database Connectivity**: Song Management Service connects to PostgreSQL
✅ **Basic Service**: Health checks and status endpoints working
✅ **Game State System**: Complete backend game flow implemented
✅ **WebSocket Service**: Real-time communication working
✅ **Song Selection**: Random selection from genres, excludes played songs
✅ **Buzzer Logic**: First team locks, evaluation, component locking
✅ **Scoring**: +10/+5/-2 points, winner determination
⏳ **Current Task**: Build frontend gameplay interface (Task 2.5)

## Next Task: Frontend Gameplay Interface (Task 2.5)

<<<<<<< Updated upstream
**Goal**: Build React UI for teams, manager, and spectators to play the game

### Components to Build

**1. Team Gameplay Screen** (`TeamGameplay.tsx`)
- YouTube player embed (displays current song)
- Large buzzer button (enabled when unlocked, disabled when locked)
- Round info: Which components still available
- Visual feedback: "You buzzed first!" or "Team X buzzed first"
- Live scoreboard showing all teams
- Waiting states: "Waiting for manager to start round"

**2. Manager Console** (`ManagerConsole.tsx`)
- YouTube player (manager sees video too)
- Correct answers display card (song name, artist/content shown to manager)
- Team buzz notification: "Team X buzzed!"
- Evaluation buttons:
  - ✓ Approve Song Name (+10pts)
  - ✓ Approve Artist/Content (+5pts) - label changes based on genre
  - ✗ Wrong Answer (-2pts)
- Playback controls:
  - Restart Song (restarts from 5 seconds)
  - Skip Round (moves to next song, no penalties)
- Round management:
  - Start Round (selects random song, starts playback)
  - Next Round (after round complete)
  - End Game (announces winner)
- Live scoreboard with all teams
- Round counter (rounds played so far)

**3. Public Display** (`PublicDisplay.tsx`)
- Read-only spectator view
- YouTube player (spectators see video)
- Current round info (which song playing)
- Live scoreboard
- Buzz notifications: "Team X just buzzed!"
- Round results as they happen
=======
**Goal**: Build React UI for three screen types

### Screen Type 1: Team Screen

**Team Join Page** (`/team/join`)
- Input field: Game code (6-digit)
- Input field: Team name (any Unicode)
- Button: Join Game
- Simple, mobile-friendly layout

**Team Buzzer Page** (`/team/game/{code}`)
- Large BUZZ button (fills most of screen)
- Button states:
  - Enabled: Green, "BUZZ!", clickable
  - Disabled: Gray, "Buzzer Locked"
  - You buzzed: Yellow, "You buzzed first! Say your answer!"
  - Other buzzed: Gray, "Team X buzzed first"
- Component status (small text): "Song & Artist" or "Song ✓ | Artist"
- **NO scoreboard** (teams look at display screen)
- **NO YouTube player**
- **NO round counter**
- WebSocket connection to receive game events

### Screen Type 2: Manager Screen

**Manager Create Page** (`/manager/create`)
- Genre selection checkboxes:
  - Israeli Music (Rock, Pop, Hafla, Classics)
  - Musical Styles (Rock, Pop, Hip-Hop, Electronic, Country, R&B)
  - Decades (60s-70s, 80s, 90s, 2000s, 2010s, 2020s)
  - Media/Soundtracks (Movies, TV, Disney, Video Games)
- Button: Create Game
- Display: Generated game code (large, prominent)

**Manager Waiting Room** (`/manager/lobby/{code}`)
- Display game code
- List of joined teams (real-time)
- Button: Start Game
- Simple, clear layout

**Manager Console** (`/manager/game/{code}`)
- **YouTube Player** (top section)
  - Full player controls (seek, play, pause, volume)
  - Audio plays through manager's device to room speakers
- **Correct Answers Card** (shows during round only)
  - Song Name: "..."
  - Artist/Content: "..." (label changes based on genre)
  - Component lock status: "Song ✓ | Artist available"
- **Buzz Notification** (prominent when team buzzes)
  - "Team X buzzed!"
- **Evaluation Buttons** (appear when team buzzed)
  - ✓ Approve Song Name (+10pts) - Large green
  - ✓ Approve Artist/Content (+5pts) - Green, label adapts
  - ✗ Wrong Answer (-2pts) - Red
- **Playback Controls**
  - Button: Restart Song (restarts to 5 seconds)
  - Button: Skip Round (no penalties)
- **Round Management**
  - Button: Start Round
  - Button: Next Round
  - Button: End Game (with confirmation)
  - Display: Round counter "Round 3"
- **NO scoreboard** (manager looks at display screen)

### Screen Type 3: Display Screen

**Display Join Page** (`/display/join`)
- Input: Game code
- Button: Join as Display
- Navigate to pre-game screen

**Display Pre-Game** (`/display/join/{code}`)
- Large game code display
- QR code (links to `/team/join?code={code}`)
- Instructions: "Scan QR or visit [URL] and enter code: XXXX"
- List of joined teams (real-time updates)
- Waiting message: "Waiting for manager to start game..."

**Display Main Screen** (`/display/game/{code}`)
- **NO YouTube player** (no video, no audio)
- **Live Scoreboard** (large, prominent - main focus)
  - All teams with current scores
  - Sorted by score (highest first)
  - Score change animations (+10, +5, -2)
  - Color-coded positions (gold, silver, bronze)
  - Large, TV-readable text
- **Round Info Section**
  - Round number: "Round 3"
  - Component status: "Song ✓ | Artist available" or "Song & Content"
- **Buzz Notification** (center, large, temporary)
  - "Team X just buzzed!" (appears and fades)
- **Round Results** (when round completes)
  - Correct song name
  - Correct artist/content
  - Stays visible until next round starts

**Display Winner Screen** (`/display/winner/{code}`)
- Final scoreboard (all teams)
- Highlight winner (1st place)
- Game summary: "Game Complete! 5 rounds played"
- Confetti or celebration animation
- Trophy icon for winner
>>>>>>> Stashed changes

### Simplified Genre Categories (No Hierarchies)

**4 Main Categories:**
1. **Israeli Music**: Israeli Rock, Israeli Pop, Hafla, Israeli Classics
2. **Musical Styles**: Rock, Pop, Hip-Hop, Electronic, Country, R&B
3. **Decades**: 60s-70s, 80s, 90s, 2000s, 2010s, 2020s
4. **Media (Soundtracks)**: Movie Soundtracks, TV Themes, Disney, Video Games

**Important**: When genre is from Media/Soundtracks category:
- "Artist" field becomes "Content" (movie/TV name)
- Manager button says "Approve Content" instead of "Approve Artist"

### WebSocket Integration

**Connection URL:**
```
<<<<<<< Updated upstream
ws://<ALB-DNS>/ws/game/{gameCode}?role={team|manager}&teamName={name}
=======
ws://<ALB-DNS>/ws/game/{gameCode}?role={team|manager|display}&teamName={name}
>>>>>>> Stashed changes
```

**Events to Listen For:**
- `game_started` - Game moved from waiting to playing
- `round_started` - New song selected, YouTube info provided
- `buzzer_locked` - First team buzzed, show which team
- `answer_evaluated` - Manager approved/declined, scores updated
- `round_completed` - Both components locked or round skipped
- `game_ended` - Winner announced

**Actions to Send:**
- `buzz_pressed` - Team pressed buzzer
- `evaluate_answer` - Manager approved/declined components
- `restart_song` - Manager restarts playback
- `skip_round` - Manager moves to next song
- `start_round` - Manager starts new round
- `end_game` - Manager ends game

### YouTube Integration (Simplified)

- **Fixed Start**: Always start at 5 seconds
<<<<<<< Updated upstream
- **Manager Controls**: Manager can restart song, skip round
- **Sync**: All clients receive same YouTube ID and start time
- **Basic Player**: Just play/pause/stop controls via iframe API
=======
- **Manager Only**: Only manager screen has YouTube player
- **Audio Source**: Manager's device plays audio to room speakers
- **Sync**: All clients receive same YouTube ID and start time via WebSocket
- **Basic Player**: Manager has full controls (seek, play, pause, volume)
>>>>>>> Stashed changes

## Removed Complexity

❌ **No AI-driven selection algorithms**
❌ **No heatmap processing or analysis**
❌ **No difficulty-based timestamps**
❌ **No machine learning components**
❌ **No complex song recommendation systems**
❌ **No YouTube API heatmap integration**
❌ **No typed answer submissions** (replaced with verbal + manager evaluation)
❌ **No automatic timeouts** (manager controls pacing)
<<<<<<< Updated upstream
=======
❌ **No YouTube player on display screen** (only scoreboard and info)
❌ **No YouTube player on team screens** (only buzzer)
>>>>>>> Stashed changes

## File Structure (Updated)

```
backend/
├── song-management/
│   ├── api/
│   │   ├── songs.py          # Basic CRUD endpoints
│   │   ├── genres.py         # Simple genre management
│   │   └── selection.py      # Random song selection
│   ├── models/
│   │   ├── song_models.py    # Pydantic models
│   │   └── db_models.py      # SQLAlchemy models
│   └── services/
│       ├── song_service.py   # Basic business logic
│       └── genre_service.py  # Genre operations
│
└── websocket-service/
    ├── main_complete.py      # WebSocket + REST API
    ├── models/
    │   └── game_state.py     # Game state definitions
    └── services/
        ├── song_selector.py  # Communicates with Song API
        └── round_manager.py  # Game logic, buzzer, scoring

frontend/src/
├── pages/
<<<<<<< Updated upstream
│   ├── TeamGameplay.tsx      # Team player view (TO BUILD)
│   ├── ManagerConsole.tsx    # Manager controls (TO BUILD)
│   └── PublicDisplay.tsx     # Spectator view (TO BUILD)
├── components/
│   ├── YouTubePlayer.tsx     # Embedded player (TO BUILD)
│   ├── BuzzerButton.tsx      # Press to buzz (TO BUILD)
│   ├── Scoreboard.tsx        # Live scores (TO BUILD)
│   ├── RoundInfo.tsx         # Current round display (TO BUILD)
│   └── WaitingRoom.tsx       # Pre-game lobby (TO BUILD)
└── hooks/
    ├── useWebSocket.ts       # WebSocket connection (TO BUILD)
    └── useGameState.ts       # Game state management (TO BUILD)
```

This simplified approach focuses on core functionality with social verbal gameplay where managers evaluate spoken answers in real-time.
=======
│   ├── HomePage.tsx              # Main navigation (3 buttons)
│   │
│   ├── team/
│   │   ├── TeamJoin.tsx          # Enter game code + team name
│   │   └── TeamGameplay.tsx      # Buzzer interface
│   │
│   ├── manager/
│   │   ├── ManagerCreate.tsx     # Create game + genres
│   │   ├── ManagerLobby.tsx      # Waiting room
│   │   └── ManagerConsole.tsx    # Full control panel
│   │
│   └── display/
│       ├── DisplayJoin.tsx       # Enter game code
│       ├── DisplayLobby.tsx      # Pre-game instructions
│       ├── DisplayGame.tsx       # Main display (scoreboard)
│       └── DisplayWinner.tsx     # Winner announcement
│
├── components/
│   ├── BuzzerButton.tsx          # Team buzzer with states
│   ├── YouTubePlayer.tsx         # Manager's YouTube player
│   ├── Scoreboard.tsx            # Display scoreboard
│   ├── CorrectAnswersCard.tsx    # Manager's answer reference
│   ├── EvaluationPanel.tsx       # Manager evaluation buttons
│   ├── RoundInfo.tsx             # Display round information
│   ├── BuzzNotification.tsx      # Display buzz alerts
│   └── QRCodeGenerator.tsx       # Display pre-game QR
│
├── hooks/
│   ├── useWebSocket.ts           # WebSocket connection
│   ├── useGameState.ts           # Game state management
│   └── useYouTubePlayer.ts       # YouTube player controls
│
└── types/
    └── game.types.ts             # TypeScript interfaces
```

This simplified approach focuses on core functionality with social verbal gameplay where managers evaluate spoken answers in real-time. Each screen type has a specific purpose: teams buzz, managers control and evaluate, display shows scoreboard for everyone.
>>>>>>> Stashed changes
