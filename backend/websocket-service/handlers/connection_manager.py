"""
WebSocket connection manager for handling multiple clients per game room
"""
import asyncio
import json
import logging
from typing import Dict, List, Set, Optional
from fastapi import WebSocket, WebSocketDisconnect
from datetime import datetime, timezone

from models.team_models import (
    WebSocketMessage, MessageType, ConnectionStatus, 
    TeamConnection, GameRoom
)

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # {game_code: {connection_id: websocket}}
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        
        # {game_code: {team_name: connection_id}}
        self.team_connections: Dict[str, Dict[str, str]] = {}
        
        # {connection_id: (game_code, team_name, websocket)}
        self.connection_registry: Dict[str, tuple] = {}
        
        # Manager connections {game_code: connection_id}
        self.manager_connections: Dict[str, str] = {}
        
        # Connection heartbeat tracking
        self.last_ping: Dict[str, datetime] = {}

    async def connect_team(self, websocket: WebSocket, game_code: str, team_name: str) -> str:
        """Connect a team to a game room"""
        await websocket.accept()
        
        # Generate unique connection ID
        connection_id = f"{game_code}_{team_name}_{id(websocket)}"
        
        # Initialize game room if not exists
        if game_code not in self.active_connections:
            self.active_connections[game_code] = {}
            self.team_connections[game_code] = {}
        
        # Store connection
        self.active_connections[game_code][connection_id] = websocket
        self.team_connections[game_code][team_name] = connection_id
        self.connection_registry[connection_id] = (game_code, team_name, websocket)
        self.last_ping[connection_id] = datetime.now(timezone.utc)
        
        logger.info(f"Team '{team_name}' connected to game {game_code} (connection: {connection_id})")
        return connection_id

    async def connect_manager(self, websocket: WebSocket, game_code: str) -> str:
        """Connect a manager to monitor a game room"""
        await websocket.accept()
        
        connection_id = f"{game_code}_manager_{id(websocket)}"
        
        # Initialize game room if not exists
        if game_code not in self.active_connections:
            self.active_connections[game_code] = {}
        
        # Store manager connection
        self.active_connections[game_code][connection_id] = websocket
        self.manager_connections[game_code] = connection_id
        self.connection_registry[connection_id] = (game_code, "manager", websocket)
        self.last_ping[connection_id] = datetime.now(timezone.utc)
        
        logger.info(f"Manager connected to game {game_code} (connection: {connection_id})")
        return connection_id

    async def disconnect(self, connection_id: str):
        """Disconnect a client and clean up"""
        if connection_id not in self.connection_registry:
            return
        
        game_code, team_name, websocket = self.connection_registry[connection_id]
        
        # Remove from active connections
        if game_code in self.active_connections:
            self.active_connections[game_code].pop(connection_id, None)
            
            # If no more connections in game room, clean up
            if not self.active_connections[game_code]:
                del self.active_connections[game_code]
        
        # Remove team connection
        if game_code in self.team_connections and team_name in self.team_connections[game_code]:
            del self.team_connections[game_code][team_name]
            
            # Clean up empty game room
            if not self.team_connections[game_code]:
                del self.team_connections[game_code]
        
        # Remove manager connection
        if game_code in self.manager_connections and self.manager_connections[game_code] == connection_id:
            del self.manager_connections[game_code]
        
        # Clean up registry and ping tracking
        del self.connection_registry[connection_id]
        self.last_ping.pop(connection_id, None)
        
        logger.info(f"Disconnected {team_name} from game {game_code} (connection: {connection_id})")

    async def send_personal_message(self, message: WebSocketMessage, connection_id: str):
        """Send message to a specific connection"""
        if connection_id not in self.connection_registry:
            logger.warning(f"Connection {connection_id} not found")
            return False
        
        _, _, websocket = self.connection_registry[connection_id]
        try:
            await websocket.send_text(message.model_dump_json())
            return True
        except Exception as e:
            logger.error(f"Failed to send message to {connection_id}: {e}")
            await self.disconnect(connection_id)
            return False

    async def send_to_team(self, message: WebSocketMessage, game_code: str, team_name: str):
        """Send message to a specific team"""
        if game_code not in self.team_connections:
            return False
        
        if team_name not in self.team_connections[game_code]:
            return False
        
        connection_id = self.team_connections[game_code][team_name]
        return await self.send_personal_message(message, connection_id)

    async def broadcast_to_game(self, message: WebSocketMessage, game_code: str, exclude_connection: Optional[str] = None):
        """Broadcast message to all connections in a game room"""
        if game_code not in self.active_connections:
            return
        
        disconnected_connections = []
        
        for connection_id, websocket in self.active_connections[game_code].items():
            if connection_id == exclude_connection:
                continue
                
            try:
                await websocket.send_text(message.model_dump_json())
            except Exception as e:
                logger.error(f"Failed to broadcast to {connection_id}: {e}")
                disconnected_connections.append(connection_id)
        
        # Clean up failed connections
        for conn_id in disconnected_connections:
            await self.disconnect(conn_id)

    async def broadcast_to_teams_only(self, message: WebSocketMessage, game_code: str):
        """Broadcast message only to team connections (not manager)"""
        if game_code not in self.team_connections:
            return
        
        for team_name, connection_id in self.team_connections[game_code].items():
            await self.send_personal_message(message, connection_id)

    async def send_to_manager(self, message: WebSocketMessage, game_code: str):
        """Send message to the manager if connected"""
        if game_code not in self.manager_connections:
            return False
        
        connection_id = self.manager_connections[game_code]
        return await self.send_personal_message(message, connection_id)

    def get_teams_in_game(self, game_code: str) -> List[str]:
        """Get list of connected teams in a game"""
        if game_code not in self.team_connections:
            return []
        return list(self.team_connections[game_code].keys())

    def get_connection_count(self, game_code: str) -> int:
        """Get total connection count for a game"""
        if game_code not in self.active_connections:
            return 0
        return len(self.active_connections[game_code])

    def is_team_connected(self, game_code: str, team_name: str) -> bool:
        """Check if a team is currently connected"""
        return (game_code in self.team_connections and 
                team_name in self.team_connections[game_code])

    def is_manager_connected(self, game_code: str) -> bool:
        """Check if manager is connected to game"""
        return game_code in self.manager_connections

    async def update_ping(self, connection_id: str):
        """Update last ping time for connection"""
        self.last_ping[connection_id] = datetime.now(timezone.utc)

    async def cleanup_stale_connections(self, timeout_seconds: int = 600):
        """Remove connections that haven't pinged recently (default 10 minutes)"""
        current_time = datetime.now(timezone.utc)
        stale_connections = []

        for connection_id, last_ping in self.last_ping.items():
            if (current_time - last_ping).total_seconds() > timeout_seconds:
                stale_connections.append(connection_id)

        for connection_id in stale_connections:
            logger.info(f"Cleaning up stale connection: {connection_id}")
            await self.disconnect(connection_id)

# Global connection manager instance
connection_manager = ConnectionManager()
