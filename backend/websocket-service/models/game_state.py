"""
Game State Models
Defines all possible game states and round states
"""
from enum import Enum
from typing import Optional, List, Dict
from pydantic import BaseModel
from datetime import datetime

class GameState(str, Enum):
    WAITING = "waiting"           # Teams joining, not started yet
    PLAYING = "playing"           # Game in progress
    FINISHED = "finished"         # Game completed

class RoundState(str, Enum):
    NOT_STARTED = "not_started"   # Round hasn't begun
    SONG_PLAYING = "song_playing" # Song is playing, buzzers active
    BUZZER_LOCKED = "buzzer_locked" # Someone buzzed, waiting for answer
    EVALUATING = "evaluating"     # Manager evaluating answers
    COMPLETED = "completed"       # Round finished

class SongInfo(BaseModel):
    id: int
    title: str
    artist: str
    youtube_id: str
    genres: List[str] = []

class BuzzerPress(BaseModel):
    team_name: str
    timestamp: datetime
    reaction_time_ms: int

class TeamAnswer(BaseModel):
    team_name: str
    song_name: Optional[str] = None
    artist_name: Optional[str] = None
    movie_tv_name: Optional[str] = None
    submitted_at: datetime

class RoundScore(BaseModel):
    team_name: str
    song_correct: bool = False
    artist_correct: bool = False
    movie_tv_correct: bool = False
    points_earned: int = 0
    buzzer_timeout: bool = False

class RoundData(BaseModel):
    round_number: int
    state: RoundState = RoundState.NOT_STARTED
    song: Optional[SongInfo] = None
    song_start_time: int = 5  # Always start at 5 seconds
    buzzer_winner: Optional[str] = None
    buzzer_press: Optional[BuzzerPress] = None
    team_answer: Optional[TeamAnswer] = None
    scores: Dict[str, RoundScore] = {}
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

class GameData(BaseModel):
    game_code: str
    state: GameState = GameState.WAITING
    current_round: int = 0
    max_rounds: int = 10
    selected_genres: List[str] = []
    rounds_history: List[RoundData] = []
    team_scores: Dict[str, int] = {}  # team_name -> total_points
    created_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
