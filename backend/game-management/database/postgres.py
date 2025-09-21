"""
PostgreSQL database connection manager for persistent data
"""

import os
import sys
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean
from datetime import datetime

# Add shared models to path
backend_dir = Path(__file__).parent.parent.parent
shared_dir = backend_dir / "shared"
sys.path.insert(0, str(shared_dir))

# Import the centralized models
from shared.database.models import Base, Song, Genre

# Database URL for async operations
DATABASE_URL = f"postgresql+asyncpg://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}@{os.getenv('POSTGRES_HOST')}:{os.getenv('POSTGRES_PORT')}/{os.getenv('POSTGRES_DB')}"

# Database URL for sync operations (migrations)
SYNC_DATABASE_URL = f"postgresql://{os.getenv('POSTGRES_USER')}:{os.getenv('POSTGRES_PASSWORD')}@{os.getenv('POSTGRES_HOST')}:{os.getenv('POSTGRES_PORT')}/{os.getenv('POSTGRES_DB')}"

# Create async engine
engine = create_async_engine(
    DATABASE_URL, 
    echo=True,
    pool_size=5,
    max_overflow=10,
    pool_recycle=3600
)

# Create session maker
AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

class User(Base):
    """User accounts table for authenticated hosts"""
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

def get_database_url():
    """Get synchronous database URL for migrations"""
    return SYNC_DATABASE_URL

async def test_connection():
    """Test database connection"""
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute("SELECT 1")
            await session.commit()
            return True
    except Exception as e:
        print(f"Database connection failed: {e}")
        return False