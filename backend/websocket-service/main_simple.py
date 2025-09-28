"""
WebSocket Service - Simplified (No DynamoDB dependency)
Handles team connections and real-time communication without external storage
"""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# In-memory storage for simplified version (no DynamoDB)
class MemoryStorage:
    def __init__(self):
        self.games: Dict[str, Dict] = {}  # game_code -> game_data
        self.connections: Dict[str, WebSocket] = {}  # connection_id -> websocket
        self.teams: Dict[str, List[str]] = {}  # game_code -> [team_names]
        self.team_connections: Dict[str, Dict[str, str]] = {}  # game_code -> {team_name -> connection_id}
    
    def create_game(self, game_code: str, settings: Dict[str, Any]):
        """Create a new game room"""
        self.games[game_code] = {
            'game_code': game_code,
            'settings': settings,
            'status': 'waiting',
            'created_at': datetime.utcnow().isoformat()
        }
        self.teams[game_code] = []
        self.team_connections[game_code] = {}
        logger.info(f"Created game room: {game_code}")
    
    def add_team(self, game_code: str, team_name: str, connection_id: str) -> bool:
        """Add team to game"""
        if game_code not in self.teams:
            return False
        if team_name in self.teams[game_code]:
            return False  # Team already exists
        
        self.teams[game_code].append(team_name)
        self.team_connections[game_code][team_name] = connection_id
        logger.info(f"Team {team_name} joined game {game_code}")
        return True
    
    def remove_team(self, game_code: str, team_name: str):
        """Remove team from game"""
        if game_code in self.teams and team_name in self.teams[game_code]:
            self.teams[game_code].remove(team_name)
            if game_code in self.team_connections:
                self.team_connections[game_code].pop(team_name, None)
            logger.info(f"Team {team_name} left game {game_code}")
    
    def get_teams(self, game_code: str) -> List[str]:
        """Get teams in game"""
        return self.teams.get(game_code, [])
    
    def get_game(self, game_code: str) -> Optional[Dict]:
        """Get game data"""
        return self.games.get(game_code)

# Global storage
storage = MemoryStorage()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown"""
    logger.info("Starting WebSocket Service (Simplified)...")
    yield
    logger.info("Shutting down WebSocket Service...")

app = FastAPI(
    title="Sound Clash WebSocket Service",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {
        "service": "Sound Clash WebSocket Service",
        "version": "1.0.0",
        "status": "running",
        "mode": "simplified",
        "endpoints": {
            "health": "/health",
            "team_websocket": "/ws/team/{game_code}",
            "game_status": "/api/game/{game_code}/status",
            "game_notify": "/api/game/{game_code}/notify"
        }
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "websocket-service",
        "version": "1.0.0",
        "mode": "simplified"
    }

@app.post("/api/game/{game_code}/notify")
async def notify_game_created(game_code: str, request: Dict[str, Any]):
    """Notification endpoint for when games are created"""
    try:
        action = request.get('action')
        settings = request.get('settings', {})
        
        if action == 'game_created':
            storage.create_game(game_code.upper(), settings)
            return {
                "success": True,
                "message": f"Game {game_code} registered in WebSocket service",
                "game_code": game_code.upper()
            }
        else:
            return {
                "success": False,
                "message": f"Unknown action: {action}"
            }
            
    except Exception as e:
        logger.error(f"Error handling game notification: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/game/{game_code}/status")
async def get_game_status(game_code: str):
    """Get current status of a game room"""
    game_code = game_code.upper()
    game = storage.get_game(game_code)
    
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    
    teams = storage.get_teams(game_code)
    
    return {
        "game_code": game_code,
        "status": game.get('status', 'waiting'),
        "teams": teams,
        "total_teams": len(teams),
        "settings": game.get('settings', {}),
        "created_at": game.get('created_at')
    }

@app.websocket("/ws/team/{game_code}")
async def websocket_team_endpoint(websocket: WebSocket, game_code: str):
    """WebSocket endpoint for teams to join games"""
    game_code = game_code.upper()
    connection_id = None
    team_name = None
    
    try:
        await websocket.accept()
        logger.info(f"Team WebSocket connection accepted for game {game_code}")
        
        # Generate connection ID
        connection_id = f"{game_code}_{id(websocket)}"
        storage.connections[connection_id] = websocket
        
        # Wait for team join message
        data = await websocket.receive_text()
        message = json.loads(data)
        
        if message.get('type') == 'team_join':
            team_name = message.get('team_name', '').strip()
            
            if not team_name:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Team name is required"
                }))
                return
            
            # Check if game exists
            game = storage.get_game(game_code)
            if not game:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Game not found"
                }))
                return
            
            # Try to add team
            success = storage.add_team(game_code, team_name, connection_id)
            
            if success:
                # Send success response
                await websocket.send_text(json.dumps({
                    "type": "connection_ack",
                    "success": True,
                    "team_name": team_name,
                    "game_code": game_code,
                    "teams_count": len(storage.get_teams(game_code))
                }))
                
                logger.info(f"Team '{team_name}' successfully joined game {game_code}")
                
                # Main message loop
                while True:
                    try:
                        data = await websocket.receive_text()
                        message = json.loads(data)
                        
                        if message.get('type') == 'ping':
                            await websocket.send_text(json.dumps({"type": "pong"}))
                        elif message.get('type') == 'team_leave':
                            break
                            
                    except WebSocketDisconnect:
                        break
                    except Exception as e:
                        logger.error(f"Error in team message loop: {e}")
                        break
            else:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Failed to join game - team name may already exist"
                }))
        else:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Expected team_join message"
            }))
    
    except WebSocketDisconnect:
        logger.info(f"Team WebSocket disconnected: {team_name} from game {game_code}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Cleanup
        if connection_id and connection_id in storage.connections:
            del storage.connections[connection_id]
        if team_name and game_code:
            storage.remove_team(game_code, team_name)

if __name__ == "__main__":
    uvicorn.run(
        "main_simplified:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8002)),
        reload=False
    )
