# Sound Clash - Simplified Task Breakdown

## Current Status: Task 2.5 - Frontend Gameplay Interface

**Completed**: 
- ✅ Infrastructure (VPC, ECS, RDS, Security Groups)
- ✅ Database connectivity and song management
- ✅ Game state system (complete backend)
- ✅ WebSocket service (real-time communication)
- ✅ Buzzer logic and scoring
- ✅ Song selection from database

**Current Goal**: Build React frontend for teams, manager, and spectators

<<<<<<< Updated upstream
## Task 2.5: Frontend Gameplay Interface (Days 1-4)

**Goal**: Build complete UI for playing the social verbal buzzer game

### Day 1: Team Gameplay Interface (Core Components)

**Morning: Basic Team Screen Setup**
1. Create Team Gameplay Page Structure
   - WebSocket connection hook (`useWebSocket.ts`)
   - Game state management hook (`useGameState.ts`)
   - Main TeamGameplay.tsx page component
   - Connect to WebSocket: `ws://<ALB>/ws/game/{code}?role=team&teamName={name}`

2. Build Buzzer Button Component
   - Large, prominent button for buzzing
   - Three states:
     - **Enabled**: Green, "BUZZ!" text, clickable
     - **Disabled (locked)**: Gray, "Buzzer Locked" text
     - **You buzzed**: Yellow, "You buzzed first!" feedback
   - Send `buzz_pressed` event on click
   - Disable after buzzing until manager evaluates

**Afternoon: Round Display & Feedback**
3. Create Round Info Component
   - Display current round number
   - Show available components: "Song Name | Artist" or "Song Name | Content"
   - Crossed-out locked components: "~~Song Name~~ | Artist"
   - Waiting states: "Waiting for manager to start round..."

4. Add Buzz Feedback System
   - Visual feedback when team buzzes: "You buzzed first! Say your answer!"
   - Show other team buzz: "Team X buzzed first"
   - Listen to `buzzer_locked` WebSocket event
   - Display team name who won the buzz

### Day 2: YouTube Player & Scoreboard

**Morning: YouTube Player Integration**
5. Implement YouTube Player Component
   - Embed YouTube iframe API
   - Auto-start at 5 seconds when round starts
   - Listen to `round_started` event for YouTube ID
   - Basic play/pause controls (optional for teams)
   - Responsive sizing for different screens

6. Add Scoreboard Component
   - Display all teams with current scores
   - Real-time updates on `answer_evaluated` event
   - Highlight score changes with animations (+10, +5, -2)
   - Color-coded by position (1st, 2nd, 3rd)
   - Sort by score (highest first)

**Afternoon: Game State Integration**
7. Connect WebSocket Event Handlers
   - `game_started`: Move from waiting room to playing
   - `round_started`: Show new song, enable buzzers
   - `buzzer_locked`: Disable buzzers, show who buzzed
   - `answer_evaluated`: Update scores, show points awarded
   - `round_completed`: Show round results, wait for next
   - `game_ended`: Show winner announcement

8. Testing Team Interface
   - Open multiple browser windows as different teams
   - Test buzzer locking (first team wins)
   - Verify score updates in real-time
   - Check YouTube playback works correctly

### Day 3: Manager Console

**Morning: Manager Control Panel**
9. Create Manager Console Page
   - Connect as manager: `ws://<ALB>/ws/game/{code}?role=manager`
   - YouTube player (manager sees video too)
   - Display correct answers card (song name, artist/content)
   - Round counter and game status

10. Build Evaluation Interface
   - Show team buzz notification: "Team X buzzed!"
   - Evaluation buttons (only visible when team buzzed):
     - ✓ **Approve Song Name** (+10pts)
     - ✓ **Approve Artist** or **Approve Content** (+5pts) - label changes based on genre
     - ✗ **Wrong Answer** (-2pts)
   - Send `evaluate_answer` event with approved components
   - Show which components are already locked

**Afternoon: Playback & Round Controls**
11. Add Manager Playback Controls
   - **Restart Song** button (restarts YouTube from 5 seconds)
   - Send `restart_song` event, broadcast to all clients
   - **Skip Round** button (no penalties, move to next song)
   - Send `skip_round` event

