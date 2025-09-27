"""
Health check API endpoints
"""
from fastapi import APIRouter
from typing import Dict, Any

router = APIRouter()

@router.get("/", response_model=Dict[str, Any])
async def health_check():
    """Basic health check endpoint"""
    return {
        "status": "healthy",
        "service": "song-management",
        "version": "1.0.0"
    }

@router.get("/detailed", response_model=Dict[str, Any])
async def detailed_health_check():
    """Detailed health check with service status"""
    return {
        "status": "healthy",
        "service": "song-management",
        "version": "1.0.0",
        "checks": {
            "api": "healthy",
            "database": "checking..."
        }
    }
