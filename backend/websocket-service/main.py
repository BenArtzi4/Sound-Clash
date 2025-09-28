"""
WebSocket Service - Main FastAPI application with WebSocket endpoints
"""
import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from models.team_models import (
    WebSocketMessage, MessageType, TeamJoinRequest, ErrorResponse,
    GameRoom, GameState
)
from handlers.connection_manager import connection_manager
from handlers.team_handler import team_handler
from services.dynamodb_service import dynamodb_service

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Background task for cleanup
cleanup_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown"""
    global cleanup_task
    
    # Startup
    logger.info("Starting WebSocket Service...")
    await dynamodb_service.initialize()
    
    # Start background cleanup task
    cleanup_task = asyncio.create_task(background_cleanup())
    
    yield
    
    # Shutdown
    logger.info("Shutting down WebSocket Service...")
    if cleanup_task:
        cleanup_task.cancel()
        try:
            await cleanup_task
        except asyncio.CancelledError:
            pass
    
    await dynamodb_service.close()

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

async def background_cleanup():
    """Background task to clean up stale connections"""
    while True:
        try:
            await asyncio.sleep(300)  # Run every 5 minutes
            await connection_manager.cleanup_stale_connections()
            await dynamodb_service.cleanup_expired_connections()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error in background cleanup: {e}")

@app.get("/")
async def root():
    return {
        "service": "Sound Clash WebSocket Service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "team_websocket": "/ws/team/{game_code}",
            "manager_websocket": "/ws/manager/{game_code}",
            "game_status": "/api/game/{game_code}/status"
        }
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "websocket-service",
        "version": "1.0.0"
    }

@app.get("/api/game/{game_code}/status")
async def get_game_status(game_code: str):
    """Get current status of a game room"""
    status = await team_handler.get_game_status(game_code.upper())
    if not status:
        raise HTTPException(status_code=404, detail="Game not found")
    return status

@app.websocket("/ws/team/{game_code}")
async def websocket_team_endpoint(websocket: WebSocket, game_code: str):
    """WebSocket endpoint for teams to join games"""
    game_code = game_code.upper()
    connection_id = None
    team_name = None
    
    try:
        # Accept connection first
        await websocket.accept()
        logger.info(f"Team WebSocket connection accepted for game {game_code}")
        
        # Wait for team join message
        while True:
            try:
                data = await websocket.receive_text()
                message_data = json.loads(data)
                message = WebSocketMessage(**message_data)
                
                if message.type == MessageType.TEAM_JOIN:
                    # Handle team join
                    join_request = TeamJoinRequest(**message.data)
                    team_name = join_request.team_name.strip()
                    
                    # Connect team through connection manager
                    connection_id = await connection_manager.connect_team(
                        websocket, game_code, team_name
                    )
                    
                    # Process join request
                    join_response = await team_handler.handle_team_join(join_request, connection_id)
                    
                    # Send response
                    response_message = WebSocketMessage(
                        type=MessageType.CONNECTION_ACK,
                        data={
                            "join_response": join_response.model_dump(),
                            "connection_id": connection_id
                        }
                    )
                    
                    await websocket.send_text(response_message.model_dump_json())
                    
                    if not join_response.success:
                        # Close connection if join failed
                        await websocket.close(code=1000, reason=join_response.message)
                        return
                    
                    logger.info(f"Team '{team_name}' successfully joined game {game_code}")
                    break
                    
                else:
                    # Send error for unexpected message type
                    error_message = WebSocketMessage(
                        type=MessageType.ERROR,
                        data={
                            "error": "invalid_message",
                            "message": "Expected team_join message first"
                        }
                    )
                    await websocket.send_text(error_message.model_dump_json())
                    
            except json.JSONDecodeError:
                error_message = WebSocketMessage(
                    type=MessageType.ERROR,
                    data={
                        "error": "invalid_json",
                        "message": "Invalid JSON format"
                    }
                )
                await websocket.send_text(error_message.model_dump_json())
            except Exception as e:
                logger.error(f"Error processing team join: {e}")
                error_message = WebSocketMessage(
                    type=MessageType.ERROR,
                    data={
                        "error": "join_error",
                        "message": "Error joining game"
                    }
                )
                await websocket.send_text(error_message.model_dump_json())
        
        # Main message loop after successful join
        while True:
            try:
                data = await websocket.receive_text()
                message_data = json.loads(data)
                message = WebSocketMessage(**message_data)
                
                # Update connection ping
                await connection_manager.update_ping(connection_id)
                
                if message.type == MessageType.PING:
                    # Respond to ping
                    pong_message = WebSocketMessage(type=MessageType.PONG)
                    await websocket.send_text(pong_message.model_dump_json())
                    
                elif message.type == MessageType.TEAM_LEAVE:
                    # Handle voluntary leave
                    await team_handler.handle_team_leave(game_code, team_name)
                    break
                    
                else:
                    logger.warning(f"Unhandled message type: {message.type}")
                    
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON from team {team_name}")
            except Exception as e:
                logger.error(f"Error in team message loop: {e}")
                break
    
    except WebSocketDisconnect:
        logger.info(f"Team WebSocket disconnected: {team_name} from game {game_code}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Cleanup on disconnect
        if connection_id:
            await connection_manager.disconnect(connection_id)
        if team_name and game_code:
            await team_handler.handle_team_leave(game_code, team_name)

@app.websocket("/ws/manager/{game_code}")
async def websocket_manager_endpoint(websocket: WebSocket, game_code: str):
    """WebSocket endpoint for managers to monitor games"""
    game_code = game_code.upper()
    connection_id = None
    
    try:
        # Connect manager
        connection_id = await connection_manager.connect_manager(websocket, game_code)
        logger.info(f"Manager connected to game {game_code}")
        
        # Send initial game status
        game_status = await team_handler.get_game_status(game_code)
        if game_status:
            status_message = WebSocketMessage(
                type=MessageType.TEAM_LIST_UPDATE,
                data=game_status
            )
            await websocket.send_text(status_message.model_dump_json())
        
        # Manager message loop
        while True:
            try:
                data = await websocket.receive_text()
                message_data = json.loads(data)
                message = WebSocketMessage(**message_data)
                
                # Update connection ping
                await connection_manager.update_ping(connection_id)
                
                if message.type == MessageType.PING:
                    pong_message = WebSocketMessage(type=MessageType.PONG)
                    await websocket.send_text(pong_message.model_dump_json())
                
                elif message.type == MessageType.KICK_TEAM:
                    # Handle team kick
                    team_name = message.data.get("team_name")
                    if team_name:
                        success = await team_handler.handle_manager_kick_team(game_code, team_name)
                        
                        response_message = WebSocketMessage(
                            type=MessageType.KICK_TEAM,
                            data={
                                "success": success,
                                "team_name": team_name,
                                "message": f"Team '{team_name}' {'removed' if success else 'not found'}"
                            }
                        )
                        await websocket.send_text(response_message.model_dump_json())
                
                elif message.type == MessageType.GAME_START:
                    # Handle game start
                    await dynamodb_service.update_game_state(game_code, GameState.IN_PROGRESS)
                    
                    start_message = WebSocketMessage(
                        type=MessageType.GAME_START,
                        data={"message": "Game is starting!"}
                    )
                    await connection_manager.broadcast_to_teams_only(start_message, game_code)
                    
                    logger.info(f"Game {game_code} started by manager")
                
                else:
                    logger.warning(f"Unhandled manager message type: {message.type}")
                    
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON from manager")
            except Exception as e:
                logger.error(f"Error in manager message loop: {e}")
                break
    
    except WebSocketDisconnect:
        logger.info(f"Manager disconnected from game {game_code}")
    except Exception as e:
        logger.error(f"Manager WebSocket error: {e}")
    finally:
        # Cleanup on disconnect
        if connection_id:
            await connection_manager.disconnect(connection_id)

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8002)),  # Changed default to 8002
        reload=False
    )
