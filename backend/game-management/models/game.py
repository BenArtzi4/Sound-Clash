"""
Game data models for request/response validation
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum

class GameStatus(str, Enum):
    WAITING = "waiting"
    ACTIVE = "active"
    RESULTS = "results"
    ENDED = "ended"

class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    RANDOM = "random"

class GameSettings(BaseModel):
    """Game configuration settings"""
    max_teams: int = Field(default=0, ge=0, le=20)  # 0 = unlimited
    rounds_per_game: int = Field(default=10, ge=5, le=50)
    default_difficulty: Difficulty = Difficulty.RANDOM
    selected_genres: List[str] = []  # Dynamic list from database
    enable_partial_scoring: bool = True
    answer_time_limit: int = Field(default=10, ge=5, le=30)

class CreateGameRequest(BaseModel):
    """Request model for game creation"""
    settings: Optional[GameSettings] = None
    host_name: Optional[str] = Field(None, max_length=50)

    @validator('settings', pre=True, always=True)
    def set_default_settings(cls, v):
        if v is None:
            return GameSettings()
        return v

    @validator('host_name')
    def validate_host_name(cls, v):
        if v and not v.strip():
            raise ValueError('Host name cannot be empty')
        return v.strip() if v else v

class GenreResponse(BaseModel):
    """Response model for genre data"""
    id: str
    label: str
    description: str
    song_count: int = 0
    is_active: bool = True

class GameResponse(BaseModel):
    """Response model for game data"""
    game_code: str
    status: GameStatus
    teams: List[str] = []
    team_count: int = 0
    settings: GameSettings
    created_at: datetime
    manager_url: str
    public_display_url: str
    time_remaining_hours: Optional[float] = None

class GameStatusResponse(BaseModel):
    """Simple game status response"""
    game_code: str
    status: GameStatus
    team_count: int
    exists: bool = True

class ErrorResponse(BaseModel):
    """Error response model"""
    error: str
    message: str
    game_code: Optional[str] = None

class GenreListResponse(BaseModel):
    """Response model for available genres"""
    genres: List[GenreResponse]
    total_count: int