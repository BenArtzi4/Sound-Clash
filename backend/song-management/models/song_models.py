"""
Simple song models for request/response validation
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime

class SongResponse(BaseModel):
    """Basic song response model"""
    id: int
    title: str
    artist: str
    youtube_id: Optional[str] = None
    youtube_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    play_count: int = 0
    is_active: bool = True
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class SongDetailResponse(SongResponse):
    """Detailed song response with genres"""
    genres: List[str] = []
    
    class Config:
        from_attributes = True

class SongCreateRequest(BaseModel):
    """Request model for creating songs"""
    title: str = Field(..., min_length=1, max_length=200)
    artist: str = Field(..., min_length=1, max_length=200)
    youtube_id: Optional[str] = Field(None, pattern=r'^[a-zA-Z0-9_-]{11}$')
    duration_seconds: Optional[int] = Field(None, ge=0, description="Song duration in seconds")
    genres: List[str] = Field(..., min_items=1, description="Genre slugs")
    
    @validator('youtube_id')
    def validate_youtube_id(cls, v):
        if not v:
            return None
        # Extract ID from various YouTube URL formats
        if 'youtube.com/watch?v=' in v:
            return v.split('v=')[1].split('&')[0]
        elif 'youtu.be/' in v:
            return v.split('youtu.be/')[1].split('?')[0]
        return v

class SongUpdateRequest(BaseModel):
    """Request model for updating songs"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    artist: Optional[str] = Field(None, min_length=1, max_length=200)
    youtube_id: Optional[str] = None
    duration_seconds: Optional[int] = Field(None, ge=0, description="Song duration in seconds")
    genres: Optional[List[str]] = None
    is_active: Optional[bool] = None

class SongSearchRequest(BaseModel):
    """Search request model"""
    search_term: Optional[str] = None
    genres: Optional[List[str]] = None
    is_active: Optional[bool] = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)

class SongSearchResponse(BaseModel):
    """Search response model"""
    songs: List[SongDetailResponse]
    total_songs: int
    page: int
    page_size: int
    total_pages: int

class GenreResponse(BaseModel):
    """Genre response model"""
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    category: str
    is_active: bool = True
    song_count: int = 0
    
    class Config:
        from_attributes = True

class GenreListResponse(BaseModel):
    """Genre list response"""
    genres: List[GenreResponse]
    categories: Dict[str, List[GenreResponse]] = {}
    total_count: int

class SongSelectionRequest(BaseModel):
    """Simple song selection request"""
    genres: List[str] = Field(default=[], description="Genre slugs to filter by (empty=all songs)")
    exclude_song_ids: Optional[List[int]] = []
    limit: int = Field(default=10, ge=1, le=200)

class SongSelectionResponse(BaseModel):
    """Song selection response"""
    songs: List[SongDetailResponse]
    total_available: int
    selection_criteria: Dict[str, Any]

class BulkOperationResponse(BaseModel):
    """Response for bulk operations"""
    processed: int
    successful: int
    failed: int
    errors: List[str] = []
    processing_time_seconds: float

class TimestampRequest(BaseModel):
    """Manual timestamp management"""
    song_id: int
    easy_start: int = Field(ge=0, description="Easy difficulty start time (seconds)")
    medium_start: int = Field(ge=0, description="Medium difficulty start time (seconds)")  
    hard_start: int = Field(ge=0, description="Hard difficulty start time (seconds)")

class TimestampResponse(BaseModel):
    """Timestamp response"""
    song_id: int
    easy_start: Optional[int] = None
    medium_start: Optional[int] = None
    hard_start: Optional[int] = None
    
    class Config:
        from_attributes = True
