#!/bin/bash
# Import songs from CSV to RDS via CloudShell
# Usage: bash import_songs_cloudshell.sh songs_converted.csv

set -e

CSV_FILE="${1:-songs_converted.csv}"

if [ ! -f "$CSV_FILE" ]; then
    echo "ERROR: CSV file '$CSV_FILE' not found!"
    echo "Usage: bash import_songs_cloudshell.sh <csv_file>"
    exit 1
fi

echo "============================================================"
echo "Import Songs to RDS from CloudShell"
echo "============================================================"

# Get password from Secrets Manager - find the correct secret first
echo "[1/7] Getting database password from Secrets Manager..."

# List secrets to find the right one
SECRET_ARN=$(aws secretsmanager list-secrets --region us-east-1 --query 'SecretList[?contains(Name, `Database`) || contains(Name, `database`)].ARN | [0]' --output text)

if [ -z "$SECRET_ARN" ] || [ "$SECRET_ARN" = "None" ]; then
    echo "ERROR: Could not find database secret in Secrets Manager"
    echo "Available secrets:"
    aws secretsmanager list-secrets --region us-east-1 --query 'SecretList[].Name'
    exit 1
fi

echo "Found secret: $SECRET_ARN"

PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ARN" \
  --region us-east-1 \
  --query 'SecretString' \
  --output text | python3 -c "import sys, json; print(json.load(sys.stdin)['password'])")

if [ -z "$PASSWORD" ]; then
    echo "ERROR: Failed to retrieve password"
    exit 1
fi

echo "✓ Password retrieved"

# Database connection details
export POSTGRES_HOST="soundclashdatabasestack-postgresdatabase0a8a7373-ns8v6fcsy4fw.c0hq0io4a87a.us-east-1.rds.amazonaws.com"
export POSTGRES_PORT="5432"
export POSTGRES_DB="soundclash"
export POSTGRES_USER="postgres"
export PGPASSWORD="$PASSWORD"

# Test connection
echo "[2/7] Testing database connection..."
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT version();" > /dev/null
echo "✓ Connection successful"

# Create tables
echo "[3/7] Creating database tables..."
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB << 'SQL'
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

CREATE TABLE IF NOT EXISTS song_genres (
    song_id INTEGER REFERENCES songs_master(id) ON DELETE CASCADE,
    genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (song_id, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_songs_active ON songs_master(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_songs_youtube ON songs_master(youtube_id) WHERE youtube_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_genres_category ON genres(category, is_active);
SQL

echo "✓ Tables created"

# Create genres
echo "[4/7] Creating genres..."
psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB << 'SQL'
INSERT INTO genres (name, slug, category, is_active) VALUES
('Rock', 'rock', 'Musical Styles', true),
('Pop', 'pop', 'Musical Styles', true),
('Electronic', 'electronic', 'Musical Styles', true),
('Hip-Hop', 'hip-hop', 'Musical Styles', true),
('Soundtracks', 'soundtracks', 'Media', true),
('Mizrahit', 'mizrahit', 'Israeli Music', true),
('Israeli Rock Pop', 'israeli-rock-pop', 'Israeli Music', true),
('Israeli Pop', 'israeli-pop', 'Israeli Music', true),
('Israeli Rap Hip-Hop', 'israeli-rap-hip-hop', 'Israeli Music', true),
('Israeli Cover', 'israeli-cover', 'Israeli Music', true)
ON CONFLICT (slug) DO NOTHING;
SQL

GENRE_COUNT=$(psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB -t -c "SELECT COUNT(*) FROM genres;" | tr -d ' ')
echo "✓ Created $GENRE_COUNT genres"

# Count CSV rows
TOTAL_SONGS=$(tail -n +2 "$CSV_FILE" | wc -l)
echo "[5/7] Found $TOTAL_SONGS songs in CSV"

# Install Python package if needed
echo "[6/7] Installing dependencies..."
pip3 install --quiet asyncpg 2>/dev/null || pip3 install --user --quiet asyncpg

# Create Python import script
echo "[7/7] Importing songs..."

cat > /tmp/import_songs.py << 'PYTHON_SCRIPT'
import asyncio
import asyncpg
import csv
import sys
import os

DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST"),
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "database": os.getenv("POSTGRES_DB"),
    "user": os.getenv("POSTGRES_USER"),
    "password": os.getenv("PGPASSWORD"),
}

async def import_songs(csv_file):
    conn = await asyncpg.connect(**DB_CONFIG)
    
    # Read CSV
    songs_data = []
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            title = row['title'].strip()
            artist = row['artist'].strip()
            duration = int(row['duration_seconds']) if row['duration_seconds'] else None
            youtube_id = row['youtube_id'].strip() if row['youtube_id'] else None
            genre_slug = row['genres'].strip().lower()
            
            if youtube_id and genre_slug:
                songs_data.append({
                    'title': title,
                    'artist': artist,
                    'duration_seconds': duration,
                    'youtube_id': youtube_id,
                    'genre_slug': genre_slug
                })
    
    print(f"Importing {len(songs_data)} songs...")
    
    imported = 0
    skipped = 0
    
    for song in songs_data:
        try:
            # Insert song
            song_id = await conn.fetchval("""
                INSERT INTO songs_master (title, artist, youtube_id, duration_seconds, is_active)
                VALUES ($1, $2, $3, $4, true)
                RETURNING id
            """, song['title'], song['artist'], song['youtube_id'], song['duration_seconds'])
            
            # Link to genre
            await conn.execute("""
                INSERT INTO song_genres (song_id, genre_id)
                SELECT $1, id FROM genres WHERE slug = $2
                ON CONFLICT DO NOTHING
            """, song_id, song['genre_slug'])
            
            imported += 1
            if imported % 20 == 0:
                print(f"  Progress: {imported}/{len(songs_data)}")
                
        except Exception as e:
            skipped += 1
    
    # Get final counts
    total_songs = await conn.fetchval("SELECT COUNT(*) FROM songs_master")
    total_genres = await conn.fetchval("SELECT COUNT(*) FROM genres")
    
    print(f"\n{'='*60}")
    print("IMPORT COMPLETE!")
    print(f"{'='*60}")
    print(f"Total songs in database: {total_songs}")
    print(f"Total genres: {total_genres}")
    print(f"Imported this run: {imported}")
    print(f"Skipped (errors): {skipped}")
    print(f"{'='*60}")
    
    # Genre breakdown
    print("\nGenre breakdown:")
    rows = await conn.fetch("""
        SELECT g.name, COUNT(sg.song_id) as song_count
        FROM genres g
        LEFT JOIN song_genres sg ON g.id = sg.genre_id
        GROUP BY g.id, g.name
        ORDER BY song_count DESC
    """)
    
    for row in rows:
        print(f"  {row['name']}: {row['song_count']} songs")
    
    await conn.close()

if __name__ == "__main__":
    csv_file = sys.argv[1] if len(sys.argv) > 1 else "songs_converted.csv"
    asyncio.run(import_songs(csv_file))
PYTHON_SCRIPT

python3 /tmp/import_songs.py "$CSV_FILE"

echo ""
echo "============================================================"
echo "ALL DONE!"
echo "============================================================"
echo ""
echo "Test the API:"
echo "  curl https://api.soundclash.org/api/songs/genres/stats"
echo ""
