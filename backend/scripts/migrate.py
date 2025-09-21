"""
Database migration script
"""

import asyncio
import sys
import os

# Add the backend directory to the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from database.models import Base
from database.postgres import get_database_url
from database.seed_data import run_seed

async def create_tables():
    """Create all database tables"""
    database_url = get_database_url()
    engine = create_engine(database_url)
    
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("Tables created successfully!")

async def main():
    """Run migrations and seeding"""
    try:
        await create_tables()
        await run_seed()
        print("Migration completed successfully!")
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())