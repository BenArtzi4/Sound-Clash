"""
Game Management Service - Phase 3: Full Game Logic Integration
Enhanced with complete game management, DynamoDB state, and shared models
"""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
import os
import logging
import uvicorn
import random
import string
from datetime import datetime
from typing import List, Dict, Any, Optional

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

# Try to import shared models and DynamoDB
SHARED_MODELS_AVAILABLE = False
DYNAMODB_AVAILABLE = False
try:
    # Import models directly (shared directory now available in Docker)
    from shared.models.game_models import (
        GameStatus, TeamStatus, GameSettings, TeamMember, 
        GameRound, ActiveGame, FixedScoring
    )
    SHARED_MODELS_AVAILABLE = True
    logger.info("Shared models imported successfully")
    
    # Note: DynamoDB temporarily disabled due to dependency conflicts
    logger.info("DynamoDB temporarily disabled - using PostgreSQL-only mode")
    DYNAMODB_AVAILABLE = False
        
except ImportError as e:
    logger.warning(f"Shared models not available: {e}")
    SHARED_MODELS_AVAILABLE = False
    DYNAMODB_AVAILABLE = False
except Exception as e:
    logger.warning(f"Error importing shared components: {e}")
    SHARED_MODELS_AVAILABLE = False
    DYNAMODB_AVAILABLE = False

# Try to import WebSocket integration
WEBSOCKET_AVAILABLE = False
try:
    from websocket_integration import websocket_integration
    WEBSOCKET_AVAILABLE = True
    logger.info("WebSocket integration available")
except ImportError as e:
    logger.warning(f"WebSocket integration not available: {e}")
    WEBSOCKET_AVAILABLE = False

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

# Global status variables
DATABASE_CONNECTED = False
DYNAMODB_CONNECTED = False
SERVICE_MODE = "basic"  # basic, database, full

@app.on_event("startup")
async def startup_event():
    """Initialize all services on startup"""
    global DATABASE_CONNECTED, DYNAMODB_CONNECTED, SERVICE_MODE
    
    logger.info("Starting Game Management Service with WebSocket integration...")
    
    # Initialize PostgreSQL database
    if DATABASE_AVAILABLE:
        try:
            logger.info("Attempting database initialization...")
            db_initialized = await init_database()
            if db_initialized:
                await init_database_schema()
                DATABASE_CONNECTED = await test_connection()
                logger.info(f"PostgreSQL connection: {'SUCCESS' if DATABASE_CONNECTED else 'FAILED'}")
            else:
                logger.warning("PostgreSQL initialization failed")
                DATABASE_CONNECTED = False
        except Exception as e:
            logger.error(f"PostgreSQL startup error: {e}")
            DATABASE_CONNECTED = False
    else:
        logger.info("PostgreSQL modules not available")
    
    # Initialize WebSocket integration
    if WEBSOCKET_AVAILABLE:
        try:
            await websocket_integration.initialize()
            websocket_healthy = await websocket_integration.check_websocket_health()
            logger.info(f"WebSocket integration: {'SUCCESS' if websocket_healthy else 'FAILED'}")
        except Exception as e:
            logger.error(f"WebSocket integration error: {e}")
    
    # DynamoDB temporarily disabled
    DYNAMODB_CONNECTED = False
    logger.info("DynamoDB temporarily disabled - using PostgreSQL-only mode")
    
    # Determine service mode
    if DATABASE_CONNECTED and DYNAMODB_CONNECTED:
        SERVICE_MODE = "full"
    elif DATABASE_CONNECTED:
        SERVICE_MODE = "database"
    else:
        SERVICE_MODE = "basic"
    
    logger.info(f"Service started in {SERVICE_MODE.upper()} mode")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down Game Management Service...")
    
    # Close WebSocket integration
    if WEBSOCKET_AVAILABLE:
        try:
            await websocket_integration.close()
        except Exception as e:
            logger.error(f"WebSocket integration shutdown error: {e}")
    
    # Close database
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
        "mode": SERVICE_MODE,
        "database_available": DATABASE_AVAILABLE,
        "database_connected": db_connected,
        "dynamodb_available": DYNAMODB_AVAILABLE,
        "dynamodb_connected": DYNAMODB_CONNECTED
    }

