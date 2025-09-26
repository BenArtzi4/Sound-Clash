"""
Database models for genres and songs - Simplified Version
"""

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey, Table, Float
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

# Many-to-many relationship table for songs and genres
song_genres = Table(
    'song_genres',
    Base.metadata,
    Column('song_id', Integer, ForeignKey('songs.id'), primary_key=True),
    Column('genre_id', Integer, ForeignKey('genres.id'), primary_key=True)
)

class Genre(Base):
    __tablename__ = 'genres'
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    slug = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(Text)
    category = Column(String(50), nullable=False)  # 'decades', 'styles', 'israeli', 'media'
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    songs = relationship("Song", secondary=song_genres, back_populates="genres")

class Song(Base):
    __tablename__ = 'songs'
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    artist = Column(String(200), nullable=False)  # Also used for movie/TV show names
    
    # Media sources
    youtube_id = Column(String(20), index=True)
    youtube_url = Column(String(500))
    
    # Status and stats
    is_active = Column(Boolean, default=True)
    play_count = Column(Integer, default=0)
    success_rate = Column(Float, default=0.0)  # Percentage as decimal (0.0-1.0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    genres = relationship("Genre", secondary=song_genres, back_populates="songs")

class GameTemplate(Base):
    __tablename__ = 'game_templates'
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    host_name = Column(String(100))  # Anonymous host name, no user accounts
    
    # Settings as JSON-like columns
    selected_genres = Column(Text)  # JSON array of genre IDs
    max_teams = Column(Integer, default=0)
    rounds_per_game = Column(Integer, default=10)
    default_difficulty = Column(String(20), default='mixed')
    answer_time_limit = Column(Integer, default=10)
    
    is_public = Column(Boolean, default=False)
    use_count = Column(Integer, default=0)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)