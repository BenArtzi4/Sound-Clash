"""
Shared Game Models for Sound Clash
Simplified version for Phase 3 - Basic game logic with fixed scoring
"""
from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

class GameStatus(str, Enum):
    """Game status enumeration"""
    WAITING = "waiting"
    ACTIVE = "active" 
    PAUSED = "paused"
    COMPLETED = "completed"

class TeamStatus(str, Enum):
    """Team status enumeration"""
    JOINED = "joined"
    ACTIVE = "active"
    DISCONNECTED = "disconnected"

class GenreCategory(str, Enum):
    """Genre categories for song selection"""
    ISRAELI = "israeli"
    STYLES = "styles" 
    DECADES = "decades"
    MEDIA = "media"

# ===== CORE GAME MODELS =====

class TeamMember(BaseModel):
    """Individual team member"""
    team_name: str
    score: int = 0
    joined_at: datetime
    last_seen: datetime
    status: TeamStatus = TeamStatus.JOINED
    connection_id: Optional[str] = None

class GameRound(BaseModel):
    """Individual game round data"""
    round_number: int
    song_id: Optional[str] = None
    song_title: Optional[str] = None
    song_artist: Optional[str] = None
    genres: List[str] = []
    start_time: Optional[datetime] = None
    buzz_winner: Optional[str] = None  # team_name
    answers: Dict[str, Any] = {}  # team answers
    scores_awarded: Dict[str, int] = {}  # team_name -> points
    completed: bool = False

class GameSettings(BaseModel):
    """Game configuration settings - simplified"""
    max_teams: int = 8
    max_rounds: int = 20
    selected_genres: List[str] = []
    auto_advance: bool = True
    round_timeout: int = 30  # seconds
    
class ActiveGame(BaseModel):
    """Complete active game state"""
    game_code: str
    status: GameStatus = GameStatus.WAITING
    settings: GameSettings
    teams: List[TeamMember] = []
    current_round: int = 0
    total_rounds: int = 20
    rounds: List[GameRound] = []
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    winner: Optional[str] = None  # team_name

# ===== API REQUEST/RESPONSE MODELS =====

class CreateGameRequest(BaseModel):
    """Request to create a new game"""
    max_teams: int = Field(default=8, ge=2, le=16)
    max_rounds: int = Field(default=20, ge=5, le=50)
    selected_genres: List[str] = []
    
class JoinGameRequest(BaseModel):
    """Request to join a game"""
    team_name: str = Field(min_length=1, max_length=50)
    
class StartGameRequest(BaseModel):
    """Request to start a game"""
    pass  # No additional parameters needed

class SubmitAnswerRequest(BaseModel):
    """Submit an answer for current round"""
    song_title: Optional[str] = None
    artist: Optional[str] = None
    movie_tv: Optional[str] = None

class BuzzRequest(BaseModel):
    """Team buzz/ring in request"""
    team_name: str
    reaction_time: float  # milliseconds

# ===== RESPONSE MODELS =====

class GameStateResponse(BaseModel):
    """Current game state for teams"""
    game_code: str
    status: GameStatus
    current_round: int
    total_rounds: int
    teams: List[TeamMember]
    current_song: Optional[Dict[str, Any]] = None
    time_remaining: Optional[int] = None
    
class GameListResponse(BaseModel):
    """List of games response"""
    games: List[Dict[str, Any]]
    total: int
    active_games: int
    
class ScoreboardResponse(BaseModel):
    """Game scoreboard"""
    game_code: str
    teams: List[TeamMember]
    current_round: int
    last_updated: datetime

# ===== SIMPLIFIED SONG MODELS =====

class BasicSong(BaseModel):
    """Simplified song model for Phase 3"""
    id: str
    title: str
    artist: str
    youtube_id: str
    genres: List[str]
    start_time: int = 5  # Fixed 5-second start for simplified version
    
class SongSelectionRequest(BaseModel):
    """Request songs from specific genres"""
    genres: List[str]
    count: int = Field(default=1, ge=1, le=10)
    exclude_ids: List[str] = []

class SongSelectionResponse(BaseModel):
    """Response with selected songs"""
    songs: List[BasicSong]
    selection_criteria: Dict[str, Any]

# ===== SCORING MODELS (SIMPLIFIED) =====

class FixedScoring:
    """Fixed scoring system for simplified version"""
    SONG_TITLE = 10
    ARTIST = 5
    MOVIE_TV = 5
    TIMEOUT_PENALTY = -2
    
    @classmethod
    def calculate_points(cls, answers: Dict[str, str]) -> int:
        """Calculate points for submitted answers"""
        points = 0
        if answers.get("song_title"):
            points += cls.SONG_TITLE
        if answers.get("artist"):
            points += cls.ARTIST  
        if answers.get("movie_tv"):
            points += cls.MOVIE_TV
        return points
