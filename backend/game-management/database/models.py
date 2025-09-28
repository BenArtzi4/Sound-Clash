"""
Database models for Game Management Service
Phase 2: Basic models for games and teams
"""
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database.config import Base

class Game(Base):
    """Game model - represents a game session"""
    __tablename__ = "games"
    
    id = Column(Integer, primary_key=True, index=True)
    game_code = Column(String(10), unique=True, index=True, nullable=False)
    status = Column(String(20), default="waiting", nullable=False)  # waiting, in_progress, completed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Game settings
    max_teams = Column(Integer, default=8)
    current_round = Column(Integer, default=0)
    total_rounds = Column(Integer, default=10)
    
    # Relationships
    teams = relationship("Team", back_populates="game", cascade="all, delete-orphan")

class Team(Base):
    """Team model - represents teams in a game"""
    __tablename__ = "teams"
    
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("games.id", ondelete="CASCADE"), nullable=False)
    team_name = Column(String(100), nullable=False)
    score = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    joined_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    game = relationship("Game", back_populates="teams")
    
    # Unique constraint: one team name per game
    __table_args__ = (
        UniqueConstraint('game_id', 'team_name', name='unique_team_per_game'),
    )
