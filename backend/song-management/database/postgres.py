"""
PostgreSQL database connection for Song Management Service
"""

import os
import asyncpg
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

# Database connection configuration
DATABASE_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", 5432)),
    "database": os.getenv("POSTGRES_DB", "soundclash"),
    "user": os.getenv("POSTGRES_USER", "postgres"),
    "password": os.getenv("POSTGRES_PASSWORD", ""),
}

class DatabaseConnection:
    def __init__(self):
        self.pool = None
    
    async def init_pool(self):
        """Initialize connection pool"""
        try:
            self.pool = await asyncpg.create_pool(
                **DATABASE_CONFIG,
                min_size=1,
                max_size=10,
                command_timeout=60
            )
            print(f"✅ Connected to PostgreSQL: {DATABASE_CONFIG['host']}:{DATABASE_CONFIG['port']}")
        except Exception as e:
            print(f"❌ Database connection failed: {e}")
            raise
    
    async def close_pool(self):
        """Close connection pool"""
        if self.pool:
            await self.pool.close()
            print("🔌 Database connection pool closed")
    
    @asynccontextmanager
    async def get_connection(self):
        """Get database connection from pool"""
        if not self.pool:
            await self.init_pool()
        
        async with self.pool.acquire() as connection:
            yield connection

# Global database instance
db = DatabaseConnection()

async def init_db():
    """Initialize database connection"""
    await db.init_pool()

async def get_db_connection():
    """Get database connection (dependency)"""
    async with db.get_connection() as conn:
        yield conn

