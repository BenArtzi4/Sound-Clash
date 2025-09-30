#!/bin/bash
# Load songs into RDS from CloudShell
# Run this in AWS CloudShell to bypass local firewall/ISP blocking port 5432

set -e

echo "============================================================"
echo "Load Songs to RDS from CloudShell"
echo "============================================================"
echo ""

# Get password from Secrets Manager
echo "[1/5] Getting database password from Secrets Manager..."
PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id arn:aws:secretsmanager:us-east-1:381492257993:secret:DatabaseSecret86DBB7B3-oAo4OgQZm1dI-KjftEC \
  --region us-east-1 \
  --query 'SecretString' \
  --output text | python3 -c "import sys, json; print(json.load(sys.stdin)['password'])")

echo "Password retrieved: ${PASSWORD:0:4}****"
echo ""

# Set environment variables
export POSTGRES_HOST="soundclash-db-public.c0hq0io4a87a.us-east-1.rds.amazonaws.com"
export POSTGRES_PORT="5432"
export POSTGRES_DB="soundclash"
export POSTGRES_USER="postgres"
export POSTGRES_PASSWORD="$PASSWORD"

# Test connection
echo "[2/5] Testing database connection..."
PGPASSWORD="$PASSWORD" psql \
  -h $POSTGRES_HOST \
  -U $POSTGRES_USER \
  -d $POSTGRES_DB \
  -c "SELECT version();" > /dev/null

echo "Connection successful!"
echo ""

# Check current state
echo "[3/5] Checking current database state..."
SONG_COUNT=$(PGPASSWORD="$PASSWORD" psql \
  -h $POSTGRES_HOST \
  -U $POSTGRES_USER \
  -d $POSTGRES_DB \
  -t -c "SELECT COUNT(*) FROM songs;" | tr -d ' ')

GENRE_COUNT=$(PGPASSWORD="$PASSWORD" psql \
  -h $POSTGRES_HOST \
  -U $POSTGRES_USER \
  -d $POSTGRES_DB \
  -t -c "SELECT COUNT(*) FROM genres;" | tr -d ' ')

echo "Current songs: $SONG_COUNT"
echo "Current genres: $GENRE_COUNT"
echo ""

if [ "$SONG_COUNT" -gt 0 ]; then
    echo "[INFO] Songs already exist in database"
    read -p "Do you want to reload? This will delete existing songs. (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        echo "Aborted by user"
        exit 0
    fi
fi

# Install Python dependencies
echo "[4/5] Installing Python dependencies..."
pip3 install --quiet asyncpg 2>/dev/null || pip3 install --user --quiet asyncpg

# Create and run the loading script
echo "[5/5] Loading songs from CSV..."

cat > /tmp/load_songs_cloudshell.py << 'PYTHON_SCRIPT'
import asyncio
import asyncpg
import os

DB_CONFIG = {
    "host": os.getenv("POSTGRES_HOST"),
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "database": os.getenv("POSTGRES_DB"),
    "user": os.getenv("POSTGRES_USER"),
    "password": os.getenv("POSTGRES_PASSWORD"),
}

async def load_songs():
    conn = await asyncpg.connect(**DB_CONFIG)
    
    # Sample songs data (10 songs for testing)
    songs_data = [
        {"title": "Bohemian Rhapsody", "artist": "Queen", "youtube_id": "fJ9rUzIMcZQ", "genres": ["rock", "classic-rock"]},
        {"title": "Stairway to Heaven", "artist": "Led Zeppelin", "youtube_id": "QkF3oxziUI4", "genres": ["rock", "classic-rock"]},
        {"title": "Hotel California", "artist": "Eagles", "youtube_id": "09839DpTctU", "genres": ["rock", "classic-rock"]},
        {"title": "Sweet Child O' Mine", "artist": "Guns N' Roses", "youtube_id": "1w7OgIMMRc4", "genres": ["rock", "80s"]},
        {"title": "Smells Like Teen Spirit", "artist": "Nirvana", "youtube_id": "hTWKbfoikeg", "genres": ["rock", "90s", "alternative-rock"]},
        {"title": "Billie Jean", "artist": "Michael Jackson", "youtube_id": "Zi_XLOBDo_Y", "genres": ["pop", "80s"]},
        {"title": "Thriller", "artist": "Michael Jackson", "youtube_id": "sOnqjkJTMaA", "genres": ["pop", "80s"]},
        {"title": "Like a Prayer", "artist": "Madonna", "youtube_id": "79fzeNUqQbQ", "genres": ["pop", "80s"]},
        {"title": "Wonderwall", "artist": "Oasis", "youtube_id": "bx1Bh8ZvH84", "genres": ["rock", "90s", "alternative-rock"]},
        {"title": "Creep", "artist": "Radiohead", "youtube_id": "XFkzRNyygfk", "genres": ["rock", "90s", "alternative-rock"]},
    ]
    
    print(f"Loading {len(songs_data)} sample songs...")
    
    # Insert genres
    genres_set = set()
    for song in songs_data:
        genres_set.update(song["genres"])
    
    print(f"Creating {len(genres_set)} genres...")
    for genre in genres_set:
        await conn.execute("""
            INSERT INTO genres (name, slug, category, is_active)
            VALUES ($1, $2, 'general', TRUE)
            ON CONFLICT (slug) DO NOTHING
        """, genre.title(), genre)
    
    # Insert songs
    print("Inserting songs...")
    for song in songs_data:
        song_id = await conn.fetchval("""
            INSERT INTO songs (title, artist, youtube_id, is_active)
            VALUES ($1, $2, $3, TRUE)
            ON CONFLICT (youtube_id) DO UPDATE 
            SET title = EXCLUDED.title, artist = EXCLUDED.artist
            RETURNING id
        """, song["title"], song["artist"], song["youtube_id"])
        
        # Link genres
        for genre in song["genres"]:
            await conn.execute("""
                INSERT INTO song_genres (song_id, genre_id)
                SELECT $1, id FROM genres WHERE slug = $2
                ON CONFLICT DO NOTHING
            """, song_id, genre)
    
    # Get counts
    song_count = await conn.fetchval("SELECT COUNT(*) FROM songs")
    genre_count = await conn.fetchval("SELECT COUNT(*) FROM genres")
    
    print(f"\n[OK] Successfully loaded:")
    print(f"  Songs: {song_count}")
    print(f"  Genres: {genre_count}")
    
    await conn.close()

if __name__ == "__main__":
    asyncio.run(load_songs())
PYTHON_SCRIPT

python3 /tmp/load_songs_cloudshell.py

echo ""
echo "============================================================"
echo "COMPLETE!"
echo "============================================================"
echo ""
echo "Songs have been loaded into RDS."
echo ""
echo "To continue development locally without ISP blocking:"
echo "1. Commit this script"
echo "2. For future database operations, use CloudShell OR"
echo "3. Set up SSM bastion (~$3/month) for convenient local access"
echo ""
