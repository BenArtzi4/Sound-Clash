"""
Database migration script for simplified song schema
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
    DB_NAME = os.getenv('POSTGRES_DB', 'soundclash')
    DB_USER = os.getenv('POSTGRES_USER', 'postgres')
    DB_PASSWORD = os.getenv('POSTGRES_PASSWORD')
    
    if not DB_PASSWORD:
        print("Error: POSTGRES_PASSWORD environment variable not set!")
        print("Please set your database environment variables.")
        sys.exit(1)
    
    return f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

def test_connection():
    """Test database connection"""
    DB_HOST = os.getenv('POSTGRES_HOST')
    DB_PORT = os.getenv('POSTGRES_PORT', '5432')
    DB_NAME = os.getenv('POSTGRES_DB', 'soundclash')
    DB_USER = os.getenv('POSTGRES_USER', 'postgres')
    DB_PASSWORD = os.getenv('POSTGRES_PASSWORD')
    
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            connect_timeout=30
        )
        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()[0]
        print(f"✓ Connection successful! Database version: {version[:50]}...")
        cursor.close()
        conn.close()
        return True
    except Exception as e:
        print(f"✗ Connection failed: {e}")
        return False

async def run_migration():
    """Run database migration for simplified schema"""
    if not test_connection():
        print("Connection test failed.")
        sys.exit(1)
    
    database_url = get_database_url()
    
    try:
        engine = create_engine(database_url, connect_args={"connect_timeout": 30})
        
        print("Creating database tables...")
        
        with engine.connect() as conn:
            trans = conn.begin()
            
            try:
                # Create simplified songs table
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS songs (
                        id SERIAL PRIMARY KEY,
                        title VARCHAR(200) NOT NULL,
                        artist VARCHAR(200) NOT NULL,
                        youtube_id VARCHAR(20),
                        youtube_url VARCHAR(500),
                        is_active BOOLEAN DEFAULT true,
                        play_count INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """))
                
                # Create genres table
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS genres (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(100) NOT NULL UNIQUE,
                        slug VARCHAR(100) NOT NULL UNIQUE,
                        description TEXT,
                        category VARCHAR(50) NOT NULL,
                        is_active BOOLEAN DEFAULT true,
                        sort_order INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """))
                
                # Create song_genres junction table
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS song_genres (
                        song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
                        genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
                        PRIMARY KEY (song_id, genre_id)
                    );
                """))
                
                # Create useful indexes
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_songs_active_youtube 
                    ON songs(is_active, youtube_id) 
                    WHERE is_active = true AND youtube_id IS NOT NULL;
                """))
                
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS idx_genres_category_active 
                    ON genres(category, is_active) 
                    WHERE is_active = true;
                """))
                
                print("✓ Tables created successfully!")
                
                trans.commit()
                print("✓ Migration completed successfully!")
                
            except Exception as e:
                trans.rollback()
                raise e
                
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)

async def seed_genres():
    """Seed database with genres"""
    database_url = get_database_url()
    engine = create_engine(database_url, connect_args={"connect_timeout": 30})
    
    print("Seeding genre data...")
    
    try:
        with engine.connect() as conn:
            # Check if genres already exist
            result = conn.execute(text("SELECT COUNT(*) FROM genres"))
            count = result.scalar()
            
            if count > 0:
                print(f"✓ Database already has {count} genres, skipping seed")
                return
            
            # Insert genres
            genres_sql = """
                INSERT INTO genres (name, slug, description, category, sort_order, is_active) VALUES
                ('Rock', 'rock', 'Classic and modern rock music', 'styles', 1, true),
                ('Pop', 'pop', 'Popular music across all eras', 'styles', 2, true),
                ('Hip-Hop', 'hip-hop', 'Hip-hop and rap music', 'styles', 3, true),
                ('Electronic', 'electronic', 'Electronic dance music and EDM', 'styles', 4, true),
                ('Soundtracks', 'soundtracks', 'Movie and TV soundtrack songs', 'media', 5, true),
                ('Mizrahit', 'mizrahit', 'Israeli Middle Eastern pop music', 'israeli', 6, true),
                ('Israeli Rock Pop', 'israeli-rock-pop', 'Israeli rock and pop fusion', 'israeli', 7, true),
                ('Israeli Pop', 'israeli-pop', 'Contemporary Israeli pop music', 'israeli', 8, true),
                ('Israeli Rap Hip-Hop', 'israeli-rap-hip-hop', 'Israeli rap and hip-hop', 'israeli', 9, true),
                ('Israeli Cover', 'israeli-cover', 'Israeli cover versions and interpretations', 'israeli', 10, true)
                ON CONFLICT (slug) DO NOTHING;
            """
            
            conn.execute(text(genres_sql))
            conn.commit()
            print("✓ Genre data seeded!")
            
    except Exception as e:
        print(f"Seeding failed: {e}")

async def main():
    """Run migrations and seeding"""
    try:
        await run_migration()
        await seed_genres()
        print("\n🎉 Database setup completed!")
        
    except Exception as e:
        print(f"Setup failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())