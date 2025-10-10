"""
Import songs from CSV and create database tables
"""
import os
import sys
import csv
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

# CSV file path
csv_file = Path(__file__).parent.parent.parent / "data" / "sample" / "songs_converted.csv"
print(f"Loading songs from: {csv_file}")

# Get config from environment
DB_HOST = os.getenv('POSTGRES_HOST')
DB_PORT = os.getenv('POSTGRES_PORT', '5432')
DB_NAME = os.getenv('POSTGRES_DB', 'soundclash')
DB_USER = os.getenv('POSTGRES_USER', 'postgres')
DB_PASSWORD = os.getenv('POSTGRES_PASSWORD')

if not all([DB_HOST, DB_PASSWORD]):
    print("ERROR: Missing environment variables!")
    sys.exit(1)

# Map genre slugs to categories
GENRE_CATEGORIES = {
    'rock': 'Musical Styles',
    'pop': 'Musical Styles',
    'electronic': 'Musical Styles',
    'hip-hop': 'Musical Styles',
    'soundtracks': 'Media',
    'mizrahit': 'Israeli Music',
    'israeli-rock-pop': 'Israeli Music',
    'israeli-pop': 'Israeli Music',
    'israeli-rap-hip-hop': 'Israeli Music',
    'israeli-cover': 'Israeli Music',
}

GENRE_NAMES = {
    'rock': 'Rock',
    'pop': 'Pop',
    'electronic': 'Electronic',
    'hip-hop': 'Hip-Hop',
    'soundtracks': 'Soundtracks',
    'mizrahit': 'Mizrahit',
    'israeli-rock-pop': 'Israeli Rock Pop',
    'israeli-pop': 'Israeli Pop',
    'israeli-rap-hip-hop': 'Israeli Rap Hip-Hop',
    'israeli-cover': 'Israeli Cover',
}

print(f"Connecting to: {DB_HOST}:{DB_PORT}/{DB_NAME}")

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
    print("\n[1/6] Creating songs_master table...")
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
    print("\n[2/6] Creating genres table...")
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
    print("\n[3/6] Creating song_genres table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS song_genres (
            song_id INTEGER REFERENCES songs_master(id) ON DELETE CASCADE,
            genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
            PRIMARY KEY (song_id, genre_id)
        );
    """)
    print("✓ song_genres table created")
    
    # Create indexes
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
    
    # Read CSV and extract unique genres
    print("\n[4/6] Reading CSV and extracting genres...")
    songs_data = []
    genres_in_csv = set()
    
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Clean up the data
            title = row['title'].strip()
            artist = row['artist'].strip()
            duration = int(row['duration_seconds']) if row['duration_seconds'] else None
            youtube_id = row['youtube_id'].strip() if row['youtube_id'] else None
            genre_slug = row['genres'].strip().lower()
            
            # Skip rows with empty youtube_id or genre
            if not youtube_id or not genre_slug:
                continue
                
            genres_in_csv.add(genre_slug)
            songs_data.append({
                'title': title,
                'artist': artist,
                'duration_seconds': duration,
                'youtube_id': youtube_id,
                'genre_slug': genre_slug
            })
    
    print(f"✓ Found {len(songs_data)} songs with {len(genres_in_csv)} unique genres")
    print(f"  Genres: {', '.join(sorted(genres_in_csv))}")
    
    # Insert genres from CSV only
    print("\n[5/6] Creating genres from CSV...")
    for genre_slug in sorted(genres_in_csv):
        genre_name = GENRE_NAMES.get(genre_slug, genre_slug.replace('-', ' ').title())
        category = GENRE_CATEGORIES.get(genre_slug, 'Other')
        
        cursor.execute("""
            INSERT INTO genres (name, slug, category, is_active)
            VALUES (%s, %s, %s, true)
            ON CONFLICT (slug) DO NOTHING
        """, (genre_name, genre_slug, category))
    
    cursor.execute("SELECT COUNT(*) FROM genres")
    genre_count = cursor.fetchone()[0]
    print(f"✓ Created {genre_count} genres")
    
    # Insert songs
    print("\n[6/6] Importing songs...")
    imported = 0
    skipped = 0
    
    for song in songs_data:
        try:
            # Insert song
            cursor.execute("""
                INSERT INTO songs_master (title, artist, youtube_id, duration_seconds, is_active)
                VALUES (%s, %s, %s, %s, true)
                ON CONFLICT DO NOTHING
                RETURNING id
            """, (song['title'], song['artist'], song['youtube_id'], song['duration_seconds']))
            
            result = cursor.fetchone()
            if result:
                song_id = result[0]
                
                # Link to genre
                cursor.execute("""
                    INSERT INTO song_genres (song_id, genre_id)
                    SELECT %s, id FROM genres WHERE slug = %s
                    ON CONFLICT DO NOTHING
                """, (song_id, song['genre_slug']))
                
                imported += 1
                if imported % 10 == 0:
                    print(f"  Imported {imported}/{len(songs_data)} songs...")
            else:
                skipped += 1
                
        except Exception as e:
            print(f"  Error importing '{song['title']}': {e}")
            skipped += 1
    
    # Commit all changes
    conn.commit()
    
    # Final verification
    cursor.execute("SELECT COUNT(*) FROM songs_master")
    total_songs = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM genres")
    total_genres = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM song_genres")
    total_links = cursor.fetchone()[0]
    
    print("\n" + "="*60)
    print("DATABASE IMPORT COMPLETE!")
    print("="*60)
    print(f"Total songs in database: {total_songs}")
    print(f"Total genres in database: {total_genres}")
    print(f"Total song-genre links: {total_links}")
    print(f"Imported this run: {imported}")
    print(f"Skipped (duplicates): {skipped}")
    print("="*60)
    
    # Show genre breakdown
    print("\nGenre breakdown:")
    cursor.execute("""
        SELECT g.name, g.category, COUNT(sg.song_id) as song_count
        FROM genres g
        LEFT JOIN song_genres sg ON g.id = sg.genre_id
        GROUP BY g.id, g.name, g.category
        ORDER BY g.category, g.name
    """)
    
    for row in cursor.fetchall():
        print(f"  {row[0]} ({row[1]}): {row[2]} songs")
    
    cursor.close()
    conn.close()
    
    print("\n✓ All done! You can now test the API:")
    print("  curl https://api.soundclash.org/api/songs/genres/stats")
    
except Exception as e:
    print(f"\nERROR: {e}")
    import traceback
    traceback.print_exc()
    if 'conn' in locals():
        conn.rollback()
    sys.exit(1)
