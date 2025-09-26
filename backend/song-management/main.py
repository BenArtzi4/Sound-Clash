"""
Song Management Service - Simple microservice for song operations
"""

from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import os
from contextlib import asynccontextmanager

from api import songs, health
from database.postgres import get_db_connection, init_db
from models.song_models import SongResponse

# Initialize database on startup
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    print("🎵 Song Management Service started successfully")
    yield
    # Shutdown
    print("🎵 Song Management Service shutting down")

app = FastAPI(
    title="Song Management Service",
    description="Microservice for managing songs, genres, and playlists",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(songs.router, prefix="/api/songs", tags=["songs"])

@app.get("/")
async def root():
    return {
        "service": "Song Management Service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "songs": "/api/songs",
            "docs": "/docs"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8001)),
        reload=True
    )