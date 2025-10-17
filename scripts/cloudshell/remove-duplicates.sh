#!/bin/bash
# Remove duplicate songs from the database
# Run this script in AWS CloudShell

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Remove Duplicate Songs Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get database credentials from Secrets Manager
echo "📦 Fetching database credentials from Secrets Manager..."
DB_SECRET=$(aws secretsmanager get-secret-value --secret-id SoundClashDatabaseStack-PostgresCredentials --region us-east-1 --query SecretString --output text)

DB_HOST=$(echo $DB_SECRET | jq -r '.host')
DB_PORT=$(echo $DB_SECRET | jq -r '.port')
DB_NAME=$(echo $DB_SECRET | jq -r '.dbname')
DB_USER=$(echo $DB_SECRET | jq -r '.username')
DB_PASSWORD=$(echo $DB_SECRET | jq -r '.password')

echo "✓ Connected to: $DB_HOST:$DB_PORT/$DB_NAME"
echo ""

# Install PostgreSQL client if not available
if ! command -v psql &> /dev/null; then
    echo "📦 Installing PostgreSQL client..."
    sudo yum install -y postgresql15
fi

# Set connection string
export PGPASSWORD="$DB_PASSWORD"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Finding duplicate songs..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Find duplicates
DUPLICATE_COUNT=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
SELECT COUNT(*) FROM (
    SELECT title, artist, youtube_id, COUNT(*) as cnt
    FROM songs_master
    GROUP BY title, artist, youtube_id
    HAVING COUNT(*) > 1
) duplicates;
")

DUPLICATE_COUNT=$(echo $DUPLICATE_COUNT | tr -d ' ')

if [ "$DUPLICATE_COUNT" -eq "0" ]; then
    echo "✓ No duplicate songs found! Database is clean."
    exit 0
fi

echo "Found $DUPLICATE_COUNT songs with duplicates"
echo ""

# Show duplicate details
echo "Duplicate songs:"
echo "────────────────────────────────────────────────────────────────────────────────"
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
SELECT
    title,
    artist,
    COUNT(*) as duplicate_count
FROM songs_master
GROUP BY title, artist, youtube_id
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, title
LIMIT 20;
"
echo ""

# Count total duplicates to remove
TOTAL_TO_REMOVE=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
SELECT SUM(cnt - 1) FROM (
    SELECT COUNT(*) as cnt
    FROM songs_master
    GROUP BY title, artist, youtube_id
    HAVING COUNT(*) > 1
) duplicates;
")

TOTAL_TO_REMOVE=$(echo $TOTAL_TO_REMOVE | tr -d ' ')

echo "Total duplicate entries to remove: $TOTAL_TO_REMOVE"
echo ""

# Ask for confirmation
read -p "Do you want to proceed with removing duplicates? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Operation cancelled by user"
    exit 0
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Removing duplicate songs..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Remove duplicates (keep the oldest version - first created_at)
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME << 'EOSQL'
BEGIN;

-- Create temporary table with IDs to delete
CREATE TEMP TABLE duplicate_ids AS
WITH ranked_songs AS (
    SELECT
        id,
        title,
        artist,
        youtube_id,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY title, artist, youtube_id
            ORDER BY created_at ASC
        ) as rn
    FROM songs_master
)
SELECT id FROM ranked_songs WHERE rn > 1;

-- Show how many will be deleted
SELECT COUNT(*) as "Songs to be deleted" FROM duplicate_ids;

-- Delete from song_genres junction table first (foreign key constraint)
DELETE FROM song_genres WHERE song_id IN (SELECT id FROM duplicate_ids);

-- Delete duplicate songs
DELETE FROM songs_master WHERE id IN (SELECT id FROM duplicate_ids);

-- Get delete count
SELECT COUNT(*) as "Deleted songs" FROM duplicate_ids;

COMMIT;

-- Verify no duplicates remain
SELECT COUNT(*) as "Remaining duplicate groups" FROM (
    SELECT title, artist, youtube_id, COUNT(*) as cnt
    FROM songs_master
    GROUP BY title, artist, youtube_id
    HAVING COUNT(*) > 1
) remaining;

-- Show total active songs
SELECT COUNT(*) as "Total active songs" FROM songs_master WHERE is_active = true;
EOSQL

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ Deduplication complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Verify again
REMAINING_DUPLICATES=$(psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -t -c "
SELECT COUNT(*) FROM (
    SELECT title, artist, youtube_id, COUNT(*) as cnt
    FROM songs_master
    GROUP BY title, artist, youtube_id
    HAVING COUNT(*) > 1
) duplicates;
")

REMAINING_DUPLICATES=$(echo $REMAINING_DUPLICATES | tr -d ' ')

if [ "$REMAINING_DUPLICATES" -eq "0" ]; then
    echo "✓ SUCCESS: Database is now clean - no duplicates remain"
else
    echo "⚠ WARNING: Still found $REMAINING_DUPLICATES duplicate groups"
fi

echo ""
echo "Done!"
