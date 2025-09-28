"""
Game Management Service - Simplified Main Application for Phase 1
Fixed ALB routing for health endpoints
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import logging
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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

@app.get("/")
async def root():
    return {
        "service": "Sound Clash Game Management Service", 
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "game-management",
        "version": "1.0.0"
    }

# PHASE 1 FIX: Specific endpoints before catch-all patterns
@app.get("/api/games/health")
async def api_health():
    """Health endpoint accessible via ALB routing /api/games/*"""
    return {
        "status": "healthy",
        "service": "game-management",
        "version": "1.0.0",
        "endpoint": "/api/games/health"
    }

@app.get("/api/games")
async def list_games():
    """List active games"""
    return {
        "games": [],
        "total": 0,
        "message": "Game management service running"
    }

@app.post("/api/games")
async def create_game():
    """Create a new game"""
    return {
        "game_code": "ABC123",
        "status": "created", 
        "message": "Game creation endpoint working"
    }

@app.get("/api/games/status")
async def games_status():
    """Get service status"""
    return {
        "active_games": 0,
        "total_games": 0,
        "service_status": "healthy"
    }

# Catch-all route - MUST be last
@app.get("/api/games/{game_code}")
async def get_game(game_code: str):
    """Get specific game details"""
    return {
        "game_code": game_code,
        "status": "active",
        "teams": [],
        "message": f"Game {game_code} details"
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    logger.info(f"Starting Game Management service on port {port}")
    uvicorn.run(
        "main:app",  # Use main.py instead of main_simple.py
        host="0.0.0.0",
        port=port,
        reload=False
    )
