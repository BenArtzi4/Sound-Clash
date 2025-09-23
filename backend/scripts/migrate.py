"""
Database migration script for simplified song schema with improved connection handling
"""

import asyncio
import sys
import os
import time
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
import psycopg2

# Load environment variables
load_dotenv()

def get_database_url():
    """Get database URL from environment variables"""
    DB_HOST = os.getenv('POSTGRES_HOST', 'localhost')
    DB_PORT = os.getenv('POSTGRES_PORT', '5432')
    DB_NAME = os.getenv('POSTGRES_DB', 'soundclash')  # Fixed default
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

def test_connection(max_retries=5, retry_delay=10):
    """Test database connection with retries"""
    DB_HOST = os.getenv('POSTGRES_HOST')
    DB_PORT = os.getenv('POSTGRES_PORT', '5432')
    DB_NAME = os.getenv('POSTGRES_DB', 'soundclash')
    DB_USER = os.getenv('POSTGRES_USER', 'postgres')
    DB_PASSWORD = os.getenv('POSTGRES_PASSWORD')
    
    print(f"Testing connection to: postgresql://{DB_USER}:***@{DB_HOST}:{DB_PORT}/{DB_NAME}")
    
    for attempt in range(max_retries):
        try:
            print(f"Connection attempt {attempt + 1}/{max_retries}...")
            
            conn = psycopg2.connect(
                host=DB_HOST,
                port=DB_PORT,
                database=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
                connect_timeout=30  # 30 second timeout
            )
            
            # Test a simple query
            cursor = conn.cursor()
            cursor.execute("SELECT version();")
            version = cursor.fetchone()[0]
            print(f"✓ Connection successful! Database version: {version[:50]}...")
            
            cursor.close()
            conn.close()
            return True
            
        except Exception as e:
            print(f"✗ Connection attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                print(f"Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
            else:
                print("All connection attempts failed!")
                return False
    
    return False

async def run_migration():
    """Run database migration to create tables with simplified schema"""
    database_url = get_database_url()
    
    # Test connection first
    if not test_connection():
        print("\nConnection test failed. Please check:")
        print("1. Security group rule is added for your IP")
        print("2. Database is in PRIVATE_WITH_EGRESS subnets")
        print("3. Environment variables are correct")
        sys.exit(1)
    
    try:
        # Create engine with longer timeout
        engine = create_engine(
            database_url,
            pool_timeout=30,
            pool_recycle=3600,
            connect_args={
                "connect_timeout": 30,
                "options": "-c timezone=utc"
            }
        )
        
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
        print("4. Confirm security group allows your IP address")
        sys.exit(1)

async def seed_basic_data():
    """Seed database with comprehensive genre data"""
    database_url = get_database_url()
    engine = create_engine(database_url, connect_args={"connect_timeout": 30})
    
    print("Seeding comprehensive genre data...")
    
    try:
        with engine.connect() as conn:
            # Check if genres already exist
            result = conn.execute(text("SELECT COUNT(*) FROM genres"))
            count = result.scalar()
            
            if count > 0:
                print(f"✓ Database already has {count} genres, skipping seed")
                return
            
            # Insert comprehensive genres matching your CSV
            genres_sql = """
                INSERT INTO genres (name, slug, description, category, sort_order, is_active) VALUES
                ('Rock', 'rock', 'Classic and modern rock music', 'styles', 1, true),
                ('Pop', 'pop', 'Popular music across all eras', 'styles', 2, true),
                ('Alternative Rock', 'alternative-rock', 'Alternative and grunge rock', 'styles', 3, true),
                ('Hip-Hop', 'hip-hop', 'Hip-hop and rap music', 'styles', 4, true),
                ('Electronic', 'electronic', 'Electronic dance music and EDM', 'styles', 5, true),
                ('Soundtracks', 'soundtracks', 'Movie and TV soundtrack songs', 'media', 6, true),
                ('Mizrahit', 'mizrahit', 'Israeli Middle Eastern pop music', 'israeli', 7, true),
                ('Israeli Rock Pop', 'israeli-rock-pop', 'Israeli rock and pop fusion', 'israeli', 8, true),
                ('Israeli Pop', 'israeli-pop', 'Contemporary Israeli pop music', 'israeli', 9, true),
                ('Israeli Rap Hip-Hop', 'israeli-rap-hip-hop', 'Israeli rap and hip-hop', 'israeli', 10, true),
                ('Israeli Cover', 'israeli-cover', 'Israeli cover versions and interpretations', 'israeli', 11, true)
                ON CONFLICT (slug) DO NOTHING;
            """
            
            conn.execute(text(genres_sql))
            conn.commit()
            print("✓ Comprehensive genre data seeded!")
            
    except Exception as e:
        print(f"Seeding failed: {e}")
        # Don't exit on seed failure, just warn
        print("Warning: Could not seed basic data, but migration was successful")

async def main():
    """Run migrations and comprehensive seeding"""
    try:
        await run_migration()
        await seed_basic_data()
        print("\n🎉 Database setup completed successfully!")
        print("\nNext steps:")
        print("1. Run: python scripts/import_songs_csv.py ../songs_converted.csv")
        print("2. Remove security group rule for your IP")
        print("3. Test your application with the populated database")
        
    except Exception as e:
        print(f"Setup failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())