12. Implement Round Management
   - **Start Round** button (when round not started)
   - **Next Round** button (after round completes)
   - **End Game** button (announces winner)
   - Disable buttons based on game state
   - Show confirmation for ending game

### Day 4: Public Display & Polish

**Morning: Spectator Interface**
13. Build Public Display Page
   - Read-only view, no interactions
   - Connect as spectator (no team name required)
   - YouTube player (spectators see video)
   - Live scoreboard
   - Current round info
   - Buzz notifications: "Team X just buzzed!"

14. Add Winner Announcement Screen
   - Triggered on `game_ended` event
   - Show final scores sorted by rank
   - Highlight winning team (1st place)
   - Game summary: Rounds played, teams participated
   - Confetti animation or celebration effect

**Afternoon: Testing & Polish**
15. End-to-End Testing
   - Complete game flow: waiting → rounds → winner
   - Test with multiple teams and manager
   - Verify all WebSocket events working
   - Check score calculations correct

16. UI Polish & Responsiveness
   - Mobile-friendly layouts
   - Loading states and error handling
   - Smooth transitions between game states
   - Accessibility (keyboard navigation, screen readers)

## Simplified Scoring System (Verbal Answers)

**How It Works:**
1. Team buzzes and **speaks** answer out loud
2. Manager **listens** to verbal answer
3. Manager clicks buttons to approve/decline each component
4. System awards points and locks components

**Points:**
- Song name: **10 points**
- Artist/Content: **5 points**
- Wrong answer: **-2 points**
- Total possible per round: **15 points**

**Component Locking:**
- Correctly answered components are **locked**
- Locked components cannot be answered again
- Buzzers re-enable for remaining unlocked components
- Round ends when both components locked OR manager skips

=======
## Three Screen Types

