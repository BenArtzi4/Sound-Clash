"""
WebSocket Service - Complete Game State Integration
Handles waiting room, gameplay, rounds, buzzer, and scoring
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

# Import game state components
from models.game_state import GameState, RoundState
from services.song_selector import SongSelector
from services.round_manager import RoundManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize services
SONG_MANAGEMENT_URL = os.getenv(
    "SONG_MANAGEMENT_URL",
    "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com:8001"
)

song_selector = SongSelector(SONG_MANAGEMENT_URL)
round_manager = RoundManager(song_selector)

# WebSocket connection tracking
class ConnectionManager:
    def __init__(self):
        # team_connections[game_code][team_name] = websocket
        self.team_connections: Dict[str, Dict[str, WebSocket]] = {}
        # manager_connections[game_code] = [websockets]
        self.manager_connections: Dict[str, List[WebSocket]] = {}
    
    def connect_team(self, game_code: str, team_name: str, websocket: WebSocket):
        if game_code not in self.team_connections:
            self.team_connections[game_code] = {}
        self.team_connections[game_code][team_name] = websocket
    
    def disconnect_team(self, game_code: str, team_name: str):
        if game_code in self.team_connections:
            self.team_connections[game_code].pop(team_name, None)
    
    def connect_manager(self, game_code: str, websocket: WebSocket):
        if game_code not in self.manager_connections:
            self.manager_connections[game_code] = []
        self.manager_connections[game_code].append(websocket)
    
    def disconnect_manager(self, game_code: str, websocket: WebSocket):
        if game_code in self.manager_connections:
            try:
                self.manager_connections[game_code].remove(websocket)
            except ValueError:
                pass
    
    async def broadcast_to_teams(self, game_code: str, message: Dict[str, Any], exclude: Optional[str] = None):
        """Broadcast to all teams in a game"""
        if game_code not in self.team_connections:
            return
        
        disconnected = []
        for team_name, ws in self.team_connections[game_code].items():
            if team_name == exclude:
                continue
            try:
                await ws.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to send to team {team_name}: {e}")
                disconnected.append(team_name)
        
        for team_name in disconnected:
            self.disconnect_team(game_code, team_name)
    
    async def broadcast_to_managers(self, game_code: str, message: Dict[str, Any]):
        """Broadcast to all managers in a game"""
        if game_code not in self.manager_connections:
            return
        
        disconnected = []
        for ws in self.manager_connections[game_code]:
            try:
                await ws.send_text(json.dumps(message))
            except Exception as e:
                logger.error(f"Failed to send to manager: {e}")
                disconnected.append(ws)
        
        for ws in disconnected:
            self.disconnect_manager(game_code, ws)
    
    async def broadcast_to_all(self, game_code: str, message: Dict[str, Any]):
        """Broadcast to everyone in a game"""
        await self.broadcast_to_teams(game_code, message)
        await self.broadcast_to_managers(game_code, message)
    
    def get_teams_list(self, game_code: str) -> List[str]:
        """Get list of team names"""
        if game_code not in self.team_connections:
            return []
        return list(self.team_connections[game_code].keys())

connection_manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown"""
    logger.info("Starting WebSocket Service with Game State Management...")
    logger.info(f"Song Management URL: {SONG_MANAGEMENT_URL}")
    await song_selector.init_session()
    yield
    logger.info("Shutting down...")
    await song_selector.close_session()

