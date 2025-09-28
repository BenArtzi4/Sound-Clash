"""
Pydantic models for team management and game state
"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime

class ConnectionStatus(str, Enum):
    ACTIVE = "active"
    DISCONNECTED = "disconnected"
    RECONNECTING = "reconnecting"

class GameState(str, Enum):
    WAITING = "waiting"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    PAUSED = "paused"

class TeamModel(BaseModel):
    team_name: str = Field(..., min_length=1, max_length=50)
    game_code: str = Field(..., min_length=6, max_length=6)
    connection_id: Optional[str] = None
    connection_status: ConnectionStatus = ConnectionStatus.DISCONNECTED
    joined_at: datetime = Field(default_factory=datetime.utcnow)
    last_seen: datetime = Field(default_factory=datetime.utcnow)

class TeamConnection(BaseModel):
    game_code: str
    team_name: str
    connection_id: str
    connection_status: ConnectionStatus
    last_seen: datetime
    ttl: int

class GameRoom(BaseModel):
    game_code: str
    teams: List[str] = Field(default_factory=list)
    game_state: GameState = GameState.WAITING
    max_teams: int = Field(default=8, ge=2, le=12)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    manager_connected: bool = False
    
    def add_team(self, team_name: str) -> bool:
        """Add team if not exists and under limit"""
        if team_name not in self.teams and len(self.teams) < self.max_teams:
            self.teams.append(team_name)
            return True
        return False
    
    def remove_team(self, team_name: str) -> bool:
        """Remove team if exists"""
        if team_name in self.teams:
            self.teams.remove(team_name)
            return True
        return False

# WebSocket Message Types
class MessageType(str, Enum):
    # Team Events
    TEAM_JOIN = "team_join"
    TEAM_LEAVE = "team_leave"
    TEAM_LIST_UPDATE = "team_list_update"
    
    # Connection Events
    CONNECTION_ACK = "connection_ack"
    RECONNECTION = "reconnection"
    PING = "ping"
    PONG = "pong"
    
    # Game Events
    GAME_START = "game_start"
    GAME_STATE_CHANGE = "game_state_change"
    
    # Manager Events
    MANAGER_CONNECT = "manager_connect"
    KICK_TEAM = "kick_team"
    
    # Error Events
    ERROR = "error"

class WebSocketMessage(BaseModel):
    type: MessageType
    data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
class TeamJoinRequest(BaseModel):
    team_name: str = Field(..., min_length=1, max_length=50)
    game_code: str = Field(..., min_length=6, max_length=6)

class TeamJoinResponse(BaseModel):
    success: bool
    message: str
    team_name: Optional[str] = None
    teams_in_room: List[str] = Field(default_factory=list)
    game_state: GameState = GameState.WAITING

class ErrorResponse(BaseModel):
    error: str
    message: str
    code: Optional[str] = None
