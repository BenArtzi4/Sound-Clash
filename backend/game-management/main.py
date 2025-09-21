"""
Game Management Service - Main FastAPI Application
Handles game lifecycle, team joining, and waiting room management.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI(
    title="Sound Clash - Game Management Service",
    description="Manages game creation, team joining, and waiting room functionality",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {"service": "Game Management", "status": "running"}

@app.get("/health")
async def health_check():
    """Health check endpoint for ALB"""
    return {"status": "healthy", "service": "game-management"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("GAME_MANAGEMENT_PORT", 8001)))