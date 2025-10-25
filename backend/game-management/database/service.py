"""
Database service layer for Game Management
Phase 2: Basic CRUD operations - Fixed async handling
"""
import logging
from typing import List, Optional
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from database.config import get_db_session
from database.models import Game, Team

logger = logging.getLogger(__name__)

class GameService:
    """Service class for game-related database operations"""
    
    @staticmethod
    async def create_game(
        game_code: str,
        host_name: str,
        selected_genres: List[str],
        max_teams: int = 8,
        max_rounds: int = 20
    ) -> Optional[Game]:
        """Create a new game"""
        try:
            async with get_db_session() as session:
                game = Game(
                    game_code=game_code,
                    host_name=host_name,
                    selected_genres=selected_genres,
                    max_teams=max_teams,
                    max_rounds=max_rounds,
                    status="waiting"
                )
                session.add(game)
                await session.commit()
                await session.refresh(game)
                return game
        except Exception as e:
            logger.error(f"Error creating game: {e}")
            return None
    
    @staticmethod
    async def get_game_by_code(game_code: str) -> Optional[Game]:
        """Get game by game code"""
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    select(Game)
                    .options(selectinload(Game.teams))
                    .where(Game.game_code == game_code)
                )
                return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Error getting game by code: {e}")
            return None
    
    @staticmethod
    async def get_active_games() -> List[Game]:
        """Get all active games"""
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    select(Game)
                    .options(selectinload(Game.teams))
                    .where(Game.status.in_(["waiting", "in_progress"]))
                    .order_by(Game.created_at.desc())
                )
                return list(result.scalars().all())
        except Exception as e:
            logger.error(f"Error getting active games: {e}")
            return []
    
    @staticmethod
    async def add_team_to_game(game_code: str, team_name: str) -> Optional[Team]:
        """Add a team to a game"""
        try:
            async with get_db_session() as session:
                # Get the game
                game_result = await session.execute(
                    select(Game).where(Game.game_code == game_code)
                )
                game = game_result.scalar_one_or_none()
                
                if not game:
                    logger.error(f"Game {game_code} not found")
                    return None
                
                # Check if team name already exists in this game
                existing_team_result = await session.execute(
                    select(Team).where(
                        Team.game_id == game.id,
                        Team.team_name == team_name
                    )
                )
                if existing_team_result.scalar_one_or_none():
                    logger.error(f"Team {team_name} already exists in game {game_code}")
                    return None
                
                # Create the team
                team = Team(
                    game_id=game.id,
                    team_name=team_name
                )
                session.add(team)
                await session.commit()
                await session.refresh(team)
                return team
                
        except Exception as e:
            logger.error(f"Error adding team to game: {e}")
            return None
    
    @staticmethod
    async def get_game_stats() -> dict:
        """Get basic game statistics"""
        try:
            async with get_db_session() as session:
                # Count active games
                active_games_result = await session.execute(
                    select(func.count(Game.id)).where(
                        Game.status.in_(["waiting", "in_progress"])
                    )
                )
                active_games = active_games_result.scalar()
                
                # Count total games
                total_games_result = await session.execute(
                    select(func.count(Game.id))
                )
                total_games = total_games_result.scalar()
                
                return {
                    "active_games": active_games or 0,
                    "total_games": total_games or 0
                }
        except Exception as e:
            logger.error(f"Error getting game stats: {e}")
            return {"active_games": 0, "total_games": 0}