class SongRepository:
    """Repository for song database operations"""
    
    def __init__(self, connection):
        self.conn = connection
    
    async def get_all_songs(self, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """Get all songs with pagination"""
        query = """
        SELECT s.*, 
               COALESCE(array_agg(g.slug) FILTER (WHERE g.slug IS NOT NULL), '{}') as genres
        FROM songs s
        LEFT JOIN song_genres sg ON s.id = sg.song_id
        LEFT JOIN genres g ON sg.genre_id = g.id AND g.is_active = true
        WHERE s.is_active = true
        GROUP BY s.id
        ORDER BY s.title
        LIMIT $1 OFFSET $2
        """
        rows = await self.conn.fetch(query, limit, offset)
        return [dict(row) for row in rows]
    
    async def get_song_by_id(self, song_id: int) -> Optional[Dict[str, Any]]:
        """Get song by ID with genres"""
        query = """
        SELECT s.*, 
               COALESCE(array_agg(g.slug) FILTER (WHERE g.slug IS NOT NULL), '{}') as genres
        FROM songs s
        LEFT JOIN song_genres sg ON s.id = sg.song_id
        LEFT JOIN genres g ON sg.genre_id = g.id AND g.is_active = true
        WHERE s.id = $1 AND s.is_active = true
        GROUP BY s.id
        """
        row = await self.conn.fetchrow(query, song_id)
        return dict(row) if row else None
    
    async def search_songs(
        self, 
        search_term: Optional[str] = None,
        genres: Optional[List[str]] = None,
        is_active: Optional[bool] = None,
        limit: int = 20,
        offset: int = 0
    ) -> tuple[List[Dict[str, Any]], int]:
        """Search songs with filters"""
        
        conditions = []
        params = []
        param_count = 0
        
        base_query = """
        SELECT s.*, 
               COALESCE(array_agg(g.slug) FILTER (WHERE g.slug IS NOT NULL), '{}') as genres
        FROM songs s
        LEFT JOIN song_genres sg ON s.id = sg.song_id
        LEFT JOIN genres g ON sg.genre_id = g.id AND g.is_active = true
        """
        
        if is_active is not None:
            param_count += 1
            conditions.append(f"s.is_active = ${param_count}")
            params.append(is_active)
        
        if search_term:
            param_count += 1
            conditions.append(f"(s.title ILIKE ${param_count} OR s.artist ILIKE ${param_count})")
            params.append(f"%{search_term}%")
        
        where_clause = ""
        having_clause = ""
        
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)
        
        if genres:
            # Filter by genres in HAVING clause after GROUP BY
            genre_placeholders = []
            for genre in genres:
                param_count += 1
                genre_placeholders.append(f"${param_count}")
                params.append(genre)
            having_clause = f"HAVING array_agg(g.slug) && ARRAY[{','.join(genre_placeholders)}]"
        
        # Count query
        count_query = f"""
        SELECT COUNT(*)
        FROM (
            {base_query}
            {where_clause}
            GROUP BY s.id
            {having_clause}
        ) as filtered_songs
        """
        
        # Main query
        main_query = f"""
        {base_query}
        {where_clause}
        GROUP BY s.id
        {having_clause}
        ORDER BY s.title
        LIMIT ${param_count + 1} OFFSET ${param_count + 2}
        """
        
        params.extend([limit, offset])
        
        # Execute queries
        total_count = await self.conn.fetchval(count_query, *params[:-2])
        rows = await self.conn.fetch(main_query, *params)
        
        return [dict(row) for row in rows], total_count
    
    async def create_song(self, song_data: Dict[str, Any]) -> int:
        """Create new song"""
        async with self.conn.transaction():
            # Insert song
            song_query = """
            INSERT INTO songs (title, artist, youtube_id, youtube_url)
            VALUES ($1, $2, $3, $4)
            RETURNING id
            """
            youtube_url = f"https://www.youtube.com/watch?v={song_data['youtube_id']}" if song_data.get('youtube_id') else None
            
            song_id = await self.conn.fetchval(
                song_query,
                song_data['title'],
                song_data['artist'],
                song_data.get('youtube_id'),
                youtube_url
            )
            
            # Add genres
            if song_data.get('genres'):
                await self._update_song_genres(song_id, song_data['genres'])
            
            return song_id
    
    async def update_song(self, song_id: int, song_data: Dict[str, Any]) -> bool:
        """Update existing song"""
        async with self.conn.transaction():
            # Update song fields
            update_fields = []
            params = []
            param_count = 0
            
            for field in ['title', 'artist', 'youtube_id', 'is_active']:
                if field in song_data:
                    param_count += 1
                    update_fields.append(f"{field} = ${param_count}")
                    params.append(song_data[field])
            
            if 'youtube_id' in song_data and song_data['youtube_id']:
                param_count += 1
                update_fields.append(f"youtube_url = ${param_count}")
                params.append(f"https://www.youtube.com/watch?v={song_data['youtube_id']}")
            
            if update_fields:
                param_count += 1
                update_fields.append(f"updated_at = ${param_count}")
                params.append("CURRENT_TIMESTAMP")
                
                param_count += 1
                params.append(song_id)
                
                query = f"""
                UPDATE songs 
                SET {', '.join(update_fields)}
                WHERE id = ${param_count}
                """
                await self.conn.execute(query, *params)
            
            # Update genres if provided
            if 'genres' in song_data:
                await self._update_song_genres(song_id, song_data['genres'])
            
            return True
    
    async def delete_song(self, song_id: int) -> bool:
        """Soft delete song"""
        query = "UPDATE songs SET is_active = false WHERE id = $1"
        result = await self.conn.execute(query, song_id)
        return result == "UPDATE 1"
    
    async def get_songs_by_genres(self, genre_slugs: List[str], limit: int = 10, exclude_ids: List[int] = None) -> List[Dict[str, Any]]:
        """Get songs by genre slugs"""
        exclude_clause = ""
        params = [genre_slugs, limit]
        
        if exclude_ids:
            exclude_clause = "AND s.id != ALL($3)"
            params.append(exclude_ids)
        
        query = f"""
        SELECT s.*, 
               COALESCE(array_agg(g.slug) FILTER (WHERE g.slug IS NOT NULL), '{{}}') as genres
        FROM songs s
        JOIN song_genres sg ON s.id = sg.song_id
        JOIN genres g ON sg.genre_id = g.id
        WHERE g.slug = ANY($1) AND s.is_active = true AND g.is_active = true
        {exclude_clause}
        GROUP BY s.id
        ORDER BY RANDOM()
        LIMIT $2
        """
        
        rows = await self.conn.fetch(query, *params)
        return [dict(row) for row in rows]
    
    async def _update_song_genres(self, song_id: int, genre_slugs: List[str]):
        """Update song genres"""
        # Remove existing genres
        await self.conn.execute("DELETE FROM song_genres WHERE song_id = $1", song_id)
        
        # Add new genres
        if genre_slugs:
            # Get genre IDs
            genre_query = "SELECT id FROM genres WHERE slug = ANY($1) AND is_active = true"
            genre_ids = await self.conn.fetch(genre_query, genre_slugs)
            
            # Insert new associations
            for genre_row in genre_ids:
                await self.conn.execute(
                    "INSERT INTO song_genres (song_id, genre_id) VALUES ($1, $2)",
                    song_id, genre_row['id']
                )

class GenreRepository:
    """Repository for genre database operations"""
    
    def __init__(self, connection):
        self.conn = connection
    
    async def get_all_genres(self) -> List[Dict[str, Any]]:
        """Get all active genres with song counts"""
        query = """
        SELECT g.*,
               COUNT(sg.song_id) FILTER (WHERE s.is_active = true) as song_count
        FROM genres g
        LEFT JOIN song_genres sg ON g.id = sg.genre_id
        LEFT JOIN songs s ON sg.song_id = s.id
        WHERE g.is_active = true
        GROUP BY g.id
        ORDER BY g.category, g.sort_order, g.name
        """
        rows = await self.conn.fetch(query)
        return [dict(row) for row in rows]
    
    async def get_genres_by_category(self) -> Dict[str, List[Dict[str, Any]]]:
        """Get genres organized by category"""
        genres = await self.get_all_genres()
        
        categories = {}
        for genre in genres:
            category = genre['category']
            if category not in categories:
                categories[category] = []
            categories[category].append(genre)
        
        return categories