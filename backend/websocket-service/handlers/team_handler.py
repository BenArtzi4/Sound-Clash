"""
Team handler for managing team join/leave operations and business logic
"""
import logging
from typing import Optional, List
from datetime import datetime, timezone

from models.team_models import (
    TeamModel, TeamConnection, GameRoom, WebSocketMessage, MessageType,
    TeamJoinRequest, TeamJoinResponse, ErrorResponse, ConnectionStatus, GameState
)
from services.dynamodb_service import dynamodb_service
from handlers.connection_manager import connection_manager

logger = logging.getLogger(__name__)

class TeamHandler:
    def __init__(self):
        self.max_team_name_length = 50
        self.max_teams_per_game = 8
        
    def validate_team_name(self, team_name: str) -> Optional[str]:
        """Validate team name and return error message if invalid"""
        if not team_name or not team_name.strip():
            return "Team name cannot be empty"
        
        if len(team_name.strip()) > self.max_team_name_length:
            return f"Team name cannot exceed {self.max_team_name_length} characters"
        
        # Allow Unicode but prevent some problematic characters
        forbidden_chars = ['<', '>', '"', "'", '&', '\n', '\r', '\t']
        if any(char in team_name for char in forbidden_chars):
            return "Team name contains forbidden characters"
        
        return None

    def validate_game_code(self, game_code: str) -> Optional[str]:
        """Validate game code format"""
        if not game_code or len(game_code) != 6:
            return "Game code must be exactly 6 characters"
        
        if not game_code.isalnum():
            return "Game code must contain only letters and numbers"
        
        return None

    async def handle_team_join(self, join_request: TeamJoinRequest, connection_id: str) -> TeamJoinResponse:
        """Handle team joining a game room"""
        try:
            # Validate input
            team_name = join_request.team_name.strip()
            game_code = join_request.game_code.upper()
            
            name_error = self.validate_team_name(team_name)
            if name_error:
                return TeamJoinResponse(success=False, message=name_error)
            
            code_error = self.validate_game_code(game_code)
            if code_error:
                return TeamJoinResponse(success=False, message=code_error)
            
            # Check if team name already exists in this game
            existing_teams = connection_manager.get_teams_in_game(game_code)
            if team_name in existing_teams:
                return TeamJoinResponse(
                    success=False, 
                    message=f"Team name '{team_name}' is already taken in this game"
                )
            
            # Check team limit
            if len(existing_teams) >= self.max_teams_per_game:
                return TeamJoinResponse(
                    success=False,
                    message=f"Game is full (maximum {self.max_teams_per_game} teams)"
                )
            
            # Get or create game room
            game_room = await dynamodb_service.get_game_room(game_code)
            if not game_room:
                game_room = GameRoom(
                    game_code=game_code,
                    teams=[],
                    game_state=GameState.WAITING,
                    max_teams=self.max_teams_per_game
                )
            
            # Check if game is already in progress
            if game_room.game_state != GameState.WAITING:
                return TeamJoinResponse(
                    success=False,
                    message="Cannot join game - already in progress"
                )
            
            # Add team to game room
            if not game_room.add_team(team_name):
                return TeamJoinResponse(
                    success=False,
                    message="Failed to add team to game room"
                )
            
            # Save team connection to DynamoDB
            team_connection = TeamConnection(
                game_code=game_code,
                team_name=team_name,
                connection_id=connection_id,
                connection_status=ConnectionStatus.ACTIVE,
                last_seen=datetime.now(timezone.utc),
                ttl=0  # Will be set by DynamoDB service
            )
            
            await dynamodb_service.save_team_connection(team_connection)
            await dynamodb_service.save_game_room(game_room)
            
            # Broadcast team list update to all participants
            await self._broadcast_team_list_update(game_code, game_room.teams)
            
            # Notify manager if connected
            await self._notify_manager_team_joined(game_code, team_name, game_room.teams)
            
            logger.info(f"Team '{team_name}' successfully joined game {game_code}")
            
            return TeamJoinResponse(
                success=True,
                message=f"Successfully joined game as '{team_name}'",
                team_name=team_name,
                teams_in_room=game_room.teams,
                game_state=game_room.game_state
            )
            
        except Exception as e:
            logger.error(f"Error handling team join: {e}")
            return TeamJoinResponse(
                success=False,
                message="An error occurred while joining the game"
            )

    async def handle_team_leave(self, game_code: str, team_name: str) -> bool:
        """Handle team leaving a game room"""
        try:
            # Remove from connection manager (already done by disconnect)
            # Remove from DynamoDB
            await dynamodb_service.remove_team_connection(game_code, team_name)
            
            # Update game room
            game_room = await dynamodb_service.get_game_room(game_code)
            if game_room:
                game_room.remove_team(team_name)
                await dynamodb_service.save_game_room(game_room)
                
                # Broadcast updated team list
                await self._broadcast_team_list_update(game_code, game_room.teams)
                
                # Notify manager
                await self._notify_manager_team_left(game_code, team_name, game_room.teams)
            
            logger.info(f"Team '{team_name}' left game {game_code}")
            return True
            
        except Exception as e:
            logger.error(f"Error handling team leave: {e}")
            return False

    async def handle_team_reconnection(self, game_code: str, team_name: str, new_connection_id: str) -> bool:
        """Handle team reconnection to existing game"""
        try:
            # Update connection status in DynamoDB
            await dynamodb_service.update_team_status(game_code, team_name, ConnectionStatus.ACTIVE)
            
            # Get current game state
            game_room = await dynamodb_service.get_game_room(game_code)
            if not game_room:
                return False
            
            # Send current game state to reconnected team
            reconnection_message = WebSocketMessage(
                type=MessageType.RECONNECTION,
                data={
                    "teams_in_room": game_room.teams,
                    "game_state": game_room.game_state.value,
                    "your_team_name": team_name
                }
            )
            
            await connection_manager.send_personal_message(reconnection_message, new_connection_id)
            
            # Notify others about reconnection
            await self._notify_team_reconnected(game_code, team_name)
            
            logger.info(f"Team '{team_name}' reconnected to game {game_code}")
            return True
            
        except Exception as e:
            logger.error(f"Error handling team reconnection: {e}")
            return False

    async def handle_manager_kick_team(self, game_code: str, team_name: str) -> bool:
        """Handle manager kicking a team from the game"""
        try:
            # Check if team exists in game
            if not connection_manager.is_team_connected(game_code, team_name):
                logger.warning(f"Attempted to kick non-existent team: {team_name}")
                return False
            
            # Send kick notification to team
            kick_message = WebSocketMessage(
                type=MessageType.ERROR,
                data={
                    "error": "kicked",
                    "message": "You have been removed from the game by the manager",
                    "code": "TEAM_KICKED"
                }
            )
            
            await connection_manager.send_to_team(kick_message, game_code, team_name)
            
            # Remove team (this will trigger normal leave process)
            await self.handle_team_leave(game_code, team_name)
            
            logger.info(f"Manager kicked team '{team_name}' from game {game_code}")
            return True
            
        except Exception as e:
            logger.error(f"Error kicking team: {e}")
            return False

    async def get_game_status(self, game_code: str) -> Optional[dict]:
        """Get current status of a game room"""
        try:
            game_room = await dynamodb_service.get_game_room(game_code)
            if not game_room:
                return None
            
            connected_teams = connection_manager.get_teams_in_game(game_code)
            
            return {
                "game_code": game_code,
                "teams": game_room.teams,
                "connected_teams": connected_teams,
                "game_state": game_room.game_state.value,
                "max_teams": game_room.max_teams,
                "team_count": len(game_room.teams),
                "connection_count": connection_manager.get_connection_count(game_code),
                "manager_connected": connection_manager.is_manager_connected(game_code)
            }
            
        except Exception as e:
            logger.error(f"Error getting game status: {e}")
            return None

    # Private helper methods
    async def _broadcast_team_list_update(self, game_code: str, teams: List[str]):
        """Broadcast updated team list to all participants"""
        update_message = WebSocketMessage(
            type=MessageType.TEAM_LIST_UPDATE,
            data={
                "teams": teams,
                "team_count": len(teams)
            }
        )
        
        await connection_manager.broadcast_to_game(update_message, game_code)

    async def _notify_manager_team_joined(self, game_code: str, team_name: str, all_teams: List[str]):
        """Notify manager about new team joining"""
        if connection_manager.is_manager_connected(game_code):
            manager_message = WebSocketMessage(
                type=MessageType.TEAM_JOIN,
                data={
                    "team_name": team_name,
                    "teams": all_teams,
                    "team_count": len(all_teams)
                }
            )
            
            await connection_manager.send_to_manager(manager_message, game_code)

    async def _notify_manager_team_left(self, game_code: str, team_name: str, remaining_teams: List[str]):
        """Notify manager about team leaving"""
        if connection_manager.is_manager_connected(game_code):
            manager_message = WebSocketMessage(
                type=MessageType.TEAM_LEAVE,
                data={
                    "team_name": team_name,
                    "teams": remaining_teams,
                    "team_count": len(remaining_teams)
                }
            )
            
            await connection_manager.send_to_manager(manager_message, game_code)

    async def _notify_team_reconnected(self, game_code: str, team_name: str):
        """Notify all participants about team reconnection"""
        reconnect_message = WebSocketMessage(
            type=MessageType.RECONNECTION,
            data={
                "team_name": team_name,
                "message": f"Team '{team_name}' has reconnected"
            }
        )
        
        await connection_manager.broadcast_to_game(reconnect_message, game_code)

# Global team handler instance
team_handler = TeamHandler()
