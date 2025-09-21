"""
PostgreSQL database connection manager for persistent data
"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean
from datetime import datetime

# Database URL
DATABASE_URL = f"postgresql+asyncpg://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}@{os.getenv('POSTGRES_HOST')}:{os.getenv('POSTGRES_PORT')}/{os.getenv('POSTGRES_DB')}"

# Create async engine
engine = create_async_engine(DATABASE_URL, echo=True)

# Create session maker
AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

# Base class for models
Base = declarative_base()

class User(Base):
    """User accounts table"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(100), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)

class GameHistory(Base):
    """Persistent game records for analytics"""
    __tablename__ = "game_history"
    
    id = Column(Integer, primary_key=True, index=True)
    game_code = Column(String(6), index=True, nullable=False)
    host_user_id = Column(Integer, nullable=True)  # For authenticated hosts
    created_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)
    total_teams = Column(Integer, default=0)
    winner_team = Column(String(50), nullable=True)
    total_rounds = Column(Integer, default=0)

async def get_db():
    """Dependency to get database session"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def create_tables():
    """Create database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)