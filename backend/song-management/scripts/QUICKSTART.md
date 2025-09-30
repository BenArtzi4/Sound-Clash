# 🚀 QUICK START - Phase 1: Database & Song Loading

## What You'll Do
Load 120+ songs from CSV into your PostgreSQL RDS database (takes 10-15 minutes).

---

## Option 1: Automated Setup (Recommended) ⚡

```powershell
# 1. Navigate to song-management directory
cd C:\Users\galbenar\Sound-Clash\backend\song-management

# 2. Set your database credentials (GET THESE FROM RDS CONSOLE)
$env:DB_HOST = "sound-clash-db.xxxxx.us-east-1.rds.amazonaws.com"  # YOUR RDS ENDPOINT
$env:DB_NAME = "buzzer_game_db"  # or "soundclash" 
$env:DB_USER = "postgres"
$env:DB_PASSWORD = "your-password-here"
$env:DB_PORT = "5432"

# 3. Run the automated setup script
.\scripts\setup_phase1.ps1
```

The script will:
- ✅ Check environment variables
- ✅ Install dependencies (asyncpg)
- ✅ Verify CSV file exists
- ✅ Check/create database tables
- ✅ Load 120+ songs with genres

---

## Option 2: Manual Step-by-Step 📝

### Step 1: Set Environment Variables
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\song-management

# Find your RDS endpoint first
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[*].[DBInstanceIdentifier,Endpoint.Address,DBName]' --output table

# Set credentials
$env:DB_HOST = "your-rds-endpoint-here"
$env:DB_NAME = "buzzer_game_db"  # Use the name from above query
$env:DB_USER = "postgres"
$env:DB_PASSWORD = "your-password"
$env:DB_PORT = "5432"
```

### Step 2: Install Dependencies
```powershell
pip install asyncpg
```

### Step 3: Check Database Schema
```powershell
python scripts\check_schema.py
```

If tables don't exist, type `yes` when prompted to create them.

### Step 4: Load Songs
```powershell
python scripts\load_songs.py
```

Expected output:
```
✅ Parsed 120 songs from CSV
✅ Found 11 unique genres
✅ IMPORT COMPLETE!
   Added: 120 songs
```

---

## How to Find Your Database Credentials

### Find RDS Endpoint:
```powershell
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[*].[DBInstanceIdentifier,Endpoint.Address]' --output table
```

### Find Database Name:
```powershell
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[*].DBName' --output text
```

### Password:
- Check your password manager or secrets file
- Or reset it in RDS Console: AWS Console → RDS → Databases → Modify → New Password

---

## Verification

After setup completes, verify songs loaded:

```powershell
# Quick check (if you have psql)
psql -h $env:DB_HOST -U $env:DB_USER -d $env:DB_NAME -c "SELECT COUNT(*) FROM songs_master;"

# Should show: 120+ rows
```

Or check via Python:
```powershell
python -c "import asyncio, asyncpg, os; print(asyncio.run(asyncpg.connect(host=os.getenv('DB_HOST'), database=os.getenv('DB_NAME'), user=os.getenv('DB_USER'), password=os.getenv('DB_PASSWORD')).fetchval('SELECT COUNT(*) FROM songs_master')))"
```

---

## Troubleshooting

### ❌ "Connection timeout"
**Problem:** Can't reach RDS database
**Fix:** 
1. Check security group allows port 5432
2. Find security group: `aws rds describe-db-instances --query 'DBInstances[*].VpcSecurityGroups'`
3. Add your IP to inbound rules

### ❌ "Invalid password"
**Problem:** Wrong password
**Fix:** 
1. Reset password in RDS console
2. Or check your infrastructure code for the password

### ❌ "Database does not exist"
**Problem:** Wrong database name
**Fix:**
1. Find correct name: `aws rds describe-db-instances --query 'DBInstances[*].DBName'`
2. Common names: `buzzer_game_db`, `soundclash`, `postgres`

### ❌ "CSV file not found"
**Problem:** Script can't find songs_converted.csv
**Fix:**
```powershell
# Verify file exists
Test-Path C:\Users\galbenar\Sound-Clash\data\sample\songs_converted.csv

# If not, check your project structure
ls C:\Users\galbenar\Sound-Clash\data\sample\
```

---

## What Gets Created

### Tables:
- `songs_master` - 120+ songs (title, artist, youtube_id, duration)
- `genres` - 11 genres (rock, pop, hip-hop, mizrahit, etc.)
- `song_genres` - Links between songs and genres

### Sample Data:
- **Rock**: Bohemian Rhapsody, Sweet Child O' Mine, Hotel California
- **Pop**: Billie Jean, Shape of You, Blinding Lights  
- **Hip-Hop**: Lose Yourself, In Da Club, HUMBLE.
- **Israeli**: משהו קטן וטוב, כביש החוף, היא רק רוצה לרקוד
- **Soundtracks**: My Heart Will Go On, Let It Go, Circle of Life
- And 100+ more!

---

## Success Checklist

Phase 1 is complete when you can check all these:

- [ ] Environment variables set correctly
- [ ] Database connection successful
- [ ] Tables created (songs_master, genres, song_genres)
- [ ] 120+ songs loaded
- [ ] 11 genres created
- [ ] No errors in scripts

---

## Next: Phase 2 - Song Selection API

After Phase 1 completes, you'll create API endpoints:
- `GET /api/songs` - List all songs
- `GET /api/songs/{id}` - Get specific song
- `POST /api/songs/select` - Random song selection by genre
- `GET /api/songs/genres` - List all genres

**Estimated Phase 1 Time:** 10-15 minutes

---

## Quick Commands Cheat Sheet

```powershell
# Full automated setup
cd C:\Users\galbenar\Sound-Clash\backend\song-management
$env:DB_HOST="your-endpoint"; $env:DB_NAME="buzzer_game_db"; $env:DB_USER="postgres"; $env:DB_PASSWORD="password"
.\scripts\setup_phase1.ps1

# Manual steps
python scripts\check_schema.py    # Check/create tables
python scripts\load_songs.py      # Load songs

# Verify
python -c "import asyncio, asyncpg, os; print('Songs:', asyncio.run(asyncpg.connect(host=os.getenv('DB_HOST'), database=os.getenv('DB_NAME'), user=os.getenv('DB_USER'), password=os.getenv('DB_PASSWORD')).fetchval('SELECT COUNT(*) FROM songs_master')))"
```

Ready to start? Run the commands above! 🚀
