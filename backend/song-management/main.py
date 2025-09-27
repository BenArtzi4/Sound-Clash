"""
Song Management Service - Working minimal version with proper routing
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

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

# Root endpoints (matching ALB routing /api/songs/*)
@app.get("/api/songs/")
async def root():
    return {
        "service": "Song Management Service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "health": "/api/songs/health/",
            "status": "/api/songs/status",
            "docs": "/api/songs/docs"
        }
    }

@app.get("/api/songs/health/")
async def health():
    return {"status": "healthy", "service": "song-management", "version": "1.0.0"}

@app.get("/api/songs/status")
async def status():
    return {
        "service": "operational",
        "version": "1.0.0",
        "features": ["basic_endpoints"],
        "message": "Service running successfully"
    }

# Health check endpoint for ALB (no prefix)
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
