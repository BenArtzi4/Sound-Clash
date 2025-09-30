"""
Check Database Schema - Verify that all required tables exist
Run this first to ensure database is ready for song loading
"""
import asyncio
import asyncpg
import os
import sys
from typing import Dict, List

# Database configuration from environment variables
DATABASE_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", os.getenv("DB_HOST", "localhost")),
    "port": int(os.getenv("POSTGRES_PORT", os.getenv("DB_PORT", "5432"))),
    "database": os.getenv("POSTGRES_DB", os.getenv("DB_NAME", "soundclash")),
    "user": os.getenv("POSTGRES_USER", os.getenv("DB_USER", "postgres")),
    "password": os.getenv("POSTGRES_PASSWORD", os.getenv("DB_PASSWORD", "")),
}

async def check_table_exists(conn: asyncpg.Connection, table_name: str) -> bool:
    """Check if a table exists"""
    query = """
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
        )
    """
    return await conn.fetchval(query, table_name)

async def get_table_structure(conn: asyncpg.Connection, table_name: str) -> List[Dict]:
    """Get table column information"""
    query = """
        SELECT 
            column_name, 
            data_type, 
            is_nullable,
            column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' 
        AND table_name = $1
        ORDER BY ordinal_position
    """
    rows = await conn.fetch(query, table_name)
    return [dict(row) for row in rows]

async def get_table_row_count(conn: asyncpg.Connection, table_name: str) -> int:
    """Get number of rows in table"""
    query = f"SELECT COUNT(*) FROM {table_name}"
    try:
        return await conn.fetchval(query)
    except:
        return 0

async def create_missing_tables(conn: asyncpg.Connection):
    """Create tables if they don't exist"""
    print("\n[*] Creating missing tables...")
    
    # Create songs_master table
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
    print("  [OK] songs_master table ready")
    
    # Create genres table
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
    print("  [OK] genres table ready")
    
    # Create song_genres junction table
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS song_genres (
            song_id INTEGER REFERENCES songs_master(id) ON DELETE CASCADE,
            genre_id INTEGER REFERENCES genres(id) ON DELETE CASCADE,
            PRIMARY KEY (song_id, genre_id)
        )
    """)
    print("  [OK] song_genres junction table ready")
    
    # Create indexes for better performance
    await conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_songs_title ON songs_master(title);
        CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs_master(artist);
        CREATE INDEX IF NOT EXISTS idx_songs_youtube_id ON songs_master(youtube_id);
        CREATE INDEX IF NOT EXISTS idx_songs_active ON songs_master(is_active);
        CREATE INDEX IF NOT EXISTS idx_genres_slug ON genres(slug);
        CREATE INDEX IF NOT EXISTS idx_genres_category ON genres(category);
    """)
    print("  [OK] Indexes created")

async def check_schema():
    """Main function to check database schema"""
    print("=" * 60)
    print("DATABASE SCHEMA VERIFICATION")
    print("=" * 60)
    
    # Display connection info
    print(f"\n[*] Connecting to database:")
    print(f"   Host: {DATABASE_CONFIG['host']}")
    print(f"   Port: {DATABASE_CONFIG['port']}")
    print(f"   Database: {DATABASE_CONFIG['database']}")
    print(f"   User: {DATABASE_CONFIG['user']}")
    
    try:
        # Connect to database with timeout
        conn = await asyncpg.connect(**DATABASE_CONFIG, timeout=10)
        print("   [OK] Connection successful!\n")
        
        # Required tables
        required_tables = ['songs_master', 'genres', 'song_genres']
        
        all_exist = True
        table_status = {}
        
        # Check each table
        for table in required_tables:
            exists = await check_table_exists(conn, table)
            table_status[table] = exists
            
            if exists:
                row_count = await get_table_row_count(conn, table)
                structure = await get_table_structure(conn, table)
                
                print(f"[OK] Table '{table}' exists")
                print(f"   Rows: {row_count}")
                print(f"   Columns: {len(structure)}")
                
                # Show first few columns
                if structure:
                    print(f"   Structure:")
                    for col in structure[:5]:  # Show first 5 columns
                        nullable = "NULL" if col['is_nullable'] == 'YES' else "NOT NULL"
                        print(f"     - {col['column_name']}: {col['data_type']} {nullable}")
                    if len(structure) > 5:
                        print(f"     ... and {len(structure) - 5} more columns")
                print()
            else:
                print(f"[FAIL] Table '{table}' DOES NOT exist\n")
                all_exist = False
        
        # Create missing tables if needed
        if not all_exist:
            print("[!] Some tables are missing!")
            await create_missing_tables(conn)
            print("\n[OK] All tables created successfully!")
        else:
            print("[OK] All required tables exist!")
        
        # Summary
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        
        songs_count = await get_table_row_count(conn, 'songs_master')
        genres_count = await get_table_row_count(conn, 'genres')
        
        print(f"Songs in database: {songs_count}")
        print(f"Genres in database: {genres_count}")
        
        if songs_count == 0:
            print("\n[*] Next step: Run load_songs.py to import songs from CSV")
        else:
            print(f"\n[OK] Database ready with {songs_count} songs!")
        
        await conn.close()
        return 0
        
    except asyncpg.InvalidPasswordError:
        print("[FAIL] ERROR: Invalid database password")
        print("   Check your POSTGRES_PASSWORD environment variable")
        return 1
    except asyncpg.InvalidCatalogNameError:
        print(f"[FAIL] ERROR: Database '{DATABASE_CONFIG['database']}' does not exist")
        print("   Create the database first or check POSTGRES_DB environment variable")
        return 1
    except asyncio.TimeoutError:
        print("[FAIL] ERROR: Connection timeout")
        print("   Database took too long to respond")
        print("\nTroubleshooting:")
        print("  1. Check if RDS instance is running: aws rds describe-db-instances")
        print("  2. Verify security group allows your IP on port 5432")
        print("  3. Ensure RDS is publicly accessible")
        print("  4. Try again in a few minutes if RDS just started")
        return 1
    except Exception as e:
        print(f"[FAIL] ERROR: {type(e).__name__}: {e}")
        print("\nTroubleshooting:")
        print("  1. Check database connection settings")
        print("  2. Ensure PostgreSQL is running")
        print("  3. Verify network access to database")
        return 1

if __name__ == "__main__":
    print("\n[*] Starting database schema verification...\n")
    exit_code = asyncio.run(check_schema())
    sys.exit(exit_code)
