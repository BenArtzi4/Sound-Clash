"""
Database connection utilities
"""
import os
import asyncpg
import redis.asyncio as redis
from typing import AsyncGenerator

async def get_postgres_connection() -> AsyncGenerator:
    """Get PostgreSQL connection"""
    conn = await asyncpg.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=os.getenv("POSTGRES_PORT", 5432),
        database=os.getenv("POSTGRES_DB", "soundclash"),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD", "password")
    )
    try:
        yield conn
    finally:
        await conn.close()

async def get_redis_connection() -> redis.Redis:
    """Get Redis connection"""
    return redis.Redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", 6379)),
        decode_responses=True
    )
