"""
Database configuration and connection management
"""
import os
import asyncio
import asyncpg
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional, Dict, Any, List
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Database configuration
DATABASE_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "port": int(os.getenv("DB_PORT", "5432")),
    "database": os.getenv("DB_NAME", "buzzer_game_db"),
    "user": os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "password"),
    "min_size": 1,
    "max_size": 5,
    "command_timeout": 30,
}

# Global connection pool
connection_pool: Optional[asyncpg.Pool] = None

async def init_db():
    """Initialize database connection pool"""
    global connection_pool
    try:
        connection_pool = await asyncpg.create_pool(**DATABASE_CONFIG)
        logger.info("Database connection pool created successfully")
        
        # Test connection
        async with connection_pool.acquire() as conn:
            await conn.execute("SELECT 1")
            logger.info("Database connection test successful")
            
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise

async def close_db():
    """Close database connection pool"""
    global connection_pool
    if connection_pool:
        await connection_pool.close()
        logger.info("Database connection pool closed")

@asynccontextmanager
async def get_db_connection() -> AsyncGenerator[asyncpg.Connection, None]:
    """Get database connection from pool"""
    if not connection_pool:
        raise RuntimeError("Database pool not initialized")
    
    async with connection_pool.acquire() as connection:
        yield connection

class SongRepository:
    """Repository for song operations"""
    
    def __init__(self, connection: asyncpg.Connection):
        self.conn = connection
    
    async def get_all_songs(self, limit: int = 20, offset: int = 0) -> List[Dict[str, Any]]:
        """Get all songs with pagination"""
        query = """
            SELECT id, title, artist, album, youtube_id, spotify_id, duration_seconds,
                   release_year, is_active, created_at, updated_at
            FROM songs_master 
            WHERE is_active = true
            ORDER BY title
            LIMIT $1 OFFSET $2
        """
        rows = await self.conn.fetch(query, limit, offset)
        return [dict(row) for row in rows]
    
    async def get_song_by_id(self, song_id: int) -> Optional[Dict[str, Any]]:
        """Get song by ID"""
        query = """
            SELECT id, title, artist, album, youtube_id, spotify_id, duration_seconds,
                   release_year, is_active, created_at, updated_at
            FROM songs_master 
            WHERE id = $1 AND is_active = true
        """
        row = await self.conn.fetchrow(query, song_id)
        return dict(row) if row else None
    
    async def search_songs(self, search_term: Optional[str] = None, 
                          genres: Optional[List[str]] = None,
                          is_active: bool = True,
                          limit: int = 20, offset: int = 0) -> tuple[List[Dict[str, Any]], int]:
        """Search songs with filters"""
        conditions = ["is_active = $1"]
        params = [is_active]
        param_count = 1
        
        if search_term:
            param_count += 1
            conditions.append(f"(title ILIKE ${param_count} OR artist ILIKE ${param_count})")
            params.append(f"%{search_term}%")
        
        if genres:
            param_count += 1
            conditions.append(f"EXISTS (SELECT 1 FROM song_genres sg JOIN genres g ON sg.genre_id = g.id WHERE sg.song_id = songs_master.id AND g.slug = ANY(${param_count}))")
            params.append(genres)
        
        where_clause = " AND ".join(conditions)
        
        # Get total count
        count_query = f"SELECT COUNT(*) FROM songs_master WHERE {where_clause}"
        total_count = await self.conn.fetchval(count_query, *params)
        
        # Get songs
        songs_query = f"""
            SELECT id, title, artist, album, youtube_id, spotify_id, duration_seconds,
                   release_year, is_active, created_at, updated_at
            FROM songs_master 
            WHERE {where_clause}
            ORDER BY title
            LIMIT ${param_count + 1} OFFSET ${param_count + 2}
        """
        params.extend([limit, offset])
        
        rows = await self.conn.fetch(songs_query, *params)
        songs = [dict(row) for row in rows]
        
        return songs, total_count
    
    async def create_song(self, song_data: Dict[str, Any]) -> int:
        """Create new song"""
        query = """
            INSERT INTO songs_master (title, artist, album, youtube_id, spotify_id, 
                                    duration_seconds, release_year, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        """
        return await self.conn.fetchval(
            query,
            song_data.get("title"),
            song_data.get("artist"),
            song_data.get("album"),
            song_data.get("youtube_id"),
            song_data.get("spotify_id"),
            song_data.get("duration_seconds"),
            song_data.get("release_year"),
            song_data.get("is_active", True)
        )
    
    async def update_song(self, song_id: int, song_data: Dict[str, Any]) -> bool:
        """Update existing song"""
        # Build dynamic update query
        fields = []
        params = []
        param_count = 0
        
        for field, value in song_data.items():
            if field in ["title", "artist", "album", "youtube_id", "spotify_id", 
                        "duration_seconds", "release_year", "is_active"]:
                param_count += 1
                fields.append(f"{field} = ${param_count}")
                params.append(value)
        
        if not fields:
            return False
            
        param_count += 1
        params.append(song_id)
        
        query = f"""
            UPDATE songs_master 
            SET {', '.join(fields)}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ${param_count}
        """
        
        result = await self.conn.execute(query, *params)
        return result == "UPDATE 1"
    
    async def delete_song(self, song_id: int) -> bool:
        """Soft delete song"""
        query = "UPDATE songs_master SET is_active = false WHERE id = $1"
        result = await self.conn.execute(query, song_id)
        return result == "UPDATE 1"
    
    async def get_songs_by_genres(self, genre_slugs: List[str], 
                                 limit: int = 50, 
                                 exclude_ids: List[int] = None) -> List[Dict[str, Any]]:
        """Get songs by genre slugs"""
        conditions = ["s.is_active = true"]
        params = [genre_slugs]
        param_count = 1
        
        if exclude_ids:
            param_count += 1
            conditions.append(f"s.id != ALL(${param_count})")
            params.append(exclude_ids)
        
        where_clause = " AND ".join(conditions)
        
        query = f"""
            SELECT DISTINCT s.id, s.title, s.artist, s.album, s.youtube_id, 
                   s.spotify_id, s.duration_seconds, s.release_year, s.is_active,
                   s.created_at, s.updated_at
            FROM songs_master s
            JOIN song_genres sg ON s.id = sg.song_id
            JOIN genres g ON sg.genre_id = g.id
            WHERE g.slug = ANY($1) AND {where_clause}
            ORDER BY RANDOM()
            LIMIT ${param_count + 1}
        """
        params.append(limit)
        
        rows = await self.conn.fetch(query, *params)
        return [dict(row) for row in rows]

class GenreRepository:
    """Repository for genre operations"""
    
    def __init__(self, connection: asyncpg.Connection):
        self.conn = connection
    
    async def get_all_genres(self) -> List[Dict[str, Any]]:
        """Get all genres"""
        query = """
            SELECT id, name, slug, description, category, parent_id, is_active,
                   (SELECT COUNT(*) FROM song_genres sg 
                    JOIN songs_master s ON sg.song_id = s.id 
                    WHERE sg.genre_id = genres.id AND s.is_active = true) as song_count
            FROM genres 
            WHERE is_active = true
            ORDER BY category, name
        """
        rows = await self.conn.fetch(query)
        return [dict(row) for row in rows]
    
    async def get_genres_by_category(self) -> Dict[str, List[Dict[str, Any]]]:
        """Get genres grouped by category"""
        genres = await self.get_all_genres()
        categories = {}
        
        for genre in genres:
            category = genre.get("category", "Other")
            if category not in categories:
                categories[category] = []
            categories[category].append(genre)
        
        return categories
