"""
Health check endpoints for Song Management Service
"""

from fastapi import APIRouter, HTTPException, Depends
from datetime import datetime
from database.postgres import get_db_connection

router = APIRouter()

@router.get("/")
async def health_check():
    """Basic health check"""
    return {
        "status": "healthy",
        "service": "song-management",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

@router.get("/detailed")
async def detailed_health_check(conn=Depends(get_db_connection)):
    """Detailed health check with database connectivity"""
    try:
        # Test database connection
        async for connection in conn:
            result = await connection.fetchval("SELECT 1")
            
            # Get basic stats
            song_count = await connection.fetchval("SELECT COUNT(*) FROM songs WHERE is_active = true")
            genre_count = await connection.fetchval("SELECT COUNT(*) FROM genres WHERE is_active = true")
            
            return {
                "status": "healthy",
                "service": "song-management",
                "timestamp": datetime.utcnow().isoformat(),
                "version": "1.0.0",
                "database": {
                    "status": "connected",
                    "test_query": result == 1,
                    "active_songs": song_count,
                    "active_genres": genre_count
                },
                "features": {
                    "song_crud": True,
                    "song_search": True,
                    "genre_management": True,
                    "bulk_operations": True
                }
            }
    except Exception as e:
        return {
            "status": "unhealthy",
            "service": "song-management", 
            "timestamp": datetime.utcnow().isoformat(),
            "version": "1.0.0",
            "database": {
                "status": "disconnected",
                "error": str(e)
            }
        }