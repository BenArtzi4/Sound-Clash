"""
Health check endpoints for ALB and monitoring
"""

from fastapi import APIRouter, HTTPException
from database.redis import redis_manager
from database.postgres import engine
from database.dynamodb import dynamodb_manager
import os

router = APIRouter(tags=["health"])

@router.get("/health")
async def health_check():
    """Basic health check for ALB"""
    return {
        "status": "healthy",
        "service": "game-management",
        "version": "1.0.0"
    }

@router.get("/health/detailed")
async def detailed_health_check():
    """Detailed health check including database connections"""
    health_status = {
        "service": "game-management",
        "status": "healthy",
        "checks": {}
    }
    
    # Check Redis connection
    try:
        await redis_manager.redis_client.ping()
        health_status["checks"]["redis"] = "healthy"
    except Exception as e:
        health_status["checks"]["redis"] = f"unhealthy: {str(e)}"
        health_status["status"] = "degraded"
    
    # Check PostgreSQL connection
    try:
        async with engine.begin() as conn:
            await conn.execute("SELECT 1")
        health_status["checks"]["postgres"] = "healthy"
    except Exception as e:
        health_status["checks"]["postgres"] = f"unhealthy: {str(e)}"
        health_status["status"] = "degraded"
    
    # Check DynamoDB connection (if not local)
    if not os.getenv('DYNAMODB_ENDPOINT'):
        try:
            # Simple table existence check
            table = dynamodb_manager.dynamodb.Table(dynamodb_manager.active_games_table)
            table.load()
            health_status["checks"]["dynamodb"] = "healthy"
        except Exception as e:
            health_status["checks"]["dynamodb"] = f"unhealthy: {str(e)}"
            health_status["status"] = "degraded"
    else:
        health_status["checks"]["dynamodb"] = "local-development"
    
    if health_status["status"] == "degraded":
        raise HTTPException(status_code=503, detail=health_status)
    
    return health_status