### 1. Team Screen (Mobile/Tablet - One per team)
**Purpose**: Simple buzzer interface only
**Audio**: No audio (teams hear from manager's device/room speakers)

**Pages:**
- Join Page - Enter game code and team name
- Buzzer Page - Just buzzer button with minimal feedback

### 2. Manager Screen (Laptop/Desktop)
**Purpose**: Full game control and answer evaluation
**Audio**: YouTube player audio plays through room speakers

**Pages:**
- Create Game - Select genres, generate game code
- Waiting Room - See joined teams, start game
- Manager Console - Full control panel with YouTube player

### 3. Display Screen (TV/Projector - Public view)
**Purpose**: Everyone watches this screen for scoreboard and game info
**Audio**: No audio (no YouTube player, only visual information)

**Pages:**
- Pre-Game Instructions - Game code, QR code, joined teams
- Main Display - Scoreboard, round info, buzz notifications
- Winner Screen - Final scores and celebration

---

## Task 2.5: Frontend Gameplay Interface (Days 1-5)

### Day 1: Homepage & Navigation

**Morning: Main Homepage**
1. Create Landing Page (`/`)
   - Three large buttons:
     - "Join as Team" → `/team/join`
     - "Manager Console" → `/manager/create`
     - "Display Screen" → `/display/join`
   - Simple, clear navigation
   - Responsive design for all devices

2. Basic Routing Setup
   - React Router configuration
   - Route structure for all three screen types
   - Protected routes (game code validation)

**Afternoon: Team Join Flow**
3. Team Join Page (`/team/join`)
   - Input: Game code (6-digit)
   - Input: Team name (any Unicode)
   - Button: Join Game
   - Validation and error handling
   - Navigate to `/team/game/{code}` on success

4. WebSocket Connection Hook
   - `useWebSocket.ts` - Connection management
   - Connect to: `ws://<ALB>/ws/game/{code}?role=team&teamName={name}`
   - Handle connection/disconnection
   - Message parsing and event handling

### Day 2: Team Buzzer Interface

**Morning: Buzzer Component**
5. Build Buzzer Button (`BuzzerButton.tsx`)
   - Large, prominent button (full-screen or near-full)
   - Three states:
     - **Enabled**: Green, "BUZZ!" text, clickable
     - **Disabled**: Gray, "Buzzer Locked" text
     - **You buzzed**: Yellow, "You buzzed first! Say your answer!"
   - Send `buzz_pressed` event on click
   - Touch-friendly for mobile devices

6. Component Status Display
   - Show available components: "Song & Artist" or "Song & Content"
   - Real-time updates when components lock: "Song ✓ | Artist"
   - Small text above or below buzzer
   - Minimal, doesn't distract from buzzer

**Afternoon: Buzz Feedback**
7. Team Gameplay Page (`/team/game/{code}`)
   - Main page component with WebSocket integration
   - Buzzer button (large, prominent)
   - Component status text
   - Buzz feedback messages:
     - "You buzzed first! Say your answer!"
     - "Team X buzzed first"
   - Listen to `buzzer_locked` event
   - Enable/disable buzzer based on game state

8. Team Screen Testing
   - Test on mobile devices (phones, tablets)
   - Verify touch responsiveness
   - Test WebSocket reconnection
   - Multiple teams joining same game

### Day 3: Manager Console - Part 1

**Morning: Manager Setup Flow**
9. Manager Create Game Page (`/manager/create`)
   - Genre selection (checkboxes):
     - Israeli Music (Rock, Pop, Hafla, Classics)
     - Musical Styles (Rock, Pop, Hip-Hop, Electronic, Country, R&B)
     - Decades (60s-70s, 80s, 90s, 2000s, 2010s, 2020s)
     - Media/Soundtracks (Movies, TV, Disney, Video Games)
   - Button: Create Game
   - Display generated game code (large, prominent)
   - Navigate to waiting room

10. Manager Waiting Room (`/manager/lobby/{code}`)
    - Display game code prominently
    - List of joined teams (real-time updates)
    - Button: Start Game
    - WebSocket connection as manager role

**Afternoon: YouTube Player Integration**
11. YouTube Player Component (`YouTubePlayer.tsx`)
    - Embed YouTube iframe API
    - Manager can seek to any timestamp
    - Play/pause controls
    - Volume control
    - Audio plays through manager's device (room speakers)
    - Responsive sizing

12. Manager Console Page Structure (`/manager/game/{code}`)
    - Main layout with sections:
      - YouTube player (top)
      - Correct answers card
      - Evaluation panel
      - Playback controls
      - Round management
    - WebSocket connection and state management

### Day 4: Manager Console - Part 2

**Morning: Answer Evaluation Interface**
13. Correct Answers Card (`CorrectAnswersCard.tsx`)
    - Shows during round (hidden before round starts)
    - Display song name
    - Display artist OR content (label changes based on genre)
    - Component lock status: "Song ✓ | Artist available"
    - Clear, readable format

14. Evaluation Panel (`EvaluationPanel.tsx`)
    - Appears when team buzzes
    - Shows: "Team X buzzed!"
    - Evaluation buttons:
      - ✓ Approve Song Name (+10pts) - Large green button
      - ✓ Approve Artist/Content (+5pts) - Green button, label adapts
      - ✗ Wrong Answer (-2pts) - Red button
    - Send `evaluate_answer` event with approved components
    - Disable after evaluation until song restarts

**Afternoon: Playback & Round Controls**
15. Manager Playback Controls
    - **Restart Song** button - Restarts YouTube to 5 seconds
    - **Skip Round** button - Move to next song (no penalties)
    - Send `restart_song` and `skip_round` events
    - Disable/enable based on game state

16. Round Management Panel
    - **Start Round** button (when round not started)
    - **Next Round** button (after round completes)
    - **End Game** button (with confirmation dialog)
    - Round counter display: "Round 3"
    - Disable buttons appropriately

### Day 5: Display Screen

**Morning: Pre-Game Display**
17. Display Join Page (`/display/join`)
    - Input: Game code
    - Button: Join as Display
    - Navigate to `/display/join/{code}`

18. Pre-Game Instructions (`/display/join/{code}`)
    - Large game code display
    - QR code generation (links to `/team/join?code={code}`)
    - Instructions: "Scan QR or visit [URL]"
    - List of joined teams (real-time updates)
    - Waiting message: "Waiting for manager to start..."
    - Listen for `game_started` event

**Afternoon: Main Display Interface**
19. Scoreboard Component (`Scoreboard.tsx`)
    - Display all teams with scores
    - Large, readable text (for TV viewing)
    - Real-time updates on `answer_evaluated` event
    - Score change animations (+10, +5, -2)
    - Sort by score (highest first)
    - Color-coded positions (gold, silver, bronze)
    - Highlight recent changes

20. Main Display Page (`/display/game/{code}`)
    - **NO YouTube player** (no audio, no video)
    - Large scoreboard (prominent)
    - Round info section:
      - Round number: "Round 3"
      - Component status: "Song ✓ | Artist available"
    - Buzz notification (center, large):
      - "Team X just buzzed!" - Appears and fades
    - Round results (when round completes):
      - Correct song name
      - Correct artist/content
      - Disappears when next round starts

### Day 6: Winner Screen & Polish

**Morning: Winner Announcement**
21. Winner Screen (`/display/winner/{code}`)
    - Triggered on `game_ended` event
    - Final scoreboard (all teams, sorted)
    - Highlight winner with animation
    - Game summary: "Game Complete! 5 rounds played"
    - Confetti or celebration effect (react-confetti)
    - Trophy icon for winner

22. Display Screen Responsive Design
    - Optimize for TV/projector aspect ratios
    - Large text sizes (readable from distance)
    - High contrast colors
    - Smooth transitions between states

**Afternoon: Testing & Bug Fixes**
23. End-to-End Game Testing
    - Complete flow: Create → Join → Play → Winner
    - Test with 4+ teams simultaneously
    - Manager controls all game flow correctly
    - Verify audio plays from manager device only
    - Check scoreboard updates in real-time
    - Test component locking logic

24. Cross-Device Testing
    - Team screens on phones/tablets
    - Manager on laptop/desktop
    - Display on TV/large monitor
    - Different browsers (Chrome, Safari, Firefox)
    - Check WebSocket stability

### Day 7: Polish & Error Handling

**Morning: Error Handling & Edge Cases**
25. Connection Management
    - WebSocket disconnection handling
    - Reconnection logic with exponential backoff
    - Show connection status to users
    - Handle game not found errors
    - Handle duplicate team names

26. Loading States & Feedback
    - Loading spinners for all pages
    - Disable buttons during operations
    - Success/error toast notifications
    - Smooth state transitions
    - Prevent double-clicks

**Afternoon: UI Polish & Accessibility**
27. Visual Polish
    - Consistent color scheme across all screens
    - Smooth animations and transitions
    - Mobile-friendly layouts
    - Touch-friendly button sizes
    - High contrast for readability

28. Accessibility
    - Keyboard navigation support
    - Screen reader compatibility
    - ARIA labels on buttons
    - Focus indicators
    - Alt text for images

## Simplified Scoring System (Verbal Answers)

**How It Works:**
1. Team buzzes and **speaks** answer out loud
2. Manager **listens** to verbal answer
3. Manager clicks buttons to approve/decline each component
4. System awards points and locks components

**Points:**
- Song name: **10 points**
- Artist/Content: **5 points**
- Wrong answer: **-2 points**
- Total possible per round: **15 points**

**Component Locking:**
- Correctly answered components are **locked**
- Locked components cannot be answered again
- Buzzers re-enable for remaining unlocked components
- Round ends when both components locked OR manager skips

>>>>>>> Stashed changes
## Genre-Based Answer Fields

**Regular Songs:**
- Song Name (10pts) + Artist (5pts)
- Manager button: "Approve Artist"
<<<<<<< Updated upstream
=======
- Example: "One More Time" by Daft Punk
>>>>>>> Stashed changes

**Soundtrack Songs:**
- Song Name (10pts) + Content (5pts)
- Manager button: "Approve Content"
<<<<<<< Updated upstream
- Examples: Movie name, TV show, video game

System determines field type from song's genre category.

## Key UI/UX Requirements

### Team Experience
- **Clear buzzer state**: Enabled/disabled/locked visual feedback
- **Fast response**: Buzzer press registers immediately
- **Live updates**: Scores update in real-time across all clients
- **Accessible**: Large touch-friendly buttons, high contrast

### Manager Experience
- **Answer reference**: Always show correct answers for verification
- **Quick evaluation**: Large buttons for fast approve/decline
- **Control pacing**: Manager decides when to restart song or skip
- **Visual clarity**: See which components already locked

### Spectator Experience
- **Engaging view**: Can follow along with game action
- **No interactions**: Read-only, no buttons
- **Live updates**: See everything in real-time
=======
- Example: "A Whole New World" from Aladdin

System determines field type from song's genre category.

## Physical Setup in Room

```
┌─────────────────────────────────┐
│   DISPLAY SCREEN (TV/Projector) │
│                                 │
│   [SCOREBOARD]                  │
│   Team A: 45pts                 │
│   Team B: 30pts                 │
│   Team C: 25pts                 │
│                                 │
│   Round 3                       │
│   Song ✓ | Artist available     │
│                                 │
│   "Team A just buzzed!"         │
└─────────────────────────────────┘

🔊 Audio plays from Manager laptop

┌──────────────────┐              ┌──────────┐  ┌──────────┐  ┌──────────┐
│ MANAGER LAPTOP   │              │ Team A   │  │ Team B   │  │ Team C   │
│                  │              │ Phone    │  │ Tablet   │  │ Phone    │
│ [YouTube Player] │              │          │  │          │  │          │
│ Song: "..."      │              │  [BUZZ]  │  │  [BUZZ]  │  │  [BUZZ]  │
│ Artist: "..."    │              │          │  │          │  │          │
│                  │              │ Song ✓   │  │ Song ✓   │  │ Song ✓   │
│ ✓ Song  ✓ Artist │              │ Artist   │  │ Artist   │  │ Artist   │
│ ✗ Wrong          │              └──────────┘  └──────────┘  └──────────┘
└──────────────────┘
```
>>>>>>> Stashed changes

## WebSocket Event Reference

**Client → Server (Actions):**
```typescript
{
  type: "buzz_pressed",
  team_name: string
}

{
  type: "evaluate_answer",
  team_name: string,
  approved_song_name: boolean,
  approved_artist_content: boolean,
  wrong_answer: boolean
}

{
  type: "restart_song"
}

{
  type: "skip_round"
}

{
  type: "start_round"
}

{
  type: "end_game"
}
```

**Server → Client (Events):**
```typescript
{
  type: "game_started"
}

{
  type: "round_started",
  song_name: string,
  artist_or_content: string,
  youtube_id: string,
  is_soundtrack: boolean,
  round_number: number
}

{
  type: "buzzer_locked",
  team_name: string,
  timestamp: number
}

{
  type: "answer_evaluated",
  team_name: string,
  points_awarded: number,
  locked_components: {
    song_name: boolean,
    artist_content: boolean
  },
  scores: [{team_name: string, score: number}]
}

{
  type: "round_completed",
  correct_song: string,
  correct_artist_content: string
}

{
  type: "game_ended",
  winner: string,
  final_scores: [{team_name: string, score: number}],
  rounds_played: number
}
```

## File Structure

```
frontend/src/
├── pages/
<<<<<<< Updated upstream
│   ├── TeamGameplay.tsx      # Team player view
│   ├── ManagerConsole.tsx    # Manager controls
│   └── PublicDisplay.tsx     # Spectator view
│
├── components/
│   ├── YouTubePlayer.tsx     # Embedded YouTube player
│   ├── BuzzerButton.tsx      # Buzzer button with states
│   ├── Scoreboard.tsx        # Live score display
│   ├── RoundInfo.tsx         # Current round information
│   ├── WaitingRoom.tsx       # Pre-game lobby
│   ├── EvaluationPanel.tsx   # Manager evaluation buttons
│   └── WinnerAnnouncement.tsx # Game end screen
│
├── hooks/
│   ├── useWebSocket.ts       # WebSocket connection management
│   ├── useGameState.ts       # Game state management
│   └── useYouTubePlayer.ts   # YouTube player controls
│
└── types/
    └── game.types.ts         # TypeScript interfaces
=======
│   ├── HomePage.tsx              # Main navigation (3 buttons)
│   │
│   ├── team/
│   │   ├── TeamJoin.tsx          # Enter game code + team name
│   │   └── TeamGameplay.tsx      # Buzzer interface
│   │
│   ├── manager/
│   │   ├── ManagerCreate.tsx     # Create game + select genres
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

## URL Structure

```
Homepage:
- / (three buttons: Team, Manager, Display)

Team Screens:
- /team/join
- /team/game/{gameCode}

Manager Screens:
- /manager/create
- /manager/lobby/{gameCode}
- /manager/game/{gameCode}

Display Screens:
- /display/join
- /display/join/{gameCode} (pre-game instructions)
- /display/game/{gameCode}
- /display/winner/{gameCode}
>>>>>>> Stashed changes
```

## Testing Strategy

<<<<<<< Updated upstream
**Local Development:**
- Use mock WebSocket data for component development
- Test individual components in isolation
=======
**Component Testing:**
- Test each component in isolation with Storybook
- Mock WebSocket data for development
>>>>>>> Stashed changes
- Verify UI states and transitions

**Integration Testing:**
- Connect to real WebSocket service via ALB
<<<<<<< Updated upstream
- Open multiple browser windows (3-4 teams + manager)
- Complete full game flow: waiting → 3 rounds → winner
- Verify real-time updates across all clients

**Edge Cases to Test:**
- Multiple teams buzzing simultaneously (first wins)
- Manager skipping rounds
- Partial answers (song correct, artist wrong)
- One team answering multiple components
- Network disconnection and reconnection
=======
- Test complete game flow
- Multiple browser windows (4 teams + manager + display)
- Verify real-time synchronization

**Device Testing:**
- Team screens: iPhone, Android phones, tablets
- Manager: Laptop (Chrome, Safari, Firefox)
- Display: TV browser, Chrome on computer connected to projector

**Edge Cases:**
- Multiple teams buzzing simultaneously
- Network disconnection/reconnection
- Manager skipping rounds
- Partial answers (song correct, artist wrong)
- Game ending mid-round

## Key UI/UX Requirements

### Team Screen
- **Minimal**: Just buzzer + component status
- **Fast**: Instant button response
- **Clear**: Obvious enabled/disabled states
- **Touch-friendly**: Large button, easy to tap

### Manager Screen
- **Complete control**: All game actions available
- **Quick evaluation**: Large approve/decline buttons
- **Clear reference**: Always show correct answers during round
- **YouTube control**: Can seek, restart, skip

### Display Screen
- **Prominent scoreboard**: Main focus, always visible
- **Large text**: Readable from across room
- **Real-time updates**: Immediate score changes
- **Engaging**: Animations, notifications, celebrations
>>>>>>> Stashed changes

## Removed Complexity

❌ **No typed answer inputs** - All verbal, manager evaluates
❌ **No automatic timeouts** - Manager controls pacing
❌ **No difficulty levels** - Fixed 15pt scoring
❌ **No answer validation** - Manager decides correctness
❌ **No timer countdowns** - Manager-driven flow
<<<<<<< Updated upstream
=======
❌ **No audio on display screen** - Only manager has audio
❌ **No video on display screen** - Only scoreboard and info
>>>>>>> Stashed changes

## Next Steps After Task 2.5

**Task 2.6**: Admin Interface for Song Management
- CRUD interface for adding/editing songs
- Genre assignment interface
- Bulk import from CSV
- Song preview and testing

**Task 2.7**: Game History & Statistics
- Save completed games to database
- View past game results
- Team statistics over time
- Popular songs analytics

All tasks follow the simplified social verbal gameplay approach with manager-driven evaluation.
