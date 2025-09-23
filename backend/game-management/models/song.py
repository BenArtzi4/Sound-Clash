"""
Song-related API models for request/response validation - Simplified Version
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime

# Song Response Models
class SongResponse(BaseModel):
    """Simplified song response model"""
    id: int
    title: str
    artist: str  # Also used for movie/TV show names for soundtracks
    youtube_id: Optional[str] = None
    youtube_url: Optional[str] = None
    play_count: int = 0
    success_rate: float = 0.0  # Decimal (0.0-1.0)
    is_active: bool = True
    
    class Config:
        from_attributes = True

# Song Detail Response (for admin/detailed views)
class SongDetailResponse(SongResponse):
    """Detailed song response with genre information"""
    genres: List[str] = []
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

# Song Creation/Update Models
class SongCreateRequest(BaseModel):
    """Request model for creating songs"""
    title: str = Field(..., min_length=1, max_length=200)
    artist: str = Field(..., min_length=1, max_length=200)  # Artist or movie/TV show name
    youtube_id: Optional[str] = Field(None, regex=r'^[a-zA-Z0-9_-]{11}$')
    genres: List[str] = Field(..., min_items=1)
    
    @validator('youtube_id')
    def validate_youtube_id(cls, v):
        if v and not v.startswith(('http', 'www')):
            return v  # Accept just the ID
        elif v and 'youtube.com/watch?v=' in v:
            return v.split('v=')[1].split('&')[0]  # Extract ID from URL
        elif v and 'youtu.be/' in v:
            return v.split('youtu.be/')[1].split('?')[0]  # Extract ID from short URL
        return v

class SongUpdateRequest(BaseModel):
    """Request model for updating songs"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    artist: Optional[str] = Field(None, min_length=1, max_length=200)
    youtube_id: Optional[str] = Field(None, regex=r'^[a-zA-Z0-9_-]{11}$')
    genres: Optional[List[str]] = None
    is_active: Optional[bool] = None

# CSV Import Models
class CSVImportRequest(BaseModel):
    """Request model for CSV import"""
    file_path: str
    overwrite_existing: bool = False

class CSVImportResponse(BaseModel):
    """Response for CSV import operations"""
    songs_imported: int
    songs_updated: int
    songs_skipped: int
    errors: List[str] = []
    processing_time_seconds: float

# Songs by Genre Response
class SongsByGenreResponse(BaseModel):
    """Response for songs by genre endpoint"""
    genre: Dict[str, Any]
    songs: List[SongResponse]
    pagination: Dict[str, Any]
    search_term: Optional[str] = None

# Song Selection Models
class SongSelectionRequest(BaseModel):
    """Request for smart song selection"""
    genres: List[str]
    difficulty: Optional[str] = "random"  # easy, medium, hard, random
    exclude_recent: bool = True
    game_code: Optional[str] = None

class SongSelectionResponse(BaseModel):
    """Response for song selection"""
    song: SongResponse
    selection_reason: Optional[str] = None
    timestamp_start: Optional[int] = None  # If using difficulty-based timing later