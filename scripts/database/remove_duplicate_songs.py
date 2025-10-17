#!/usr/bin/env python3
"""
Remove duplicate songs from the database.
Keeps the oldest version of each song (first created_at) and deletes the rest.
Duplicates are identified by matching: title + artist + youtube_id
"""

import os
import sys

# Try importing required packages, install if missing
try:
    import psycopg2
    from dotenv import load_dotenv
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "python-dotenv"])
    import psycopg2
    from dotenv import load_dotenv

# Get project root (two levels up from this script)
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))

# Load environment variables from production.env
env_file = os.path.join(PROJECT_ROOT, '.env', 'production.env')
print(f"Loading environment from: {env_file}")
load_dotenv(env_file)

# Database connection details
DB_HOST = os.getenv('DB_HOST')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'soundclash')
DB_USER = os.getenv('DB_USER', 'postgres')
DB_PASSWORD = os.getenv('DB_PASSWORD')

print(f"Connecting to: {DB_HOST}:{DB_PORT}/{DB_NAME}")

try:
    # Connect to PostgreSQL
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

    print("\n✓ Connected to database successfully")

    # Step 1: Find all duplicate songs
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("STEP 1: Finding duplicate songs...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    find_duplicates_query = """
    SELECT
        title,
        artist,
        youtube_id,
        COUNT(*) as duplicate_count,
        ARRAY_AGG(id ORDER BY created_at ASC) as all_ids,
        MIN(created_at) as first_created
    FROM songs_master
    GROUP BY title, artist, youtube_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, title;
    """

    cursor.execute(find_duplicates_query)
    duplicates = cursor.fetchall()

    if not duplicates:
        print("\n✓ No duplicate songs found! Database is clean.")
        cursor.close()
        conn.close()
        sys.exit(0)

    print(f"\n✗ Found {len(duplicates)} songs with duplicates:")
    print(f"\n{'Title':<40} {'Artist':<30} {'Count'}")
    print("─" * 80)

    total_duplicates_to_remove = 0
    for title, artist, youtube_id, count, ids, first_created in duplicates:
        print(f"{title[:40]:<40} {artist[:30]:<30} {count}x")
        total_duplicates_to_remove += (count - 1)  # Keep one, remove the rest

    print("─" * 80)
    print(f"\nTotal songs with duplicates: {len(duplicates)}")
    print(f"Total duplicate entries to remove: {total_duplicates_to_remove}")

    # Step 2: Delete duplicates
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("STEP 2: Removing duplicate songs...")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    removed_count = 0
    for title, artist, youtube_id, count, ids, first_created in duplicates:
        # Keep the first ID (oldest), delete the rest
        ids_to_keep = [ids[0]]
        ids_to_delete = ids[1:]

        if ids_to_delete:
            # First, delete from song_genres junction table
            delete_genres_query = """
            DELETE FROM song_genres
            WHERE song_id = ANY(%s);
            """
            cursor.execute(delete_genres_query, (ids_to_delete,))

            # Then delete from songs_master
            delete_songs_query = """
            DELETE FROM songs_master
            WHERE id = ANY(%s);
            """
            cursor.execute(delete_songs_query, (ids_to_delete,))

            removed_count += len(ids_to_delete)
            print(f"✓ Removed {len(ids_to_delete)} duplicate(s) of: {title[:50]} - {artist[:30]}")

    # Commit the transaction
    conn.commit()

    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("STEP 3: Verification")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

    # Verify duplicates are gone
    cursor.execute(find_duplicates_query)
    remaining_duplicates = cursor.fetchall()

    if remaining_duplicates:
        print(f"\n✗ WARNING: Still found {len(remaining_duplicates)} duplicate groups!")
        conn.rollback()
    else:
        print(f"\n✓ SUCCESS: Removed {removed_count} duplicate songs")
        print("✓ Database is now clean - no duplicates remain")

        # Show total songs count
        cursor.execute("SELECT COUNT(*) FROM songs_master WHERE is_active = true;")
        total_songs = cursor.fetchone()[0]
        print(f"✓ Total active songs in database: {total_songs}")

    cursor.close()
    conn.close()

    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("✓ Deduplication complete!")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

except psycopg2.Error as e:
    print(f"\nERROR: {e}")
    if conn:
        conn.rollback()
    sys.exit(1)
except Exception as e:
    print(f"\nERROR: {e}")
    if conn:
        conn.rollback()
    sys.exit(1)
