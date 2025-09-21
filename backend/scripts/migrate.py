"""
Database migration script for simplified song schema
"""

import asyncio
import sys
import os
from pathlib import Path

# Add the correct paths to find the modules
current_dir = Path(__file__).parent
backend_dir = current_dir.parent
shared_dir = backend_dir / "shared"

sys.path.insert(0, str(backend_dir))
sys.path.insert(0, str(shared_dir))

from sqlalchemy import create_engine, text
from shared.database.models import Base
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def get_database_url():
    """Get database URL from environment variables"""
    DB_HOST = os.getenv('POSTGRES_HOST', 'localhost')
    DB_PORT = os.getenv('POSTGRES_PORT', '5432')
    DB_NAME = os.getenv('POSTGRES_DB', 'buzzer_game_db')
    DB_USER = os.getenv('POSTGRES_USER', 'postgres')
    DB_PASSWORD = os.getenv('POSTGRES_PASSWORD')
    
    if not DB_PASSWORD:
        print("Error: POSTGRES_PASSWORD environment variable not set!")
        print("Please set your database environment variables:")
        print("- POSTGRES_HOST")
        print("- POSTGRES_PORT") 
        print("- POSTGRES_DB")
        print("- POSTGRES_USER")
        print("- POSTGRES_PASSWORD")
        sys.exit(1)
    
    return f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

async def run_migration():
    """Run database migration to create tables with simplified schema"""
    database_url = get_database_url()
    
    print(f"Connecting to database: postgresql://{os.getenv('POSTGRES_USER')}:***@{os.getenv('POSTGRES_HOST')}:{os.getenv('POSTGRES_PORT')}/{os.getenv('POSTGRES_DB')}")
    
    try:
        engine = create_engine(database_url)
        
        print("Creating database tables with simplified song schema...")
        
        with engine.connect() as conn:
            # Start transaction
            trans = conn.begin()
            
            try:
                # Create all tables from models
                Base.metadata.create_all(bind=engine)
                print("✓ Tables created successfully!")
                
                # Add useful indexes for performance
                print("Adding performance indexes...")
                
                # Index for active songs with YouTube IDs
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_songs_active_youtube 
                    ON songs(is_active, youtube_id) 
                    WHERE is_active = true AND youtube_id IS NOT NULL;
                """))
                
                # Index for heatmap updates
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_songs_heatmap_updated 
                    ON songs(heatmap_last_updated) 
                    WHERE heatmap_last_updated IS NOT NULL;
                """))
                
                # Index for genre lookups
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_genres_category_active 
                    ON genres(category, is_active) 
                    WHERE is_active = true;
                """))
                
                print("✓ Performance indexes created!")
                
                # Commit transaction
                trans.commit()
                print("✓ Migration completed successfully!")
                
            except Exception as e:
                trans.rollback()
                raise e
                
    except Exception as e:
        print(f"Migration failed: {e}")
        print("\nTroubleshooting:")
        print("1. Verify your database is running and accessible")
        print("2. Check your environment variables are set correctly")
        print("3. Ensure the database user has CREATE privileges")
        sys.exit(1)

async def seed_basic_data():
    """Seed database with basic genre data"""
    database_url = get_database_url()
    engine = create_engine(database_url)
    
    print("Seeding basic genre data...")
    
    try:
        with engine.connect() as conn:
            # Check if genres already exist
            result = conn.execute(text("SELECT COUNT(*) FROM genres"))
            count = result.scalar()
            
            if count > 0:
                print(f"✓ Database already has {count} genres, skipping seed")
                return
            
            # Insert basic genres
            genres_sql = """
                INSERT INTO genres (name, slug, description, category, sort_order, is_active) VALUES
                ('Rock', 'rock', 'Classic and modern rock music', 'styles', 1, true),
                ('Pop', 'pop', 'Popular music across decades', 'styles', 2, true),
                ('80s Hits', '80s-hits', 'Popular music from the 1980s', 'decades', 3, true),
                ('90s Alternative', '90s-alternative', 'Alternative rock from the 1990s', 'decades', 4, true),
                ('Movie Soundtracks', 'movie-soundtracks', 'Songs from popular movies', 'media', 5, true),
                ('TV Themes', 'tv-themes', 'Television show theme songs', 'media', 6, true)
                ON CONFLICT (slug) DO NOTHING;
            """
            
            conn.execute(text(genres_sql))
            conn.commit()
            print("✓ Basic genre data seeded!")
            
    except Exception as e:
        print(f"Seeding failed: {e}")
        # Don't exit on seed failure, just warn
        print("Warning: Could not seed basic data, but migration was successful")

async def main():
    """Run migrations and basic seeding"""
    try:
        await run_migration()
        await seed_basic_data()
        print("\n🎉 Database setup completed successfully!")
        print("\nNext steps:")
        print("1. Use import_songs_csv.py to populate songs")
        print("2. Test the simplified schema with your application")
        print("3. Run heatmap service to populate timestamp data")
        
    except Exception as e:
        print(f"Setup failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())