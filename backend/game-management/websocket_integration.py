"""
WebSocket Integration Service for Game Management
Handles communication between game management and WebSocket service
"""
import aiohttp
import logging
import asyncio
from typing import Dict, Any, Optional
import os

logger = logging.getLogger(__name__)

class WebSocketIntegration:
    def __init__(self):
        # In production, use the internal ALB DNS or service discovery
        # For now, hardcode the ALB URL since both services are behind the same ALB
        self.websocket_url = os.getenv("WEBSOCKET_SERVICE_URL", "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com")
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def initialize(self):
        """Initialize HTTP session for WebSocket service communication"""
        if not self.session:
            self.session = aiohttp.ClientSession()
    
    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()
    
    async def notify_game_created(self, game_code: str, settings: Dict[str, Any]) -> bool:
        """Notify WebSocket service that a new game was created"""
        try:
            await self.initialize()
            
            # Match the exact format the WebSocket service expects
            payload = {
                "action": "game_created",
                "settings": settings
            }
            
            async with self.session.post(
                f"{self.websocket_url}/api/game/{game_code}/notify",
                json=payload,
                timeout=5
            ) as response:
                if response.status == 200:
                    logger.info(f"Successfully notified WebSocket service of game {game_code}")
                    return True
                else:
                    logger.warning(f"WebSocket service returned status {response.status}")
                    return False
                    
        except Exception as e:
            logger.error(f"Failed to notify WebSocket service: {e}")
            return False
    
    async def get_game_teams(self, game_code: str) -> Dict[str, Any]:
        """Get current teams from WebSocket service"""
        try:
            await self.initialize()
            
            async with self.session.get(
                f"{self.websocket_url}/api/game/{game_code}/status",
                timeout=5
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                else:
                    logger.warning(f"Failed to get teams, status: {response.status}")
                    return {"teams": [], "total": 0}
                    
        except Exception as e:
            logger.error(f"Failed to get teams from WebSocket service: {e}")
            return {"teams": [], "total": 0}
    
    async def check_websocket_health(self) -> bool:
        """Check if WebSocket service is healthy"""
        try:
            await self.initialize()
            
            async with self.session.get(
                f"{self.websocket_url}/health",
                timeout=3
            ) as response:
                return response.status == 200
                
        except Exception as e:
            logger.debug(f"WebSocket service health check failed: {e}")
            return False

# Global WebSocket integration instance
websocket_integration = WebSocketIntegration()
