"""
Simple database table creation script - loads from .env/production.env
"""
import os
import sys
from pathlib import Path

# Install required packages
try:
    import psycopg2
    from dotenv import load_dotenv
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "python-dotenv"])
    import psycopg2
    from dotenv import load_dotenv

# Load environment from production.env
env_file = Path(__file__).parent.parent.parent / ".env" / "production.env"
print(f"Loading environment from: {env_file}")
load_dotenv(env_file)

# Get config from environment
DB_HOST = os.getenv('POSTGRES_HOST')
DB_PORT = os.getenv('POSTGRES_PORT', '5432')
DB_NAME = os.getenv('POSTGRES_DB', 'soundclash')
DB_USER = os.getenv('POSTGRES_USER', 'postgres')
DB_PASSWORD = os.getenv('POSTGRES_PASSWORD')

if not all([DB_HOST, DB_PASSWORD]):
    print("ERROR: Missing environment variables!")
    print("Required: POSTGRES_HOST, POSTGRES_PASSWORD")
    print(f"DB_HOST: {DB_HOST}")
    print(f"DB_PASSWORD: {'*' * len(DB_PASSWORD) if DB_PASSWORD else 'NOT SET'}")
    sys.exit(1)

print(f"Connecting to: {DB_HOST}:{DB_PORT}/{DB_NAME} as {DB_USER}")

try:
    # Connect to database
    conn = psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=30
    )
    conn.autocommit = False
    cursor = conn.cursor()
    
    print("✓ Connected successfully!")
    
    # Create songs table
    print("\nCreating songs_master table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS songs_master (
            id SERIAL PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            artist VARCHAR(200) NOT NULL,
            album VARCHAR(200),
            youtube_id VARCHAR(20),
            spotify_id VARCHAR(50),
            duration_seconds INTEGER,
            release_year INTEGER,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    print("✓ songs_master table created")
    
    # Create genres table
    print("\nCreating genres table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS genres (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            slug VARCHAR(100) NOT NULL UNIQUE,
            description TEXT,
            category VARCHAR(50) NOT NULL,
            parent_id INTEGER REFERENCES genres(id),
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    print("✓ genres table created")
    
    # Create song_genres junction table
    print("\nCreating song_genres table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS song_genres (
            song_id INTEGER REFERENCES songs_master(id) ON DELETE CASCADE,
            genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
            PRIMARY KEY (song_id, genre_id)
        );
    """)
    print("✓ song_genres table created")
    
    # Create indexes
    print("\nCreating indexes...")
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_songs_active 
        ON songs_master(is_active) WHERE is_active = true;
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_songs_youtube 
        ON songs_master(youtube_id) WHERE youtube_id IS NOT NULL;
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_genres_category 
        ON genres(category, is_active);
    """)
    print("✓ Indexes created")
    
    # Check if genres exist
    cursor.execute("SELECT COUNT(*) FROM genres")
    genre_count = cursor.fetchone()[0]
    
    if genre_count == 0:
        print("\nSeeding genres...")
        cursor.execute("""
            INSERT INTO genres (name, slug, category, description, is_active) VALUES
            ('Israeli Rock', 'israeli-rock', 'Israeli Music', 'Israeli rock music', true),
            ('Israeli Pop', 'israeli-pop', 'Israeli Music', 'Israeli pop music', true),
            ('Hafla', 'hafla', 'Israeli Music', 'Israeli party music', true),
            ('Israeli Classics', 'israeli-classics', 'Israeli Music', 'Classic Israeli songs', true),
            ('Rock', 'rock', 'Musical Styles', 'Rock music', true),
            ('Pop', 'pop', 'Musical Styles', 'Pop music', true),
            ('Hip-Hop', 'hip-hop', 'Musical Styles', 'Hip-hop and rap', true),
            ('Electronic', 'electronic', 'Musical Styles', 'Electronic music', true),
            ('Country', 'country', 'Musical Styles', 'Country music', true),
            ('R&B', 'rnb', 'Musical Styles', 'R&B and soul', true),
            ('60s-70s', '60s-70s', 'Decades', '1960s and 1970s', true),
            ('80s', '80s', 'Decades', '1980s', true),
            ('90s', '90s', 'Decades', '1990s', true),
            ('2000s', '2000s', 'Decades', '2000s', true),
            ('2010s', '2010s', 'Decades', '2010s', true),
            ('2020s', '2020s', 'Decades', '2020s', true),
            ('Movie Soundtracks', 'movie-soundtracks', 'Media', 'Songs from movies', true),
            ('TV Themes', 'tv-themes', 'Media', 'TV show themes', true),
            ('Disney', 'disney', 'Media', 'Disney songs', true),
            ('Video Games', 'video-games', 'Media', 'Video game music', true)
            ON CONFLICT (slug) DO NOTHING;
        """)
        cursor.execute("SELECT COUNT(*) FROM genres")
        genre_count = cursor.fetchone()[0]
        print(f"✓ Seeded {genre_count} genres")
    else:
        print(f"\n✓ Database already has {genre_count} genres")
    
    # Commit all changes
    conn.commit()
    
    # Final verification
    cursor.execute("SELECT COUNT(*) FROM songs_master")
    song_count = cursor.fetchone()[0]
    
    print("\n" + "="*50)
    print("DATABASE SETUP COMPLETE!")
    print("="*50)
    print(f"Songs: {song_count}")
    print(f"Genres: {genre_count}")
    print("="*50)
    
    cursor.close()
    conn.close()
    
except Exception as e:
    print(f"\nERROR: {e}")
    if 'conn' in locals():
        conn.rollback()
    sys.exit(1)
