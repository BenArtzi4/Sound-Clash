"""
WebSocket Service - Task 2.3 Enhanced
Real-time team management with broadcasting for waiting room
"""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Dict, Any, List, Optional, Set
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

# In-memory storage for WebSocket connections and game state
class GameRoom:
    """Represents a game room with teams and connections"""

    def __init__(self, game_code: str, settings: Dict[str, Any]):
        self.game_code = game_code
        self.settings = settings
        self.status = 'waiting'
        self.created_at = datetime.utcnow().isoformat()

        # Team connections: {team_name: websocket}
        self.team_connections: Dict[str, WebSocket] = {}
        # Manager connections: [websocket1, websocket2, ...]
        self.manager_connections: List[WebSocket] = []
        # Display connections: [websocket1, websocket2, ...]
        self.display_connections: List[WebSocket] = []
        # Track join times
        self.team_join_times: Dict[str, str] = {}

        # Gameplay state
        self.current_round: Optional[Dict[str, Any]] = None
        self.buzzed_team: Optional[str] = None
        self.locked_components = {"song_name": False, "artist_content": False}
        self.team_scores: Dict[str, int] = {}
        self.round_number = 0
    
    def add_team(self, team_name: str, websocket: WebSocket) -> bool:
        """Add team to room"""
        if team_name in self.team_connections:
            return False
        
        self.team_connections[team_name] = websocket
        self.team_join_times[team_name] = datetime.utcnow().isoformat()
        logger.info(f"Team '{team_name}' joined game {self.game_code}")
        return True
    
    def remove_team(self, team_name: str):
        """Remove team from room"""
        if team_name in self.team_connections:
            del self.team_connections[team_name]
            self.team_join_times.pop(team_name, None)
            logger.info(f"Team '{team_name}' left game {self.game_code}")
    
    def add_manager(self, websocket: WebSocket):
        """Add manager connection"""
        self.manager_connections.append(websocket)
        logger.info(f"Manager joined game {self.game_code}")
    
    def remove_manager(self, websocket: WebSocket):
        """Remove manager connection"""
        if websocket in self.manager_connections:
            self.manager_connections.remove(websocket)
            logger.info(f"Manager left game {self.game_code}")

    def add_display(self, websocket: WebSocket):
        """Add display connection"""
        self.display_connections.append(websocket)
        logger.info(f"Display joined game {self.game_code}")

    def remove_display(self, websocket: WebSocket):
        """Remove display connection"""
        if websocket in self.display_connections:
            self.display_connections.remove(websocket)
            logger.info(f"Display left game {self.game_code}")
    
    def get_teams_list(self) -> List[Dict[str, Any]]:
        """Get list of teams with metadata"""
        return [
            {
                "name": team_name,
                "joined_at": self.team_join_times.get(team_name),
                "connected": True
            }
            for team_name in self.team_connections.keys()
        ]
    
    async def broadcast_to_teams(self, message: Dict[str, Any], exclude: Optional[str] = None):
        """Broadcast message to all teams except excluded one"""
        logger.info(f"Broadcasting to teams in {self.game_code}: {len(self.team_connections)} teams, exclude={exclude}")
        logger.info(f"Message: {message}")
        disconnected = []
        for team_name, websocket in list(self.team_connections.items()):
            if team_name == exclude:
                logger.info(f"  Skipping {team_name} (excluded)")
                continue
            try:
                logger.info(f"  Sending to {team_name}")
                await websocket.send_text(json.dumps(message))
                logger.info(f"  Successfully sent to {team_name}")
            except Exception as e:
                logger.error(f"Failed to send to team {team_name}: {e}")
                disconnected.append(team_name)
        
        # Clean up disconnected teams
        for team_name in disconnected:
            self.remove_team(team_name)
    
    async def broadcast_to_managers(self, message: Dict[str, Any]):
        """Broadcast message to all managers"""
        disconnected = []
        for i, websocket in enumerate(self.manager_connections):
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to send to manager: {e}")
                disconnected.append(websocket)

        # Clean up disconnected managers
        for websocket in disconnected:
            self.remove_manager(websocket)

    async def broadcast_to_displays(self, message: Dict[str, Any]):
        """Broadcast message to all displays"""
        disconnected = []
        for websocket in self.display_connections:
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to send to display: {e}")
                disconnected.append(websocket)

        # Clean up disconnected displays
        for websocket in disconnected:
            self.remove_display(websocket)

    async def broadcast_to_all(self, message: Dict[str, Any]):
        """Broadcast message to everyone (teams, managers, displays)"""
        await self.broadcast_to_teams(message)
        await self.broadcast_to_managers(message)
        await self.broadcast_to_displays(message)
    
    async def broadcast_team_update(self, event_type: str, team_name: str):
        """Broadcast team list update to all connected clients"""
        teams_list = self.get_teams_list()
        update_message = {
            "type": "team_update",
            "event": event_type,
            "team_name": team_name,
            "teams": teams_list,
            "total_teams": len(teams_list),
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Send to all teams
        await self.broadcast_to_teams(update_message)
        # Send to all managers
        await self.broadcast_to_managers(update_message)


class MemoryStorage:
    """In-memory storage for all game rooms"""
    
    def __init__(self):
        self.rooms: Dict[str, GameRoom] = {}
    
    def create_game(self, game_code: str, settings: Dict[str, Any]) -> GameRoom:
        """Create new game room"""
        room = GameRoom(game_code, settings)
        self.rooms[game_code] = room
        logger.info(f"Created game room: {game_code}")
        return room
    
    def get_room(self, game_code: str) -> Optional[GameRoom]:
        """Get game room"""
        return self.rooms.get(game_code)
    
    def delete_game(self, game_code: str):
        """Delete game room"""
        if game_code in self.rooms:
            del self.rooms[game_code]
            logger.info(f"Deleted game room: {game_code}")


# Global storage
storage = MemoryStorage()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown"""
    logger.info("Starting WebSocket Service - Task 2.3 Enhanced...")
    yield
    logger.info("Shutting down WebSocket Service...")

app = FastAPI(
    title="Sound Clash WebSocket Service",
    version="2.3.0",
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
        "version": "2.3.0",
        "status": "running",
        "task": "2.3 - Waiting Room WebSocket Integration",
        "active_games": len(storage.rooms),
        "total_teams": sum(len(room.team_connections) for room in storage.rooms.values()),
        "total_managers": sum(len(room.manager_connections) for room in storage.rooms.values()),
        "total_displays": sum(len(room.display_connections) for room in storage.rooms.values()),
        "endpoints": {
            "health": "/health",
            "debug": "/debug",
            "team_websocket": "/ws/team/{game_code}",
            "manager_websocket": "/ws/manager/{game_code}",
            "display_websocket": "/ws/display/{game_code}",
            "game_status": "/api/game/{game_code}/status",
            "game_notify": "/api/game/{game_code}/notify",
            "kick_team": "/api/game/{game_code}/kick/{team_name}"
        }
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "websocket-service",
        "version": "2.3.0",
        "active_games": len(storage.rooms),
        "total_teams": sum(len(room.team_connections) for room in storage.rooms.values()),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/debug")
async def debug_info():
    """Debug endpoint to check service state"""
    return {
        "status": "healthy",
        "service": "websocket-service",
        "version": "2.3.0",
        "active_games": list(storage.rooms.keys()),
        "game_details": {
            game_code: {
                "teams": room.get_teams_list(),
                "team_count": len(room.team_connections),
                "manager_count": len(room.manager_connections),
                "display_count": len(room.display_connections),
                "status": room.status,
                "round_number": room.round_number,
                "buzzed_team": room.buzzed_team,
                "team_scores": room.team_scores,
                "created_at": room.created_at
            }
            for game_code, room in storage.rooms.items()
        },
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/game/{game_code}/notify")
async def notify_game_created(game_code: str, request: Dict[str, Any]):
    """Notification endpoint for when games are created"""
    try:
        game_code = game_code.upper()
        action = request.get('action')
        settings = request.get('settings', {})
        
        if action == 'game_created':
            room = storage.create_game(game_code, settings)
            return {
                "success": True,
                "message": f"Game {game_code} registered in WebSocket service",
                "game_code": game_code,
                "settings": settings
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
    room = storage.get_room(game_code)
    
    if not room:
        raise HTTPException(status_code=404, detail="Game not found")
    
    return {
        "game_code": game_code,
        "status": room.status,
        "teams": room.get_teams_list(),
        "total_teams": len(room.team_connections),
        "manager_connected": len(room.manager_connections) > 0,
        "settings": room.settings,
        "created_at": room.created_at
    }

@app.post("/api/game/{game_code}/kick/{team_name}")
async def kick_team(game_code: str, team_name: str):
    """Manager endpoint to kick a team"""
    game_code = game_code.upper()
    room = storage.get_room(game_code)
    
    if not room:
        raise HTTPException(status_code=404, detail="Game not found")
    
    if team_name not in room.team_connections:
        raise HTTPException(status_code=404, detail="Team not found")
    
    # Get the team's websocket
    team_ws = room.team_connections[team_name]
    
    try:
        # Send kicked message
        await team_ws.send_text(json.dumps({
            "type": "kicked",
            "message": "You have been removed from the game by the manager"
        }))
        # Close connection
        await team_ws.close()
    except Exception as e:
        logger.error(f"Error kicking team: {e}")
    
    # Remove team
    room.remove_team(team_name)
    
    # Broadcast update
    await room.broadcast_team_update("team_kicked", team_name)
    
    return {
        "success": True,
        "message": f"Team {team_name} kicked from game {game_code}",
        "remaining_teams": len(room.team_connections)
    }

@app.websocket("/ws/team/{game_code}")
async def websocket_team_endpoint(websocket: WebSocket, game_code: str):
    """WebSocket endpoint for teams to join games"""
    game_code = game_code.upper()
    team_name = None
    
    try:
        await websocket.accept()
        logger.info(f"Team WebSocket connection accepted for game {game_code}")
        
        # Wait for team join message
        data = await websocket.receive_text()
        message = json.loads(data)
        
        if message.get('type') != 'team_join':
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Expected team_join message"
            }))
            return
        
        team_name = message.get('team_name', '').strip()
        
        if not team_name:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Team name is required"
            }))
            return
        
        # Get game room
        room = storage.get_room(game_code)
        if not room:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Game not found"
            }))
            return
        
        # Try to add team
        success = room.add_team(team_name, websocket)
        
        if not success:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Team name already taken"
            }))
            return
        
        # Send success response
        await websocket.send_text(json.dumps({
            "type": "connection_ack",
            "success": True,
            "team_name": team_name,
            "game_code": game_code,
            "teams": room.get_teams_list(),
            "teams_count": len(room.team_connections)
        }))
        
        logger.info(f"Team '{team_name}' successfully joined game {game_code}")
        
        # Broadcast to others that new team joined
        await room.broadcast_team_update("team_joined", team_name)
        
        # Main message loop with heartbeat
        try:
            while True:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                message = json.loads(data)
                
                msg_type = message.get('type')
                
                if msg_type == 'ping':
                    await websocket.send_text(json.dumps({
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat()
                    }))
                
                elif msg_type == 'team_leave':
                    break

                elif msg_type == 'get_teams':
                    await websocket.send_text(json.dumps({
                        "type": "teams_list",
                        "teams": room.get_teams_list(),
                        "total_teams": len(room.team_connections)
                    }))

                elif msg_type == 'buzz_pressed':
                    # Handle team buzzing
                    if room.buzzed_team is None and room.status == 'playing':
                        room.buzzed_team = team_name
                        # Broadcast buzzer locked to everyone
                        await room.broadcast_to_all({
                            "type": "buzzer_locked",
                            "team_name": team_name,
                            "timestamp": datetime.utcnow().isoformat(),
                            "reaction_time_ms": 0  # TODO: Calculate actual reaction time
                        })
                        logger.info(f"Team '{team_name}' buzzed first in game {game_code}")
        
        except asyncio.TimeoutError:
            logger.warning(f"Team {team_name} connection timed out")
        except WebSocketDisconnect:
            logger.info(f"Team {team_name} disconnected")
    
    except WebSocketDisconnect:
        logger.info(f"Team WebSocket disconnected: {team_name} from game {game_code}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Cleanup
        if team_name and game_code:
            room = storage.get_room(game_code)
            if room:
                room.remove_team(team_name)
                # Broadcast that team left
                await room.broadcast_team_update("team_left", team_name)

@app.websocket("/ws/manager/{game_code}")
async def websocket_manager_endpoint(websocket: WebSocket, game_code: str):
    """WebSocket endpoint for managers to control games"""
    game_code = game_code.upper()
    
    try:
        await websocket.accept()
        logger.info(f"Manager WebSocket connection accepted for game {game_code}")
        
        # Get game room
        room = storage.get_room(game_code)
        if not room:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Game not found"
            }))
            return
        
        # Add manager to room
        room.add_manager(websocket)
        
        # Send initial state
        await websocket.send_text(json.dumps({
            "type": "manager_connected",
            "success": True,
            "game_code": game_code,
            "teams": room.get_teams_list(),
            "total_teams": len(room.team_connections),
            "status": room.status
        }))
        
        logger.info(f"Manager successfully connected to game {game_code}")
        
        # Main message loop
        try:
            while True:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                message = json.loads(data)
                
                msg_type = message.get('type')
                
                if msg_type == 'ping':
                    await websocket.send_text(json.dumps({
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat()
                    }))
                
                elif msg_type == 'get_teams':
                    await websocket.send_text(json.dumps({
                        "type": "teams_list",
                        "teams": room.get_teams_list(),
                        "total_teams": len(room.team_connections)
                    }))
                
                elif msg_type == 'start_game':
                    room.status = 'playing'
                    # Initialize team scores
                    for team_name in room.team_connections.keys():
                        room.team_scores[team_name] = 0
                    await room.broadcast_to_all({
                        "type": "game_started",
                        "message": "Game is starting!",
                        "timestamp": datetime.utcnow().isoformat()
                    })
                    await websocket.send_text(json.dumps({
                        "type": "game_started",
                        "success": True
                    }))

                elif msg_type == 'start_round':
                    # Manager starts a new round
                    song_data = message.get('song', {})
                    room.round_number += 1
                    room.current_round = song_data
                    room.buzzed_team = None
                    room.locked_components = {"song_name": False, "artist_content": False}

                    await room.broadcast_to_all({
                        "type": "round_started",
                        "round_number": room.round_number,
                        "song": song_data,
                        "is_soundtrack": song_data.get('is_soundtrack', False),
                        "timestamp": datetime.utcnow().isoformat()
                    })
                    logger.info(f"Round {room.round_number} started in game {game_code}")

                elif msg_type == 'evaluate_answer':
                    # Manager evaluates team's answer
                    song_correct = message.get('song_correct', False)
                    artist_correct = message.get('artist_correct', False)
                    wrong_answer = message.get('wrong_answer', False)

                    if room.buzzed_team:
                        # Update component locks
                        if song_correct:
                            room.locked_components["song_name"] = True
                            room.team_scores[room.buzzed_team] = room.team_scores.get(room.buzzed_team, 0) + 10
                        if artist_correct:
                            room.locked_components["artist_content"] = True
                            room.team_scores[room.buzzed_team] = room.team_scores.get(room.buzzed_team, 0) + 5
                        if wrong_answer:
                            room.team_scores[room.buzzed_team] = room.team_scores.get(room.buzzed_team, 0) - 2

                        # Reset buzzed team
                        room.buzzed_team = None

                        # Check if round is complete
                        round_complete = room.locked_components["song_name"] and room.locked_components["artist_content"]

                        # Broadcast answer evaluation
                        await room.broadcast_to_all({
                            "type": "answer_evaluated",
                            "locked_components": room.locked_components,
                            "team_scores": room.team_scores,
                            "timestamp": datetime.utcnow().isoformat()
                        })

                        # If round complete, broadcast that
                        if round_complete:
                            await room.broadcast_to_all({
                                "type": "round_completed",
                                "team_scores": room.team_scores,
                                "timestamp": datetime.utcnow().isoformat()
                            })

                elif msg_type == 'restart_song':
                    # Manager restarts the song
                    room.buzzed_team = None
                    await room.broadcast_to_all({
                        "type": "song_restarted",
                        "timestamp": datetime.utcnow().isoformat()
                    })

                elif msg_type == 'skip_round':
                    # Manager skips current round
                    room.buzzed_team = None
                    room.locked_components = {"song_name": False, "artist_content": False}
                    await room.broadcast_to_all({
                        "type": "round_completed",
                        "team_scores": room.team_scores,
                        "skipped": True,
                        "timestamp": datetime.utcnow().isoformat()
                    })

                elif msg_type == 'end_game':
                    # Manager ends the game
                    room.status = 'finished'
                    # Determine winner
                    if room.team_scores:
                        winner = max(room.team_scores.items(), key=lambda x: x[1])
                        await room.broadcast_to_all({
                            "type": "game_ended",
                            "winner": winner[0],
                            "final_scores": room.team_scores,
                            "rounds_played": room.round_number,
                            "timestamp": datetime.utcnow().isoformat()
                        })
                    else:
                        await room.broadcast_to_all({
                            "type": "game_ended",
                            "message": "Game ended with no scores",
                            "timestamp": datetime.utcnow().isoformat()
                        })
        
        except asyncio.TimeoutError:
            logger.warning(f"Manager connection timed out for game {game_code}")
        except WebSocketDisconnect:
            logger.info(f"Manager disconnected from game {game_code}")
    
    except WebSocketDisconnect:
        logger.info(f"Manager WebSocket disconnected from game {game_code}")
    except Exception as e:
        logger.error(f"Manager WebSocket error: {e}")
    finally:
        # Cleanup
        room = storage.get_room(game_code)
        if room:
            room.remove_manager(websocket)

@app.websocket("/ws/display/{game_code}")
async def websocket_display_endpoint(websocket: WebSocket, game_code: str):
    """WebSocket endpoint for display screens to show game state"""
    game_code = game_code.upper()

    try:
        await websocket.accept()
        logger.info(f"Display WebSocket connection accepted for game {game_code}")

        # Get game room
        room = storage.get_room(game_code)
        if not room:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": "Game not found"
            }))
            return

        # Add display to room
        room.add_display(websocket)

        # Send initial state
        await websocket.send_text(json.dumps({
            "type": "display_connected",
            "success": True,
            "game_code": game_code,
            "teams": room.get_teams_list(),
            "total_teams": len(room.team_connections),
            "status": room.status,
            "team_scores": room.team_scores
        }))

        logger.info(f"Display successfully connected to game {game_code}")

        # Main message loop
        try:
            while True:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                message = json.loads(data)

                msg_type = message.get('type')

                if msg_type == 'ping':
                    await websocket.send_text(json.dumps({
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat()
                    }))

                elif msg_type == 'get_status':
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "teams": room.get_teams_list(),
                        "total_teams": len(room.team_connections),
                        "status": room.status,
                        "team_scores": room.team_scores,
                        "round_number": room.round_number
                    }))

        except asyncio.TimeoutError:
            logger.warning(f"Display connection timed out for game {game_code}")
        except WebSocketDisconnect:
            logger.info(f"Display disconnected from game {game_code}")

    except WebSocketDisconnect:
        logger.info(f"Display WebSocket disconnected from game {game_code}")
    except Exception as e:
        logger.error(f"Display WebSocket error: {e}")
    finally:
        # Cleanup
        room = storage.get_room(game_code)
        if room:
            room.remove_display(websocket)

if __name__ == "__main__":
    uvicorn.run(
        "main_simple:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8002)),
        reload=False
    )
