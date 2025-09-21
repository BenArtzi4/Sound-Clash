"""
Team data models for validation
"""

from pydantic import BaseModel, Field, validator
from typing import Optional
import re

class JoinGameRequest(BaseModel):
    """Request model for team joining"""
    team_name: str = Field(..., min_length=1, max_length=30)
    
    @validator('team_name')
    def validate_team_name(cls, v):
        # Remove extra whitespace
        v = v.strip()
        
        # Check if empty after stripping
        if not v:
            raise ValueError('Team name cannot be empty')
        
        # Allow Unicode characters but prevent certain problematic ones
        if len(v.encode('utf-8')) > 90:  # Limit byte length for database
            raise ValueError('Team name too long (max 30 characters)')
        
        # Prevent names that are just whitespace or special characters
        if not re.search(r'[\w\u00C0-\u017F\u0400-\u04FF\u4E00-\u9FFF]', v):
            raise ValueError('Team name must contain at least one letter or number')
        
        return v

class RejoinGameRequest(BaseModel):
    """Request model for team reconnection"""
    team_name: str = Field(..., min_length=1, max_length=30)
    
    @validator('team_name')
    def validate_team_name(cls, v):
        return JoinGameRequest.validate_team_name(v)

class TeamResponse(BaseModel):
    """Response model for team operations"""
    team_name: str
    game_code: str
    position: int  # Order joined
    status: str = "connected"
    joined_at: str

class WaitingRoomResponse(BaseModel):
    """Response model for waiting room status"""
    game_code: str
    status: str
    teams: list[TeamResponse] = []
    team_count: int = 0
    max_teams: int = 8
    can_start: bool = False
    settings: dict = {}