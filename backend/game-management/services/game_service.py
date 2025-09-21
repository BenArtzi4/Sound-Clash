"""
Game service - Core business logic for game management
"""

import random
import string
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from database.dynamodb import dynamodb_manager
from database.redis import redis_manager
from database.postgres import AsyncSessionLocal, GameHistory
from models.game import GameSettings, GameStatus, CreateGameRequest
from models.team import JoinGameRequest
import os

class GameService:
    def __init__(self):
        self.base_url = os.getenv('ALB_DNS_NAME', 'localhost:8000')
    
    def generate_game_code(self) -> str:
        """Generate unique 6-digit alphanumeric game code"""
        # Use uppercase letters and numbers, excluding similar looking characters
        chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        return ''.join(random.choices(chars, k=6))
    
    async def create_game(self, request: CreateGameRequest) -> Dict[str, Any]:
        """Create a new game"""
        # Generate unique game code
        game_code = self.generate_game_code()
        
        # Check if code already exists (very unlikely but safety first)
        existing_game = await dynamodb_manager.get_game(game_code)
        while existing_game:
            game_code = self.generate_game_code()
            existing_game = await dynamodb_manager.get_game(game_code)
        
        # Prepare game data
        game_data = {
            'settings': request.settings.dict(),
            'host_name': request.host_name
        }
        
        # Create game in DynamoDB
        success = await dynamodb_manager.create_game(game_code, game_data)
        if not success:
            raise Exception("Failed to create game in database")
        
        # Cache in Redis
        cache_data = {
            'game_code': game_code,
            'status': GameStatus.WAITING.value,
            'teams': [],
            'settings': request.settings.dict(),
            'created_at': datetime.utcnow().isoformat()
        }
        await redis_manager.set_game_cache(game_code, cache_data)
        
        # Create persistent record in PostgreSQL
        async with AsyncSessionLocal() as session:
            game_record = GameHistory(
                game_code=game_code,
                created_at=datetime.utcnow()
            )
            session.add(game_record)
            await session.commit()
        
        return {
            'game_code': game_code,
            'status': GameStatus.WAITING.value,
            'teams': [],
            'team_count': 0,
            'settings': request.settings.dict(),
            'created_at': datetime.utcnow(),
            'manager_url': f"http://{self.base_url}/manager/{game_code}",
            'public_display_url': f"http://{self.base_url}/display/{game_code}",
            'time_remaining_hours': 4.0
        }
    
    async def get_game(self, game_code: str) -> Optional[Dict[str, Any]]:
        """Get game by code"""
        # Try Redis cache first
        cached_game = await redis_manager.get_game_cache(game_code)
        if cached_game:
            return cached_game
        
        # Fall back to DynamoDB
        game_data = await dynamodb_manager.get_game(game_code)
        if not game_data:
            return None
        
        # Rebuild cache
        cache_data = {
            'game_code': game_code,
            'status': game_data.get('status', 'waiting'),
            'teams': game_data.get('teams', []),
            'settings': game_data.get('settings', {}),
            'created_at': game_data.get('created_at')
        }
        await redis_manager.set_game_cache(game_code, cache_data)
        
        return cache_data
    
    async def join_team(self, game_code: str, request: JoinGameRequest) -> Dict[str, Any]:
        """Add team to game"""
        # Get current game state
        game_data = await self.get_game(game_code)
        if not game_data:
            raise ValueError("Game not found")
        
        if game_data['status'] != GameStatus.WAITING.value:
            raise ValueError("Cannot join game that has already started")
        
        teams = game_data.get('teams', [])
        
        # Check if team name already exists
        existing_teams = [team['name'].lower() for team in teams]
        if request.team_name.lower() in existing_teams:
            raise ValueError("Team name already taken")
        
        # Check team limit
        max_teams = game_data.get('settings', {}).get('max_teams', 8)
        if len(teams) >= max_teams:
            raise ValueError(f"Game is full (max {max_teams} teams)")
        
        # Add team
        new_team = {
            'name': request.team_name,
            'joined_at': datetime.utcnow().isoformat(),
            'status': 'connected',
            'position': len(teams) + 1
        }
        teams.append(new_team)
        
        # Update in DynamoDB
        await dynamodb_manager.update_game(game_code, {'teams': teams})
        
        # Update cache
        game_data['teams'] = teams
        await redis_manager.set_game_cache(game_code, game_data)
        
        return {
            'team_name': request.team_name,
            'game_code': game_code,
            'position': new_team['position'],
            'status': 'connected',
            'joined_at': new_team['joined_at']
        }
    
    async def get_waiting_room(self, game_code: str) -> Dict[str, Any]:
        """Get waiting room status"""
        game_data = await self.get_game(game_code)
        if not game_data:
            raise ValueError("Game not found")
        
        teams = game_data.get('teams', [])
        settings = game_data.get('settings', {})
        
        return {
            'game_code': game_code,
            'status': game_data.get('status', 'waiting'),
            'teams': teams,
            'team_count': len(teams),
            'max_teams': settings.get('max_teams', 8),
            'can_start': len(teams) >= 2,  # Minimum teams to start
            'settings': settings
        }
    
    async def delete_game(self, game_code: str) -> bool:
        """Delete game immediately"""
        # Delete from cache
        await redis_manager.delete_game_cache(game_code)
        
        # Mark as ended in DynamoDB (TTL will clean up automatically)
        await dynamodb_manager.update_game(game_code, {
            'status': GameStatus.ENDED.value,
            'ended_at': datetime.utcnow().isoformat()
        })
        
        # Update PostgreSQL record
        async with AsyncSessionLocal() as session:
            result = await session.execute(
                "UPDATE game_history SET ended_at = :ended_at WHERE game_code = :game_code",
                {"ended_at": datetime.utcnow(), "game_code": game_code}
            )
            await session.commit()
        
        return True

# Global service instance
game_service = GameService()