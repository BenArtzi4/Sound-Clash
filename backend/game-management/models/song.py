"""
Song-related API models for request/response validation
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any
from datetime import datetime

# Song Response Models
class SongResponse(BaseModel):
    """Simplified song response model"""
    id: int
    title: str
    artist: str
    duration_seconds: Optional[int] = None
    youtube_id: Optional[str] = None
    youtube_url: Optional[str] = None
    movie_tv_source: Optional[str] = None
    play_count: int = 0
    success_rate: float = 0.0  # Now as decimal (0.0-1.0)
    is_active: bool = True
    difficulty_timestamps: Optional[Dict[str, int]] = None
    has_heatmap_data: bool = False
    heatmap_last_updated: Optional[datetime] = None
    
    @validator('difficulty_timestamps', pre=True, always=True)
    def set_difficulty_timestamps(cls, v, values):
        if v is None and 'difficulty_easy_start' in values:
            return {
                "easy_start": values.get('difficulty_easy_start'),
                "medium_start": values.get('difficulty_medium_start'),
                "hard_start": values.get('difficulty_hard_start')
            }
        return v
    
    @validator('has_heatmap_data', pre=True, always=True)
    def set_has_heatmap_data(cls, v, values):
        return values.get('heatmap_data') is not None

# Song Detail Response (for admin/detailed views)
class SongDetailResponse(SongResponse):
    """Detailed song response with heatmap data"""
    genres: List[str] = []
    heatmap_segments: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime
    
    @validator('heatmap_segments', pre=True, always=True)
    def parse_heatmap_data(cls, v, values):
        heatmap_data = values.get('heatmap_data')
        if heatmap_data:
            try:
                import json
                return json.loads(heatmap_data)
            except:
                return None
        return None

# Song Creation/Update Models
class SongCreateRequest(BaseModel):
    """Request model for creating songs"""
    title: str = Field(..., min_length=1, max_length=200)
    artist: str = Field(..., min_length=1, max_length=200)
    youtube_id: Optional[str] = Field(None, regex=r'^[a-zA-Z0-9_-]{11}$')
    duration_seconds: Optional[int] = Field(None, ge=10, le=3600)
    genres: List[str] = Field(..., min_items=1)
    difficulty_easy_start: Optional[int] = Field(None, ge=0)
    difficulty_medium_start: Optional[int] = Field(None, ge=0)
    difficulty_hard_start: Optional[int] = Field(None, ge=0)
    movie_tv_source: Optional[str] = Field(None, max_length=200)
    
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
    youtube_id: Optional[str] = Field(None, regex=r'^[a-zA-Z0-9_-]{11})
    duration_seconds: Optional[int] = Field(None, ge=10, le=3600)
    genres: Optional[List[str]] = None
    difficulty_easy_start: Optional[int] = Field(None, ge=0)
    difficulty_medium_start: Optional[int] = Field(None, ge=0)
    difficulty_hard_start: Optional[int] = Field(None, ge=0)
    movie_tv_source: Optional[str] = Field(None, max_length=200)
    is_active: Optional[bool] = None

# Heatmap-related Models
class HeatmapUpdateRequest(BaseModel):
    """Request to update heatmap data for songs"""
    song_ids: Optional[List[int]] = None  # If None, update all eligible songs
    force_update: bool = False  # Force update even if recently updated
    
class HeatmapUpdateResponse(BaseModel):
    """Response for heatmap update operations"""
    songs_processed: int
    songs_updated: int
    songs_failed: int
    failed_song_ids: List[int] = []
    processing_time_seconds: float

# CSV Import Models
class CSVImportRequest(BaseModel):
    """Request model for CSV import"""
    file_path: str
    update_heatmaps: bool = True
    overwrite_existing: bool = False

class CSVImportResponse(BaseModel):
    """Response for CSV import operations"""
    songs_imported: int
    songs_updated: int
    songs_skipped: int
    heatmaps_updated: int
    errors: List[str] = []
    processing_time_seconds: float

# Songs by Genre Response
class SongsByGenreResponse(BaseModel):
    """Response for songs by genre endpoint"""
    genre: Dict[str, Any]
    songs: List[SongResponse]
    pagination: Dict[str, Any]
    search_term: Optional[str] = None
