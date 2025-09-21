"""
Game Management Service - Main FastAPI Application
Handles game lifecycle, team joining, and waiting room management.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from contextlib import asynccontextmanager

from api.games import router as games_router
from api.health import router as health_router
from database.postgres import create_tables
from database.redis import redis_manager

# Load environment variables
load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager"""
    # Startup
    await redis_manager.connect()
    await create_tables()
    yield
    # Shutdown
    await redis_manager.disconnect()

app = FastAPI(
    title="Sound Clash - Game Management Service",
    description="Manages game creation, team joining, and waiting room functionality",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health_router)
app.include_router(games_router)

@app.get("/")
async def root():
    return {
        "service": "Game Management", 
        "status": "running",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "games": "/api/games",
            "docs": "/docs"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=int(os.getenv("GAME_MANAGEMENT_PORT", 8001)),
        reload=True
    )