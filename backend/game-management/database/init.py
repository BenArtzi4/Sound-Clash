"""
Database initialization script
Phase 2: Create tables and handle database setup
"""
import asyncio
import logging
from sqlalchemy.ext.asyncio import create_async_engine
from database.config import get_database_url, Base
from database.models import Game, Team  # Import models to register them

logger = logging.getLogger(__name__)

async def create_tables():
    """Create all database tables"""
    database_url = get_database_url()
    if not database_url:
        logger.error("Cannot create tables: no database URL")
        return False
    
    try:
        engine = create_async_engine(database_url)
        async with engine.begin() as conn:
            # Create all tables
            await conn.run_sync(Base.metadata.create_all)
        
        await engine.dispose()
        logger.info("Database tables created successfully")
        return True
        
    except Exception as e:
        logger.error(f"Error creating tables: {e}")
        return False

async def init_database_schema():
    """Initialize database schema if needed"""
    return await create_tables()

if __name__ == "__main__":
    # Run table creation
    asyncio.run(create_tables())
