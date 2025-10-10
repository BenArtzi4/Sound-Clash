"""
Song Management Service - Fixed version with proper health checks and robust database connection
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
import os
import asyncio
import asyncpg
import traceback
import logging

# Import API routers and database module
from api import songs
from database import postgres

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Song Management Service",
    version="1.0.0",
    redirect_slashes=False  # Disable automatic trailing slash redirects
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(songs.router, prefix="/api/songs", tags=["songs"])

# Database config
DATABASE_CONFIG = {
    "host": os.getenv("POSTGRES_HOST", "localhost"),
    "port": int(os.getenv("POSTGRES_PORT", "5432")),
    "database": os.getenv("POSTGRES_DB", "soundclash"),
    "user": os.getenv("POSTGRES_USER", "postgres"),
    "password": os.getenv("POSTGRES_PASSWORD", ""),
}

# Global database connection pool
connection_pool = None
database_available = False
last_error = None

async def init_db():
    """Initialize database connection - non-blocking for startup"""
    global connection_pool, database_available, last_error
    try:
        logger.info(f"Attempting to connect to database at {DATABASE_CONFIG['host']}:{DATABASE_CONFIG['port']}")
        connection_pool = await asyncpg.create_pool(
            **DATABASE_CONFIG,
            min_size=1,
            max_size=3,
            command_timeout=30
        )
        
        # Test connection
        async with connection_pool.acquire() as conn:
            await conn.execute("SELECT 1")
            database_available = True
            last_error = None
            logger.info("Database connected successfully")
            
        # Set the pool in postgres module so API endpoints can use it
        postgres.set_connection_pool(connection_pool)
        logger.info("Database pool shared with postgres module")
            
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        database_available = False
        last_error = str(e)

async def init_db_background():
    """Initialize database connection in background"""
    await asyncio.sleep(1)  # Small delay to let app start
    await init_db()

@app.on_event("startup")
async def startup():
    # Start database connection in background to not block app startup
    asyncio.create_task(init_db_background())

@app.get("/api/songs/")
async def root():
    return {
        "service": "Song Management Service",
        "version": "1.0.0",
        "status": "running",
        "database_connected": database_available,
        "endpoints": {
            "health": "/health",
            "status": "/api/songs/status",
            "test-connection": "/api/songs/test-connection",
            "database-schema": "/api/songs/database-schema"
        }
    }

@app.get("/api/songs/health/")
async def health_with_slash():
    """Health endpoint with slash for backward compatibility"""
    return {
        "status": "healthy",
        "service": "song-management", 
        "version": "1.0.0",
        "database": "connected" if database_available else "disconnected"
    }

@app.get("/health")
async def health():
    """Primary health endpoint for Docker health check"""
    return {
        "status": "healthy",
        "service": "song-management", 
        "version": "1.0.0",
        "timestamp": asyncio.get_event_loop().time()
    }

# Note: /status endpoint moved to songs router to avoid route conflict with /{song_id}

@app.get("/api/songs/test-connection")
async def test_connection():
    """Test database connection with detailed error info"""
    try:
        logger.info("Testing database connection...")
        
        # Test connection with timeout
        conn = await asyncio.wait_for(
            asyncpg.connect(**DATABASE_CONFIG),
            timeout=10.0
        )
        
        result = await conn.fetchval("SELECT current_database()")
        await conn.close()
        
        return {
            "status": "success",
            "message": "Database connection successful",
            "database_name": result,
            "connection_config": {
                "host": DATABASE_CONFIG["host"],
                "port": DATABASE_CONFIG["port"],
                "database": DATABASE_CONFIG["database"],
                "user": DATABASE_CONFIG["user"]
            }
        }
        
    except asyncio.TimeoutError:
        return {
            "status": "timeout",
            "message": "Connection timed out after 10 seconds",
            "error_type": "TimeoutError",
            "likely_cause": "Network connectivity issue - check security groups"
        }
        
    except Exception as e:
        return {
            "status": "error", 
            "message": f"Connection failed: {str(e)}",
            "error_type": type(e).__name__,
            "traceback": traceback.format_exc(),
            "connection_config": {
                "host": DATABASE_CONFIG["host"],
                "port": DATABASE_CONFIG["port"],
                "database": DATABASE_CONFIG["database"],
                "user": DATABASE_CONFIG["user"]
            }
        }

@app.get("/api/songs/database-schema")
async def check_database_schema():
    """Check if database tables exist"""
    if not database_available:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        async with connection_pool.acquire() as conn:
            # Check tables exist
            tables_query = """
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """
            tables = await conn.fetch(tables_query)
            table_names = [row['table_name'] for row in tables]
            
            return {
                "status": "success",
                "tables_exist": table_names,
                "expected_tables": ["songs", "genres", "song_genres"],
                "missing_tables": [t for t in ["songs", "genres", "song_genres"] if t not in table_names],
                "schema_ready": all(t in table_names for t in ["songs", "genres", "song_genres"])
            }
            
    except Exception as e:
        return {
            "status": "error",
            "message": f"Schema check failed: {str(e)}",
            "error_type": type(e).__name__
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8001)),
        reload=False
    )