app = FastAPI(
    title="Sound Clash WebSocket Service - Complete",
    version="3.0.0",
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
    games = round_manager.games
    return {
        "service": "Sound Clash WebSocket Service - Complete",
        "version": "3.0.0",
        "status": "running",
        "features": [
            "Waiting room management",
            "Game state transitions",
            "Round management",
            "Buzzer system",
            "Answer submission",
            "Scoring and evaluation"
        ],
        "active_games": len(games),
        "games_by_state": {
            "waiting": sum(1 for g in games.values() if g.state == GameState.WAITING),
            "playing": sum(1 for g in games.values() if g.state == GameState.PLAYING),
            "finished": sum(1 for g in games.values() if g.state == GameState.FINISHED)
        }
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "websocket-service",
        "version": "3.0.0",
        "song_management_url": SONG_MANAGEMENT_URL
    }

@app.post("/api/game/{game_code}/notify")
async def notify_game_created(game_code: str, settings: Dict[str, Any]):
    """Notification when game is created"""
    try:
        game_code = game_code.upper()
        max_rounds = settings.get("max_rounds", 10)
        genres = settings.get("genres", [])
        
        game = round_manager.create_game(
            game_code=game_code,
            max_rounds=max_rounds,
            selected_genres=genres
        )
        
        return {
            "success": True,
            "game_code": game_code,
            "state": game.state,
            "max_rounds": max_rounds,
            "genres": genres
        }
    except Exception as e:
        logger.error(f"Error creating game: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/game/{game_code}/status")
async def get_game_status(game_code: str):
    """Get game status"""
    game_code = game_code.upper()
    game = round_manager.get_game(game_code)
    
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    
    teams = connection_manager.get_teams_list(game_code)
    
    current_round_data = None
    if game.rounds_history:
        current_round = game.rounds_history[-1]
        current_round_data = {
            "round_number": current_round.round_number,
            "state": current_round.state,
            "buzzer_winner": current_round.buzzer_winner
        }
    
    return {
        "game_code": game_code,
        "state": game.state,
        "current_round": game.current_round,
        "max_rounds": game.max_rounds,
        "teams": teams,
        "team_scores": game.team_scores,
        "current_round_data": current_round_data
    }

@app.post("/api/game/{game_code}/start")
async def start_game_endpoint(game_code: str):
    """Manager starts the game"""
    game_code = game_code.upper()
    game = await round_manager.start_game(game_code)
    
    if not game:
        raise HTTPException(status_code=404, detail="Game not found or already started")
    
    # Broadcast game started
    await connection_manager.broadcast_to_all(game_code, {
        "type": "game_started",
        "game_code": game_code,
        "max_rounds": game.max_rounds,
        "timestamp": datetime.now().isoformat()
    })
    
    return {
        "success": True,
        "game_code": game_code,
        "state": game.state
    }

@app.post("/api/game/{game_code}/round/start")
async def start_round_endpoint(game_code: str):
    """Manager starts next round"""
    game_code = game_code.upper()
    round_data = await round_manager.start_round(game_code)
    
    if not round_data:
        raise HTTPException(status_code=400, detail="Cannot start round")
    
    # Broadcast round started with song info
    await connection_manager.broadcast_to_all(game_code, {
        "type": "round_started",
        "round_number": round_data.round_number,
        "song": {
            "id": round_data.song.id,
            "title": round_data.song.title,
            "artist": round_data.song.artist,
            "youtube_id": round_data.song.youtube_id,
            "start_time": round_data.song_start_time
        },
        "timestamp": datetime.now().isoformat()
    })
    
    return {
        "success": True,
        "round_number": round_data.round_number,
        "song": {
            "title": round_data.song.title,
            "artist": round_data.song.artist,
            "youtube_id": round_data.song.youtube_id
        }
    }

@app.post("/api/game/{game_code}/buzzer")
async def buzzer_press_endpoint(game_code: str, team_name: str, reaction_time_ms: int):
    """Team presses buzzer"""
    game_code = game_code.upper()
    success = round_manager.register_buzzer_press(game_code, team_name, reaction_time_ms)
    
    if not success:
        return {
            "success": False,
            "message": "Buzzer already locked or round not active"
        }
    
    # Broadcast buzzer locked
    await connection_manager.broadcast_to_all(game_code, {
        "type": "buzzer_locked",
        "team_name": team_name,
        "reaction_time_ms": reaction_time_ms,
        "timestamp": datetime.now().isoformat()
    })
    
    return {
        "success": True,
        "team_name": team_name,
        "reaction_time_ms": reaction_time_ms
    }

@app.post("/api/game/{game_code}/answer")
async def submit_answer_endpoint(
    game_code: str,
    team_name: str,
    song_name: Optional[str] = None,
    artist_name: Optional[str] = None,
    movie_tv_name: Optional[str] = None
):
    """Team submits answer"""
    game_code = game_code.upper()
    success = round_manager.submit_answer(
        game_code, team_name, song_name, artist_name, movie_tv_name
    )
    
    if not success:
        return {"success": False, "message": "Cannot submit answer"}
    
    # Broadcast answer submitted
    await connection_manager.broadcast_to_managers(game_code, {
        "type": "answer_submitted",
        "team_name": team_name,
        "answer": {
            "song_name": song_name,
            "artist_name": artist_name,
            "movie_tv_name": movie_tv_name
        },
        "timestamp": datetime.now().isoformat()
    })
    
    return {"success": True}

@app.post("/api/game/{game_code}/evaluate")
async def evaluate_answer_endpoint(
    game_code: str,
    song_correct: bool,
    artist_correct: bool,
    movie_tv_correct: bool
):
    """Manager evaluates answer"""
    game_code = game_code.upper()
    score = round_manager.evaluate_answer(
        game_code, song_correct, artist_correct, movie_tv_correct
    )
    
    if not score:
        return {"success": False, "message": "Cannot evaluate"}
    
    game = round_manager.get_game(game_code)
    
    # Broadcast round completed with scores
    await connection_manager.broadcast_to_all(game_code, {
        "type": "round_completed",
        "team_name": score.team_name,
        "score": {
            "song_correct": score.song_correct,
            "artist_correct": score.artist_correct,
            "movie_tv_correct": score.movie_tv_correct,
            "points_earned": score.points_earned
        },
        "team_scores": game.team_scores,
        "timestamp": datetime.now().isoformat()
    })
    
    return {
        "success": True,
        "score": {
            "team_name": score.team_name,
            "points_earned": score.points_earned
        },
        "team_scores": game.team_scores
    }

@app.post("/api/game/{game_code}/timeout")
async def timeout_endpoint(game_code: str):
    """Handle round timeout"""
    game_code = game_code.upper()
    success = round_manager.handle_timeout(game_code)
    
    if not success:
        return {"success": False}
    
    game = round_manager.get_game(game_code)
    
    await connection_manager.broadcast_to_all(game_code, {
        "type": "round_timeout",
        "team_scores": game.team_scores,
        "timestamp": datetime.now().isoformat()
    })
    
    return {"success": True}

@app.post("/api/game/{game_code}/end")
async def end_game_endpoint(game_code: str):
    """Manager ends the game"""
    game_code = game_code.upper()
    result = round_manager.end_game(game_code)
    
    if not result:
        return {"success": False, "message": "Cannot end game"}
    
    # Broadcast game finished
    await connection_manager.broadcast_to_all(game_code, {
        "type": "game_finished",
        "winner": result["winner"],
        "scores": result["scores"],
        "total_rounds": result["total_rounds"],
        "timestamp": datetime.now().isoformat()
    })
    
    return result

@app.websocket("/ws/team/{game_code}")
async def team_websocket(websocket: WebSocket, game_code: str):
    """Team WebSocket connection"""
    game_code = game_code.upper()
    team_name = None
    
    try:
        await websocket.accept()
        
        # Wait for team join
        data = await websocket.receive_text()
        message = json.loads(data)
        
        if message.get("type") != "team_join":
            await websocket.send_text(json.dumps({"type": "error", "message": "Expected team_join"}))
            return
        
        team_name = message.get("team_name")
        if not team_name:
            await websocket.send_text(json.dumps({"type": "error", "message": "Team name required"}))
            return
        
        # Check if game exists
        game = round_manager.get_game(game_code)
        if not game:
            await websocket.send_text(json.dumps({"type": "error", "message": "Game not found"}))
            return
        
        # Connect team
        connection_manager.connect_team(game_code, team_name, websocket)
        
        # Initialize team score
        if team_name not in game.team_scores:
            game.team_scores[team_name] = 0
        
        # Send ack
        await websocket.send_text(json.dumps({
            "type": "connection_ack",
            "team_name": team_name,
            "game_code": game_code,
            "game_state": game.state
        }))
        
        # Broadcast team joined
        await connection_manager.broadcast_to_all(game_code, {
            "type": "team_joined",
            "team_name": team_name,
            "teams": connection_manager.get_teams_list(game_code)
        })
        
        # Message loop
        while True:
            data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            message = json.loads(data)
            
            if message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as e:
        logger.error(f"Team WebSocket error: {e}")
    finally:
        if team_name:
            connection_manager.disconnect_team(game_code, team_name)
            await connection_manager.broadcast_to_all(game_code, {
                "type": "team_left",
                "team_name": team_name,
                "teams": connection_manager.get_teams_list(game_code)
            })

@app.websocket("/ws/manager/{game_code}")
async def manager_websocket(websocket: WebSocket, game_code: str):
    """Manager WebSocket connection"""
    game_code = game_code.upper()
    
    try:
        await websocket.accept()
        
        game = round_manager.get_game(game_code)
        if not game:
            await websocket.send_text(json.dumps({"type": "error", "message": "Game not found"}))
            return
        
        connection_manager.connect_manager(game_code, websocket)
        
        await websocket.send_text(json.dumps({
            "type": "manager_connected",
            "game_code": game_code,
            "game_state": game.state,
            "teams": connection_manager.get_teams_list(game_code)
        }))
        
        # Message loop
        while True:
            data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
            message = json.loads(data)
            
            if message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception as e:
        logger.error(f"Manager WebSocket error: {e}")
    finally:
        connection_manager.disconnect_manager(game_code, websocket)

if __name__ == "__main__":
    uvicorn.run(
        "main_complete:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8002)),
        reload=False
    )
