"""
Game Management Service - Main FastAPI Application
Handles game lifecycle, team joining, waiting room management, and genre selection.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from contextlib import asynccontextmanager
import logging

# Load environment variables
load_dotenv('.env')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from api.games import router as games_router
from api.genres import router as genres_router  # Add genres router
from api.health import router as health_router
from database.postgres import create_tables
from database.redis import redis_manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager"""
    # Startup
    logger.info("Starting Game Management Service...")
    await redis_manager.connect()
    await create_tables()
    logger.info("Service startup complete")
    yield
    # Shutdown
    logger.info("Shutting down Game Management Service...")
    await redis_manager.disconnect()
    logger.info("Service shutdown complete")

app = FastAPI(
    title="Sound Clash - Game Management Service",
    description="Manages game creation, team joining, waiting room functionality, and genre selection",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,https://d3ipoiakfzt21m.cloudfront.net").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health_router)
app.include_router(games_router)
app.include_router(genres_router)  # Add genres router

@app.get("/")
async def root():
    return {
        "service": "Game Management", 
        "status": "running",
        "version": "1.0.0",
        "features": ["game_creation", "team_management", "genre_selection", "waiting_room"],
        "endpoints": {
            "health": "/health",
            "games": "/api/games",
            "genres": "/api/genres",
            "docs": "/docs"
        }
    }

@app.get("/api/info")
async def api_info():
    """API information endpoint"""
    return {
        "service": "game-management",
        "endpoints": {
            "games": {
                "create": "POST /api/games",
                "join": "POST /api/games/{gameCode}/join",
                "status": "GET /api/games/{gameCode}/status",
                "waiting_room": "GET /api/games/{gameCode}/waiting-room",
                "start": "POST /api/games/{gameCode}/start",
                "delete": "DELETE /api/games/{gameCode}"
            },
            "genres": {
                "list": "GET /api/genres",
                "categories": "GET /api/genres/categories",
                "details": "GET /api/genres/{slug}",
                "songs": "GET /api/genres/{slug}/songs",
                "stats": "GET /api/genres/stats/summary"
            }
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=int(os.getenv("GAME_MANAGEMENT_PORT", 8001)),
        reload=os.getenv("ENVIRONMENT", "development") == "development"
    )