@app.get("/health")
async def health():
    db_connected = await safe_test_connection()
    return {
        "status": "healthy",
        "service": "game-management",
        "version": "1.0.0",
        "mode": SERVICE_MODE,
        "database": "connected" if db_connected else "disconnected",
        "dynamodb": "connected" if DYNAMODB_CONNECTED else "disconnected"
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
        "mode": SERVICE_MODE,
        "database": "connected" if db_connected else "disconnected",
        "dynamodb": "connected" if DYNAMODB_CONNECTED else "disconnected"
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

@app.get("/api/games/{game_code}/teams")
async def get_game_teams(game_code: str):
    """Get current teams in a game - integrates with WebSocket service"""
    try:
        # Get teams from WebSocket service if available
        websocket_teams = {}
        if WEBSOCKET_AVAILABLE:
            try:
                websocket_teams = await websocket_integration.get_game_teams(game_code.upper())
                logger.info(f"Retrieved teams from WebSocket service for game {game_code}")
            except Exception as e:
                logger.warning(f"Failed to get teams from WebSocket service: {e}")
        
        # Also get teams from database if available
        db_teams = []
        if DATABASE_CONNECTED:
            try:
                game = await GameService.get_game_by_code(game_code.upper())
                if game:
                    db_teams = [
                        {
                            "team_name": team.team_name,
                            "score": team.score,
                            "joined_at": team.joined_at.isoformat() if team.joined_at else None
                        }
                        for team in game.teams if team.is_active
                    ]
            except Exception as e:
                logger.warning(f"Failed to get teams from database: {e}")
        
        return {
            "game_code": game_code.upper(),
            "teams": {
                "websocket": websocket_teams.get("teams", []),
                "database": db_teams
            },
            "total_teams": len(websocket_teams.get("teams", [])),
            "websocket_available": WEBSOCKET_AVAILABLE,
            "database_available": DATABASE_CONNECTED
        }
        
    except Exception as e:
        logger.error(f"Error getting teams for game {game_code}: {e}")
        return {
            "game_code": game_code.upper(),
            "teams": {"websocket": [], "database": []},
            "total_teams": 0,
            "error": str(e)
        }

@app.get("/api/games/active")
async def list_active_games():
    """List all active games with Phase 3 functionality"""
    # Always use PostgreSQL fallback since DynamoDB is disabled
    return await list_games()

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

# ===== PHASE 3: FULL GAME MANAGEMENT ENDPOINTS =====

@app.post("/api/games/create")
async def create_full_game(request: Dict[str, Any]):
    """Create a new game with full Phase 4 functionality including WebSocket integration"""
    if not SHARED_MODELS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Full game functionality not available")
    
    try:
        game_code = generate_game_code()
        
        # Parse request (handle both Pydantic and dict)
        max_teams = request.get('max_teams', 8)
        max_rounds = request.get('max_rounds', 20)
        selected_genres = request.get('selected_genres', [])
        
        # Create game data as dict (compatible approach)
        game_data = {
            'game_code': game_code,
            'status': 'waiting',
            'settings': {
                'max_teams': max_teams,
                'max_rounds': max_rounds,
                'selected_genres': selected_genres
            },
            'teams': [],
            'current_round': 0,
            'total_rounds': max_rounds,
            'rounds': [],
            'created_at': datetime.utcnow(),
            'started_at': None,
            'completed_at': None,
            'winner': None
        }
        
        # Store in DynamoDB if available (currently disabled)
        dynamodb_stored = False
        if DYNAMODB_CONNECTED:
            # DynamoDB code would go here when dependencies are resolved
            logger.info(f"Would store game {game_code} in DynamoDB (disabled)")
        else:
            logger.info("DynamoDB storage skipped - using PostgreSQL only")
        
        # Also store in PostgreSQL for persistence if available
        postgres_stored = False
        if DATABASE_CONNECTED:
            try:
                db_game = await GameService.create_game(game_code, max_teams)
                if db_game:
                    logger.info(f"Created game {game_code} in PostgreSQL")
                    postgres_stored = True
            except Exception as e:
                logger.error(f"Failed to store game {game_code} in PostgreSQL: {e}")
        
        # Notify WebSocket service about new game
        websocket_notified = False
        if WEBSOCKET_AVAILABLE:
            try:
                websocket_notified = await websocket_integration.notify_game_created(
                    game_code, game_data['settings']
                )
                logger.info(f"WebSocket notification for game {game_code}: {'SUCCESS' if websocket_notified else 'FAILED'}")
            except Exception as e:
                logger.warning(f"WebSocket notification failed for game {game_code}: {e}")
        
        return {
            "game_code": game_code,
            "status": game_data['status'],
            "settings": game_data['settings'],
            "created_at": game_data['created_at'].isoformat(),
            "storage": {
                "dynamodb": dynamodb_stored,
                "postgres": postgres_stored
            },
            "websocket_ready": websocket_notified,
            "mode": SERVICE_MODE
        }
        
    except Exception as e:
        logger.error(f"Error creating full game: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create game: {str(e)}")

@app.post("/api/games/{game_code}/join")
async def join_game(game_code: str, request: Dict[str, Any]):
    """Join a game as a team"""
    if not SHARED_MODELS_AVAILABLE or not DYNAMODB_CONNECTED:
        raise HTTPException(status_code=503, detail="Game joining requires full functionality")
    
    try:
        team_name = request.get('team_name', '').strip()
        if not team_name:
            raise HTTPException(status_code=400, detail="Team name is required")
        
        # Get current game state
        game = await dynamodb_client.get_game(game_code.upper())
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        
        if game.status != GameStatus.WAITING:
            raise HTTPException(status_code=400, detail="Game is not accepting new teams")
        
        # Check if team already exists
        existing_team = next((t for t in game.teams if t.team_name == team_name), None)
        if existing_team:
            raise HTTPException(status_code=400, detail="Team name already taken")
        
        # Check team limit
        if len(game.teams) >= game.settings.max_teams:
            raise HTTPException(status_code=400, detail="Game is full")
        
        # Add team
        new_team = TeamMember(
            team_name=team_name,
            joined_at=datetime.utcnow(),
            last_seen=datetime.utcnow()
        )
        game.teams.append(new_team)
        
        # Update game in DynamoDB
        success = await dynamodb_client.update_game(game)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to join game")
        
        logger.info(f"Team {team_name} joined game {game_code}")
        
        return {
            "message": f"Successfully joined game {game_code}",
            "team_name": team_name,
            "game_code": game_code,
            "teams_count": len(game.teams),
            "max_teams": game.settings.max_teams
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error joining game {game_code}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to join game: {str(e)}")

@app.get("/api/games/{game_code}/state")
async def get_game_state(game_code: str):
    """Get current game state"""
    if not SHARED_MODELS_AVAILABLE or not DYNAMODB_CONNECTED:
        # Fallback to Phase 2 functionality
        return await get_game(game_code)
    
    try:
        game = await dynamodb_client.get_game(game_code.upper())
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        
        return {
            "game_code": game.game_code,
            "status": game.status.value,
            "current_round": game.current_round,
            "total_rounds": game.total_rounds,
            "teams": [{
                "team_name": team.team_name,
                "score": team.score,
                "status": team.status.value,
                "joined_at": team.joined_at.isoformat()
            } for team in game.teams],
            "settings": game.settings.dict(),
            "created_at": game.created_at.isoformat(),
            "started_at": game.started_at.isoformat() if game.started_at else None,
            "mode": SERVICE_MODE
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting game state {game_code}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get game state: {str(e)}")

@app.post("/api/games/{game_code}/start")
async def start_game(game_code: str):
    """Start a game"""
    if not SHARED_MODELS_AVAILABLE or not DYNAMODB_CONNECTED:
        raise HTTPException(status_code=503, detail="Game starting requires full functionality")
    
    try:
        game = await dynamodb_client.get_game(game_code.upper())
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        
        if game.status != GameStatus.WAITING:
            raise HTTPException(status_code=400, detail="Game cannot be started")
        
        if len(game.teams) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 teams to start")
        
        # Update game status
        game.status = GameStatus.ACTIVE
        game.started_at = datetime.utcnow()
        game.current_round = 1
        
        # Update all teams to active
        for team in game.teams:
            team.status = TeamStatus.ACTIVE
        
        # Save updated game
        success = await dynamodb_client.update_game(game)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to start game")
        
        logger.info(f"Started game {game_code} with {len(game.teams)} teams")
        
        return {
            "message": "Game started successfully",
            "game_code": game_code,
            "status": game.status.value,
            "teams_count": len(game.teams),
            "current_round": game.current_round,
            "started_at": game.started_at.isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting game {game_code}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start game: {str(e)}")

@app.get("/api/games/active")
async def list_active_games():
    """List all active games with Phase 3 functionality"""
    # Always use PostgreSQL fallback since DynamoDB is disabled
    return await list_games()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    logger.info(f"Starting Game Management service on port {port}")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )
