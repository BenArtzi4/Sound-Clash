# Phase 1: Database Setup & Song Loading - Instructions

## Overview
This phase sets up the database and loads 120+ songs from CSV into PostgreSQL.

## Prerequisites
- PostgreSQL RDS instance running
- Access credentials (host, database name, user, password)
- Python 3.11+ with asyncpg installed

## Step-by-Step Instructions

### Step 1: Set Environment Variables (2 minutes)

Open PowerShell and set your database credentials:

```powershell
# Set these to your actual RDS values
$env:DB_HOST = "sound-clash-db.xxxxx.us-east-1.rds.amazonaws.com"
$env:DB_NAME = "buzzer_game_db"  # or "soundclash" if that's what you used
$env:DB_USER = "postgres"
$env:DB_PASSWORD = "your-password-here"
$env:DB_PORT = "5432"
```

**How to find your RDS endpoint:**
```powershell
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[*].[DBInstanceIdentifier,Endpoint.Address,DBName]' --output table
```

### Step 2: Install Dependencies (1 minute)

```powershell
cd C:\Users\galbenar\Sound-Clash\backend\song-management
pip install asyncpg
```

### Step 3: Verify Database Schema (2 minutes)

This checks if tables exist and creates them if missing:

```powershell
python scripts/check_schema.py
```

**Expected output:**
```
✅ Table 'songs_master' exists (or creates it)
✅ Table 'genres' exists (or creates it)
✅ Table 'song_genres' exists (or creates it)
```

If tables don't exist, the script will offer to create them. Type `yes`.

### Step 4: Load Songs from CSV (3 minutes)

This imports all 120+ songs:

```powershell
python scripts/load_songs.py
```

**Expected output:**
```
✅ Parsed 120 songs from CSV
✅ Found 11 unique genres
🎵 Loading songs into database...
✅ IMPORT COMPLETE!
   Added: 120 songs
   Total: 120 songs in database
```

### Step 5: Verify Data Loaded (1 minute)

Check that songs are in database:

```powershell
# Quick verification
python -c "import asyncio, asyncpg, os; asyncio.run((lambda: asyncio.create_task(asyncpg.connect(host=os.getenv('DB_HOST'), database=os.getenv('DB_NAME'), user=os.getenv('DB_USER'), password=os.getenv('DB_PASSWORD')).execute('SELECT COUNT(*) FROM songs_master')))())"
```

Or use a proper SQL client:
```sql
SELECT COUNT(*) FROM songs_master;  -- Should show 120+
SELECT COUNT(*) FROM genres;        -- Should show 11
```

---

## Troubleshooting

### Error: "Invalid database password"
- Check your `DB_PASSWORD` environment variable
- Verify password is correct in RDS console

### Error: "Database does not exist"
- Check `DB_NAME` matches your RDS database name
- Common names: `buzzer_game_db`, `soundclash`, `postgres`
- Find it with: `aws rds describe-db-instances --query 'DBInstances[*].DBName'`

### Error: "Connection timeout"
- Check RDS security group allows inbound on port 5432
- Verify your IP address is whitelisted
- Check VPC/subnet configuration

### Error: "CSV file not found"
- Ensure you're in the correct directory
- Check file exists: `Test-Path C:\Users\galbenar\Sound-Clash\data\sample\songs_converted.csv`

---

## What Gets Created

### Tables Created:
1. **songs_master** - 120+ songs with title, artist, youtube_id, duration
2. **genres** - 11 genres (rock, pop, hip-hop, mizrahit, etc.)
3. **song_genres** - Many-to-many relationships between songs and genres

### Indexes Created:
- `idx_songs_title` - Fast title search
- `idx_songs_artist` - Fast artist search
- `idx_songs_youtube_id` - Fast YouTube ID lookup
- `idx_songs_active` - Filter active songs
- `idx_genres_slug` - Fast genre lookup
- `idx_genres_category` - Filter by category

---

## Verification Queries

After loading, verify your data:

```sql
-- Check total songs
SELECT COUNT(*) FROM songs_master WHERE is_active = TRUE;

-- Check genres
SELECT category, COUNT(*) as count 
FROM genres 
GROUP BY category;

-- Check songs per genre
SELECT g.name, COUNT(sg.song_id) as song_count
FROM genres g
LEFT JOIN song_genres sg ON g.id = sg.genre_id
GROUP BY g.id, g.name
ORDER BY song_count DESC;

-- Sample songs
SELECT id, title, artist, youtube_id 
FROM songs_master 
LIMIT 10;
```

---

## Next Steps

After Phase 1 is complete:
1. ✅ Verify 120+ songs loaded
2. ✅ Verify 11 genres created
3. → Move to **Phase 2**: Create Song Selection API endpoints

**Phase 2 Preview:**
- Create `/api/songs` endpoint (list songs)
- Create `/api/songs/{id}` endpoint (get single song)
- Create `/api/songs/select` endpoint (random selection)
- Create `/api/songs/genres` endpoint (list genres)

---

## Quick Commands Summary

```powershell
# Set environment variables (REQUIRED)
$env:DB_HOST = "your-rds-endpoint.us-east-1.rds.amazonaws.com"
$env:DB_NAME = "buzzer_game_db"
$env:DB_USER = "postgres"
$env:DB_PASSWORD = "your-password"

# Navigate to directory
cd C:\Users\galbenar\Sound-Clash\backend\song-management

# Install dependencies
pip install asyncpg

# Check schema
python scripts/check_schema.py

# Load songs
python scripts/load_songs.py
```

---

## Success Criteria

✅ Phase 1 is complete when:
- [ ] Database tables exist (songs_master, genres, song_genres)
- [ ] 120+ songs loaded successfully
- [ ] 11 genres created
- [ ] No errors in loading scripts
- [ ] Can query songs from database

**Estimated time: 10-15 minutes**
