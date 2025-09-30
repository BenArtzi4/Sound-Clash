"""
Load Songs from CSV - Import songs from data/sample/songs_converted.csv
This script loads all songs and their genres into the database
UPDATED: Removed 'alternative rock' genre
"""
import asyncio
import asyncpg
import os
import csv
from pathlib import Path
from typing import Dict, List, Set

# Database configuration
DATABASE_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "database": os.getenv("DB_NAME", "buzzer_game_db"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "password"),
}

# Path to CSV file
CSV_PATH = Path(__file__).parent.parent.parent.parent / "data" / "sample" / "songs_converted.csv"

# Genre categories mapping (10 genres total - NO alternative rock)
GENRE_CATEGORIES = {
    'rock': 'styles',
    'pop': 'styles',
    'hip-hop': 'styles',
    'electronic': 'styles',
    'soundtracks': 'media',
    'mizrahit': 'israeli',
    'israeli-rock-pop': 'israeli',
    'israeli-pop': 'israeli',
    'israeli-rap-hip-hop': 'israeli',
    'israeli-cover': 'israeli',
}

async def create_tables_if_needed(conn: asyncpg.Connection):
    """Create tables if they don't exist"""
    print("🔨 Ensuring tables exist...")
    
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS songs_master (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            artist VARCHAR(255) NOT NULL,
            album VARCHAR(255),
            youtube_id VARCHAR(50) UNIQUE,
            spotify_id VARCHAR(100),
            duration_seconds INTEGER,
            release_year INTEGER,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS genres (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            slug VARCHAR(100) UNIQUE NOT NULL,
            description TEXT,
            category VARCHAR(50),
            parent_id INTEGER REFERENCES genres(id),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS song_genres (
            song_id INTEGER REFERENCES songs_master(id) ON DELETE CASCADE,
            genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
            PRIMARY KEY (song_id, genre_id)
        )
    """)
    
    # Create indexes
    await conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_songs_title ON songs_master(title);
        CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs_master(artist);
        CREATE INDEX IF NOT EXISTS idx_songs_youtube_id ON songs_master(youtube_id);
        CREATE INDEX IF NOT EXISTS idx_songs_active ON songs_master(is_active);
        CREATE INDEX IF NOT EXISTS idx_genres_slug ON genres(slug);
        CREATE INDEX IF NOT EXISTS idx_genres_category ON genres(category);
    """)
    
    print("  ✅ Tables ready")

async def load_genres(conn: asyncpg.Connection, genre_names: Set[str]) -> Dict[str, int]:
    """Load genres into database and return mapping of slug -> id"""
    print(f"\n📁 Loading {len(genre_names)} unique genres...")
    
    genre_mapping = {}
    
    for genre_name in sorted(genre_names):
        # Create slug (lowercase, replace spaces with hyphens)
        slug = genre_name.lower().strip()
        
        # Skip if not in our approved list
        if slug not in GENRE_CATEGORIES:
            print(f"  ⚠️  Skipping unknown genre: {genre_name}")
            continue
        
        # Determine category
        category = GENRE_CATEGORIES[slug]
        
        # Insert or get existing genre
        try:
            genre_id = await conn.fetchval("""
                INSERT INTO genres (name, slug, category, is_active)
                VALUES ($1, $2, $3, TRUE)
                ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
                RETURNING id
            """, genre_name, slug, category)
            
            genre_mapping[slug] = genre_id
            print(f"  ✓ {genre_name:25s} (category: {category})")
        except Exception as e:
            print(f"  ✗ Error loading genre '{genre_name}': {e}")
    
    print(f"  ✅ Loaded {len(genre_mapping)} genres")
    return genre_mapping

async def load_songs_from_csv(conn: asyncpg.Connection):
    """Load songs from CSV file"""
    print("\n" + "=" * 60)
    print("📥 LOADING SONGS FROM CSV")
    print("=" * 60)
    
    # Check if CSV exists
    if not CSV_PATH.exists():
        print(f"❌ ERROR: CSV file not found at {CSV_PATH}")
        print(f"   Expected location: {CSV_PATH.absolute()}")
        return
    
    print(f"\n📄 Reading CSV: {CSV_PATH.name}")
    print(f"   Full path: {CSV_PATH.absolute()}\n")
    
    # Read CSV and collect unique genres
    songs_data = []
    all_genres = set()
    line_number = 0
    
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        for row in reader:
            line_number += 1
            
            # Skip empty rows or comments
            if not row.get('title') or row['title'].startswith('#'):
                continue
            
            # Skip rows with missing required fields
            if not row.get('youtube_id') or not row.get('artist'):
                print(f"  ⚠️  Line {line_number}: Skipping song '{row.get('title', 'Unknown')}' - missing required fields")
                continue
            
            # Parse genres (comma-separated)
            genres = [g.strip() for g in row.get('genres', '').split(',') if g.strip()]
            
            # Filter out unknown genres
            valid_genres = [g for g in genres if g.lower() in GENRE_CATEGORIES]
            if len(valid_genres) != len(genres):
                skipped = set(genres) - set(valid_genres)
                if skipped:
                    print(f"  ⚠️  Line {line_number}: '{row['title']}' - skipping unknown genres: {skipped}")
            
            if not valid_genres:
                print(f"  ⚠️  Line {line_number}: Skipping song '{row['title']}' - no valid genres")
                continue
            
            all_genres.update(valid_genres)
            
            # Parse duration safely
            duration = None
            if row.get('duration_seconds'):
                try:
                    duration = int(row['duration_seconds'])
                except ValueError:
                    print(f"  ⚠️  Line {line_number}: '{row['title']}' - invalid duration: {row.get('duration_seconds')}")
            
            songs_data.append({
                'title': row['title'].strip(),
                'artist': row['artist'].strip(),
                'youtube_id': row['youtube_id'].strip(),
                'duration_seconds': duration,
                'genres': valid_genres
            })
    
    print(f"✅ Parsed {len(songs_data)} valid songs from CSV")
    print(f"✅ Found {len(all_genres)} unique genres")
    
    if not songs_data:
        print("❌ No valid songs found in CSV!")
        return
    
    # Load genres first
    genre_mapping = await load_genres(conn, all_genres)
    
    if not genre_mapping:
        print("❌ No valid genres loaded!")
        return
    
    # Load songs
    print(f"\n🎵 Loading songs into database...")
    
    added_count = 0
    updated_count = 0
    skipped_count = 0
    
    for i, song in enumerate(songs_data, 1):
        try:
            # Check if song exists (by youtube_id)
            existing_id = await conn.fetchval("""
                SELECT id FROM songs_master WHERE youtube_id = $1
            """, song['youtube_id'])
            
            if existing_id:
                # Update existing song
                await conn.execute("""
                    UPDATE songs_master 
                    SET title = $1, artist = $2, duration_seconds = $3, 
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $4
                """, song['title'], song['artist'], song['duration_seconds'], existing_id)
                
                song_id = existing_id
                updated_count += 1
                status = "Updated"
            else:
                # Insert new song
                song_id = await conn.fetchval("""
                    INSERT INTO songs_master (title, artist, youtube_id, duration_seconds, is_active)
                    VALUES ($1, $2, $3, $4, TRUE)
                    RETURNING id
                """, song['title'], song['artist'], song['youtube_id'], song['duration_seconds'])
                
                added_count += 1
                status = "Added"
            
            # Clear existing genre links for this song
            await conn.execute("DELETE FROM song_genres WHERE song_id = $1", song_id)
            
            # Link genres
            genres_linked = 0
            for genre_name in song['genres']:
                genre_slug = genre_name.lower().strip()
                genre_id = genre_mapping.get(genre_slug)
                
                if genre_id:
                    await conn.execute("""
                        INSERT INTO song_genres (song_id, genre_id)
                        VALUES ($1, $2)
                        ON CONFLICT DO NOTHING
                    """, song_id, genre_id)
                    genres_linked += 1
            
            # Progress indicator
            if i % 10 == 0:
                print(f"  Progress: {i}/{len(songs_data)} songs processed...")
        
        except Exception as e:
            print(f"  ⚠️  Error with song '{song['title']}': {e}")
            skipped_count += 1
    
    # Summary
    print("\n" + "=" * 60)
    print("✅ IMPORT COMPLETE!")
    print("=" * 60)
    print(f"Added: {added_count} songs")
    print(f"Updated: {updated_count} songs")
    print(f"Skipped: {skipped_count} songs")
    print(f"Total: {added_count + updated_count} songs in database")
    
    # Verify final counts
    total_songs = await conn.fetchval("SELECT COUNT(*) FROM songs_master WHERE is_active = TRUE")
    total_genres = await conn.fetchval("SELECT COUNT(*) FROM genres WHERE is_active = TRUE")
    
    print(f"\n📊 Database Status:")
    print(f"   Songs: {total_songs}")
    print(f"   Genres: {total_genres}")
    
    # Show genre breakdown
    print(f"\n🏷️  Genre Breakdown:")
    genre_stats = await conn.fetch("""
        SELECT g.name, g.category, COUNT(sg.song_id) as song_count
        FROM genres g
        LEFT JOIN song_genres sg ON g.id = sg.genre_id
        WHERE g.is_active = TRUE
        GROUP BY g.id, g.name, g.category
        ORDER BY song_count DESC
    """)
    
    for genre in genre_stats:
        print(f"   {genre['name']:25s} ({genre['category']:10s}): {genre['song_count']:3d} songs")

async def main():
    """Main function"""
    print("\n" + "=" * 60)
    print("🎵 SOUND CLASH - SONG DATA LOADER")
    print("=" * 60)
    
    print(f"\n📡 Database Connection:")
    print(f"   Host: {DATABASE_CONFIG['host']}")
    print(f"   Database: {DATABASE_CONFIG['database']}")
    print(f"   User: {DATABASE_CONFIG['user']}")
    
    try:
        # Connect
        print("\n🔌 Connecting to database...")
        conn = await asyncpg.connect(**DATABASE_CONFIG)
        print("   ✅ Connected!\n")
        
        # Create tables if needed
        await create_tables_if_needed(conn)
        
        # Load songs
        await load_songs_from_csv(conn)
        
        # Close connection
        await conn.close()
        print("\n✅ All done! Songs are ready to use in the game.")
        
    except asyncpg.InvalidPasswordError:
        print("❌ ERROR: Invalid database password")
        print("   Set DB_PASSWORD environment variable")
    except asyncpg.InvalidCatalogNameError:
        print(f"❌ ERROR: Database '{DATABASE_CONFIG['database']}' does not exist")
        print("   Create the database first")
    except FileNotFoundError as e:
        print(f"❌ ERROR: {e}")
    except Exception as e:
        print(f"❌ ERROR: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
