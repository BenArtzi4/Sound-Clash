"""
Enhanced song database models with analytics and AI selection support
Builds on existing songs/genres schema with new analytics columns
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey, Table, Float, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
from typing import Dict, List, Optional

Base = declarative_base()

# Extended many-to-many relationship table for songs and genres
song_genres_enhanced = Table(
    'song_genres',
    Base.metadata,
    Column('song_id', Integer, ForeignKey('songs.id'), primary_key=True),
    Column('genre_id', Integer, ForeignKey('genres.id'), primary_key=True),
    Column('success_rate', Float, default=0.0),  # Genre-specific success rate for this song
    Column('play_count', Integer, default=0),    # How many times played in this genre context
    Column('last_played', DateTime),             # When last played in this genre
)

class EnhancedSong(Base):
    __tablename__ = 'songs'
    
    # Existing columns (matching your current schema)
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    artist = Column(String(200), nullable=False)
    youtube_id = Column(String(20), index=True)
    youtube_url = Column(String(500))
    is_active = Column(Boolean, default=True)
    play_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # NEW ANALYTICS COLUMNS for AI selection
    success_rate = Column(Float, default=0.0)           # Overall success rate (0.0-1.0)
    difficulty_rating = Column(Float, default=0.5)      # AI-calculated difficulty (0.0-1.0)
    popularity_score = Column(Float, default=0.0)       # Weighted popularity metric
    
    # Engagement metrics
    buzz_speed_avg = Column(Float, default=0.0)         # Average time to first buzz (seconds)
    correct_answers_count = Column(Integer, default=0)   # Total correct answers
    total_attempts_count = Column(Integer, default=0)    # Total answer attempts
    
    # Song metadata for better selection
    energy_level = Column(Float, default=0.5)           # Song energy (0.0-1.0)
    recognizability = Column(Float, default=0.5)        # How recognizable (0.0-1.0)
    decade_popularity = Column(String(20))              # Peak popularity decade
    
    # YouTube heatmap data
    heatmap_data = Column(JSON)                         # Store processed heatmap
    optimal_timestamps = Column(JSON)                   # Difficulty-based start times
    heatmap_last_updated = Column(DateTime)             # When heatmap was last fetched
    
    # AI selection metadata
    selection_weight = Column(Float, default=1.0)      # AI selection preference weight
    last_selected = Column(DateTime)                    # When last selected in any game
    selection_count = Column(Integer, default=0)       # How many times selected
    
    # Quality control
    quality_score = Column(Float, default=0.8)         # Overall song quality (0.0-1.0)
    is_verified = Column(Boolean, default=False)       # Human-verified song data
    content_warnings = Column(Text)                    # Any content warnings
    
    # Relationships (same as your existing)
    genres = relationship("Genre", secondary=song_genres_enhanced, back_populates="songs")

class EnhancedGenre(Base):
    __tablename__ = 'genres'
    
    # Existing columns (matching your current schema)
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    slug = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(Text)
    category = Column(String(50), nullable=False)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # NEW ANALYTICS COLUMNS
    total_songs = Column(Integer, default=0)           # Cached count of active songs
    avg_difficulty = Column(Float, default=0.5)        # Average difficulty of songs
    popularity_trend = Column(Float, default=0.0)      # Trending popularity score
    success_rate_avg = Column(Float, default=0.0)      # Average success rate in this genre
    
    # Selection preferences
    selection_weight = Column(Float, default=1.0)      # Genre selection weight
    last_played = Column(DateTime)                      # When genre was last used
    play_frequency = Column(Integer, default=0)        # How often this genre is selected
    
    # Metadata for better categorization
    difficulty_preference = Column(String(20), default='mixed')  # easy, medium, hard, mixed
    target_audience = Column(String(50))                         # Family, Adult, Teen, etc.
    cultural_context = Column(String(50))                        # Israeli, International, etc.
    
    # Relationships
    songs = relationship("EnhancedSong", secondary=song_genres_enhanced, back_populates="genres")

class SongAnalytics(Base):
    """Separate analytics table for detailed tracking"""
    __tablename__ = 'song_analytics'
    
    id = Column(Integer, primary_key=True, index=True)
    song_id = Column(Integer, ForeignKey('songs.id'), nullable=False)
    
    # Game context
    game_code = Column(String(10), index=True)
    difficulty_selected = Column(String(20))        # easy, medium, hard
    genres_selected = Column(JSON)                  # List of genres in that game
    
    # Performance metrics
    was_answered_correctly = Column(Boolean)
    buzz_time_seconds = Column(Float)               # Time to first buzz
    answer_time_seconds = Column(Float)             # Time to answer after buzz
    team_count = Column(Integer)                    # How many teams were playing
    
    # Answer breakdown
    song_name_correct = Column(Boolean, default=False)
    artist_correct = Column(Boolean, default=False)
    movie_tv_correct = Column(Boolean, default=False)
    
    # Context data
    timestamp_used = Column(Integer)                # Which timestamp was used
    points_awarded = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    song = relationship("EnhancedSong")

class GameSession(Base):
    """Track game sessions for analytics"""
    __tablename__ = 'game_sessions'
    
    id = Column(Integer, primary_key=True, index=True)
    game_code = Column(String(10), unique=True, index=True)
    
    # Game metadata
    total_rounds = Column(Integer)
    team_count = Column(Integer)
    genres_used = Column(JSON)                      # List of genres selected
    difficulty_distribution = Column(JSON)          # Count of each difficulty used
    
    # Performance metrics
    total_correct_answers = Column(Integer, default=0)
    total_buzz_attempts = Column(Integer, default=0)
    average_answer_time = Column(Float, default=0.0)
    engagement_score = Column(Float, default=0.0)   # Overall engagement metric
    
    # Timing
    started_at = Column(DateTime)
    ended_at = Column(DateTime)
    duration_minutes = Column(Integer)
    
    created_at = Column(DateTime, default=datetime.utcnow)

class SongSelectionCache(Base):
    """Cache for AI song selection to avoid recalculation"""
    __tablename__ = 'song_selection_cache'
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Cache key (combination of selection criteria)
    cache_key = Column(String(255), unique=True, index=True)
    genres_hash = Column(String(64))                # MD5 hash of genre combination
    difficulty = Column(String(20))
    
    # Cached results
    selected_songs = Column(JSON)                   # List of song IDs in order
    selection_weights = Column(JSON)                # Weights used for selection
    
    # Cache metadata
    hit_count = Column(Integer, default=0)
    last_used = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime)
    
    created_at = Column(DateTime, default=datetime.utcnow)