"""
Game Management Service - Phase 2: Database Integration (Simplified for debugging)
Enhanced with PostgreSQL database connectivity but with better error handling
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import logging
import uvicorn
import random
import string

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import database modules with fallback
DATABASE_AVAILABLE = False
try:
    from database.config import init_database, test_connection, close_database
    from database.init import init_database_schema
    from database.service import GameService
    DATABASE_AVAILABLE = True
    logger.info("Database modules imported successfully")
except ImportError as e:
    logger.warning(f"Database modules not available: {e}")
    DATABASE_AVAILABLE = False

app = FastAPI(
    title="Sound Clash Game Management Service",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global database status
DATABASE_CONNECTED = False

@app.on_event("startup")
async def startup_event():
    """Initialize database on startup"""
    global DATABASE_CONNECTED
    
    logger.info("Starting Game Management Service...")
    
    if DATABASE_AVAILABLE:
        try:
            logger.info("Attempting database initialization...")
            db_initialized = await init_database()
            if db_initialized:
                await init_database_schema()
                DATABASE_CONNECTED = await test_connection()
                logger.info(f"Database connection: {'SUCCESS' if DATABASE_CONNECTED else 'FAILED'}")
            else:
                logger.warning("Database initialization failed")
                DATABASE_CONNECTED = False
        except Exception as e:
            logger.error(f"Database startup error: {e}")
            DATABASE_CONNECTED = False
    else:
        logger.info("Database modules not available - running without database")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down Game Management Service...")
    if DATABASE_AVAILABLE and DATABASE_CONNECTED:
        try:
            await close_database()
        except Exception as e:
            logger.error(f"Database shutdown error: {e}")

def generate_game_code() -> str:
    """Generate a random 6-character game code"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

async def safe_test_connection() -> bool:
    """Safely test database connection"""
    if not DATABASE_AVAILABLE:
        return False
    try:
        return await test_connection()
    except Exception as e:
        logger.error(f"Connection test error: {e}")
        return False

@app.get("/")
async def root():
    db_connected = await safe_test_connection()
    return {
        "service": "Sound Clash Game Management Service", 
        "version": "1.0.0",
        "status": "running",
        "database_available": DATABASE_AVAILABLE,
        "database_connected": db_connected
    }

@app.get("/health")
async def health():
    db_connected = await safe_test_connection()
    return {
        "status": "healthy",
        "service": "game-management",
        "version": "1.0.0",
        "database": "connected" if db_connected else "disconnected"
    }

@app.get("/api/games/health")
async def api_health():
    """Health endpoint accessible via ALB routing"""
    db_connected = await safe_test_connection()
    return {
        "status": "healthy",
        "service": "game-management",
        "version": "1.0.0",
        "endpoint": "/api/games/health",
        "database": "connected" if db_connected else "disconnected"
    }

@app.get("/api/games")
async def list_games():
    """List active games - with database integration"""
    try:
        db_connected = await safe_test_connection()
        
        if DATABASE_AVAILABLE and db_connected:
            games = await GameService.get_active_games()
            stats = await GameService.get_game_stats()
            
            return {
                "games": [
                    {
                        "game_code": game.game_code,
                        "status": game.status,
                        "teams": len(game.teams),
                        "max_teams": game.max_teams,
                        "created_at": game.created_at.isoformat() if game.created_at else None
                    }
                    for game in games
                ],
                "total": len(games),
                "stats": stats,
                "database_connected": True
            }
        else:
            return {
                "games": [],
                "total": 0,
                "message": "Database not connected - running in fallback mode",
                "database_connected": False
            }
    except Exception as e:
        logger.error(f"Error listing games: {e}")
        return {
            "games": [],
            "total": 0,
            "error": str(e),
            "database_connected": False
        }

@app.post("/api/games")
async def create_game():
    """Create a new game - with database integration"""
    try:
        game_code = generate_game_code()
        db_connected = await safe_test_connection()
        
        if DATABASE_AVAILABLE and db_connected:
            game = await GameService.create_game(game_code, max_teams=8)
            if game:
                return {
                    "game_code": game.game_code,
                    "status": game.status,
                    "max_teams": game.max_teams,
                    "created_at": game.created_at.isoformat() if game.created_at else None,
                    "database_stored": True
                }
            else:
                # Fallback to memory-only
                return {
                    "game_code": game_code,
                    "status": "waiting",
                    "max_teams": 8,
                    "database_stored": False,
                    "message": "Database storage failed - created in memory"
                }
        else:
            return {
                "game_code": game_code,
                "status": "waiting",
                "max_teams": 8,
                "database_stored": False,
                "message": "Database not connected - created in memory only"
            }
    except Exception as e:
        logger.error(f"Error creating game: {e}")
        # Always return something, even on error
        return {
            "game_code": generate_game_code(),
            "status": "error",
            "database_stored": False,
            "error": str(e)
        }

@app.get("/api/games/status")
async def games_status():
    """Get service and games status"""
    try:
        db_connected = await safe_test_connection()
        if DATABASE_AVAILABLE and db_connected:
            stats = await GameService.get_game_stats()
            return {
                "service_status": "healthy",
                "database_connected": True,
                **stats
            }
        else:
            return {
                "service_status": "healthy", 
                "database_connected": False,
                "active_games": 0,
                "total_games": 0
            }
    except Exception as e:
        logger.error(f"Error getting status: {e}")
        return {
            "service_status": "error",
            "database_connected": False,
            "error": str(e)
        }

@app.get("/api/games/{game_code}")
async def get_game(game_code: str):
    """Get specific game details - with database integration"""
    try:
        db_connected = await safe_test_connection()
        
        if DATABASE_AVAILABLE and db_connected:
            game = await GameService.get_game_by_code(game_code.upper())
            if game:
                return {
                    "game_code": game.game_code,
                    "status": game.status,
                    "teams": [
                        {
                            "name": team.team_name,
                            "score": team.score,
                            "joined_at": team.joined_at.isoformat() if team.joined_at else None
                        }
                        for team in game.teams if team.is_active
                    ],
                    "max_teams": game.max_teams,
                    "current_round": game.current_round,
                    "total_rounds": game.total_rounds,
                    "created_at": game.created_at.isoformat() if game.created_at else None,
                    "database_source": True
                }
            else:
                raise HTTPException(status_code=404, detail=f"Game {game_code} not found")
        else:
            return {
                "game_code": game_code.upper(),
                "status": "unknown",
                "teams": [],
                "database_source": False,
                "message": "Database not connected - cannot retrieve game details"
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting game {game_code}: {e}")
        return {
            "game_code": game_code.upper(),
            "status": "error",
            "teams": [],
            "database_source": False,
            "error": str(e)
        }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    logger.info(f"Starting Game Management service on port {port}")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )
