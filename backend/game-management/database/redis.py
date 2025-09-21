"""
Redis connection manager for caching and session management
"""

import redis.asyncio as redis
import json
import os
from typing import Optional, Any

class RedisManager:
    def __init__(self):
        self.redis_client = None
        
    async def connect(self):
        """Connect to Redis"""
        self.redis_client = redis.Redis(
            host=os.getenv('REDIS_HOST', 'localhost'),
            port=int(os.getenv('REDIS_PORT', 6379)),
            decode_responses=True
        )
        
    async def disconnect(self):
        """Disconnect from Redis"""
        if self.redis_client:
            await self.redis_client.close()
    
    async def set_game_cache(self, game_code: str, data: dict, ttl: int = 14400):
        """Cache game data with TTL (4 hours default)"""
        await self.redis_client.setex(
            f"game:{game_code}", 
            ttl, 
            json.dumps(data)
        )
    
    async def get_game_cache(self, game_code: str) -> Optional[dict]:
        """Get cached game data"""
        data = await self.redis_client.get(f"game:{game_code}")
        return json.loads(data) if data else None
    
    async def delete_game_cache(self, game_code: str):
        """Delete cached game data"""
        await self.redis_client.delete(f"game:{game_code}")

# Global Redis manager instance
redis_manager = RedisManager()