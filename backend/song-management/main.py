"""
Song Management Service - With database connection test
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import asyncio
import asyncpg
import traceback

app = FastAPI(
    title="Song Management Service",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    """Initialize database connection"""
    global connection_pool, database_available, last_error
    try:
        print(f"Attempting to connect to database at {DATABASE_CONFIG['host']}:{DATABASE_CONFIG['port']}")
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
            print("✅ Database connected successfully")
            
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        database_available = False
        last_error = str(e)

@app.on_event("startup")
async def startup():
    await init_db()

@app.get("/api/songs/")
async def root():
    return {
        "service": "Song Management Service",
        "version": "1.0.0",
        "status": "running",
        "database_connected": database_available,
        "endpoints": {
            "health": "/api/songs/health/",
            "status": "/api/songs/status",
            "test-connection": "/api/songs/test-connection",
            "songs": "/api/songs/songs/" if database_available else None
        }
    }

@app.get("/api/songs/health/")
async def health():
    return {
        "status": "healthy",
        "service": "song-management", 
        "version": "1.0.0",
        "database": "connected" if database_available else "disconnected"
    }

@app.get("/api/songs/status")
async def status():
    return {
        "service": "operational",
        "version": "1.0.0",
        "database": "connected" if database_available else "unavailable",
        "features": {
            "basic_endpoints": True,
            "song_operations": database_available
        },
        "config": {
            "database_host": DATABASE_CONFIG["host"],
            "database_name": DATABASE_CONFIG["database"]
        },
        "last_error": last_error,
        "message": "All systems operational" if database_available else "Database connection failed"
    }

@app.get("/api/songs/test-connection")
async def test_connection():
    """Test database connection with detailed error info"""
    try:
        print("Testing database connection...")
        
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

@app.get("/health/")
async def health_check():
    return {"status": "healthy", "service": "song-management"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8001)),
        reload=False
    )
