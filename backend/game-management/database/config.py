"""
Database configuration and connection management for Game Management Service
Phase 2: Basic PostgreSQL connection
"""
import os
import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

logger = logging.getLogger(__name__)

# Database Configuration
DATABASE_URL = None

# Build database URL from environment variables
def get_database_url():
    """Build PostgreSQL connection URL from environment variables"""
    host = os.getenv("POSTGRES_HOST")
    db = os.getenv("POSTGRES_DB") 
    user = os.getenv("POSTGRES_USER")
    password = os.getenv("POSTGRES_PASSWORD")
    port = os.getenv("POSTGRES_PORT", "5432")
    
    if not all([host, db, user, password]):
        logger.warning("Missing database environment variables")
        return None
        
    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{db}"

# SQLAlchemy setup
Base = declarative_base()
engine = None
AsyncSessionLocal = None

async def init_database():
    """Initialize database connection"""
    global engine, AsyncSessionLocal, DATABASE_URL
    
    DATABASE_URL = get_database_url()
    if not DATABASE_URL:
        logger.error("Cannot initialize database: missing configuration")
        return False
        
    try:
        engine = create_async_engine(
            DATABASE_URL,
            echo=False,  # Set to True for SQL debugging
            pool_pre_ping=True,
            pool_recycle=3600
        )
        
        AsyncSessionLocal = async_sessionmaker(
            engine,
            expire_on_commit=False
        )
        
        logger.info("Database initialized successfully")
        return True
        
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        return False

def get_db_session():
    """Get database session - returns async context manager"""
    if not AsyncSessionLocal:
        raise Exception("Database not initialized")
    return AsyncSessionLocal()

async def test_connection():
    """Test database connection"""
    try:
        if not engine:
            return False
            
        async with engine.begin() as conn:
            from sqlalchemy import text
            await conn.execute(text("SELECT 1"))
        return True
        
    except Exception as e:
        logger.error(f"Database connection test failed: {e}")
        return False

async def close_database():
    """Close database connections"""
    global engine
    if engine:
        await engine.dispose()
        logger.info("Database connections closed")
