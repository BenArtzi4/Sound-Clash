"""
Game management API endpoints
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, Any
from models.game import (
    CreateGameRequest, GameResponse, GameStatusResponse, 
    ErrorResponse, GameStatus
)
from models.team import (
    JoinGameRequest, RejoinGameRequest, TeamResponse, 
    WaitingRoomResponse
)
from services.game_service import game_service
from database.postgres import get_db
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/api/games", tags=["games"])

@router.post("/", response_model=GameResponse)
async def create_game(
    request: CreateGameRequest,
    db: AsyncSession = Depends(get_db)
):
    """Create a new game"""
    try:
        game_data = await game_service.create_game(request)
        return GameResponse(**game_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{game_code}", response_model=GameResponse)
async def get_game(game_code: str):
    """Get game details by code"""
    try:
        game_code = game_code.upper()
        game_data = await game_service.get_game(game_code)
        
        if not game_data:
            raise HTTPException(status_code=404, detail="Game not found")
        
        return GameResponse(**game_data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{game_code}/status", response_model=GameStatusResponse)
async def get_game_status(game_code: str):
    """Get basic game status"""
    try:
        game_code = game_code.upper()
        game_data = await game_service.get_game(game_code)
        
        if not game_data:
            return GameStatusResponse(
                game_code=game_code,
                status=GameStatus.ENDED,
                team_count=0,
                exists=False
            )
        
        return GameStatusResponse(
            game_code=game_code,
            status=game_data.get('status', 'waiting'),
            team_count=len(game_data.get('teams', [])),
            exists=True
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{game_code}/join", response_model=TeamResponse)
async def join_game(game_code: str, request: JoinGameRequest):
    """Team joins a game"""
    try:
        game_code = game_code.upper()
        team_data = await game_service.join_team(game_code, request)
        return TeamResponse(**team_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{game_code}/rejoin", response_model=TeamResponse)
async def rejoin_game(game_code: str, request: RejoinGameRequest):
    """Team reconnects to a game"""
    try:
        game_code = game_code.upper()
        # For now, use same logic as join - in future we'll add reconnection logic
        join_request = JoinGameRequest(team_name=request.team_name)
        team_data = await game_service.join_team(game_code, join_request)
        return TeamResponse(**team_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{game_code}/waiting-room", response_model=WaitingRoomResponse)
async def get_waiting_room(game_code: str):
    """Get waiting room status"""
    try:
        game_code = game_code.upper()
        waiting_room_data = await game_service.get_waiting_room(game_code)
        return WaitingRoomResponse(**waiting_room_data)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{game_code}")
async def delete_game(game_code: str):
    """Delete a game immediately"""
    try:
        game_code = game_code.upper()
        success = await game_service.delete_game(game_code)
        if success:
            return {"message": "Game deleted successfully", "game_code": game_code}
        else:
            raise HTTPException(status_code=500, detail="Failed to delete game")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))