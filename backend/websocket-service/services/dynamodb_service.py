"""
DynamoDB service for persisting team connections and game state
"""
import asyncio
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import os

import aioboto3
from botocore.exceptions import ClientError

from models.team_models import (
    TeamConnection, GameRoom, ConnectionStatus, GameState
)

logger = logging.getLogger(__name__)

class DynamoDBService:
    def __init__(self):
        self.region = os.getenv("AWS_REGION", "us-east-1")
        self.team_connections_table = os.getenv("TEAM_CONNECTIONS_TABLE", "sound-clash-team-connections")
        self.active_games_table = os.getenv("ACTIVE_GAMES_TABLE", "sound-clash-active-games")
        
        # Session will be initialized async
        self.session = None
        self.dynamodb = None

    async def initialize(self):
        """Initialize async AWS session"""
        if not self.session:
            self.session = aioboto3.Session()
            self.dynamodb = await self.session.resource('dynamodb', region_name=self.region)

    async def close(self):
        """Close AWS session"""
        if self.dynamodb:
            await self.dynamodb.close()

    def _get_ttl(self, hours: int = 4) -> int:
        """Get TTL timestamp for DynamoDB (4 hours from now)"""
        return int((datetime.now(timezone.utc) + timedelta(hours=hours)).timestamp())

    async def save_team_connection(self, team_connection: TeamConnection) -> bool:
        """Save team connection to DynamoDB"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.team_connections_table)
            
            item = {
                'game_code': team_connection.game_code,
                'team_name': team_connection.team_name,
                'connection_id': team_connection.connection_id,
                'connection_status': team_connection.connection_status.value,
                'last_seen': team_connection.last_seen.isoformat(),
                'ttl': self._get_ttl()
            }
            
            await table.put_item(Item=item)
            logger.info(f"Saved team connection: {team_connection.team_name} in {team_connection.game_code}")
            return True
            
        except ClientError as e:
            logger.error(f"Failed to save team connection: {e}")
            return False

    async def get_team_connection(self, game_code: str, team_name: str) -> Optional[TeamConnection]:
        """Get team connection from DynamoDB"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.team_connections_table)
            
            response = await table.get_item(
                Key={
                    'game_code': game_code,
                    'team_name': team_name
                }
            )
            
            if 'Item' not in response:
                return None
            
            item = response['Item']
            return TeamConnection(
                game_code=item['game_code'],
                team_name=item['team_name'],
                connection_id=item['connection_id'],
                connection_status=ConnectionStatus(item['connection_status']),
                last_seen=datetime.fromisoformat(item['last_seen']),
                ttl=item['ttl']
            )
            
        except ClientError as e:
            logger.error(f"Failed to get team connection: {e}")
            return None

    async def update_team_status(self, game_code: str, team_name: str, status: ConnectionStatus) -> bool:
        """Update team connection status"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.team_connections_table)
            
            await table.update_item(
                Key={
                    'game_code': game_code,
                    'team_name': team_name
                },
                UpdateExpression='SET connection_status = :status, last_seen = :timestamp, ttl = :ttl',
                ExpressionAttributeValues={
                    ':status': status.value,
                    ':timestamp': datetime.now(timezone.utc).isoformat(),
                    ':ttl': self._get_ttl()
                }
            )
            return True
            
        except ClientError as e:
            logger.error(f"Failed to update team status: {e}")
            return False

    async def remove_team_connection(self, game_code: str, team_name: str) -> bool:
        """Remove team connection from DynamoDB"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.team_connections_table)
            
            await table.delete_item(
                Key={
                    'game_code': game_code,
                    'team_name': team_name
                }
            )
            logger.info(f"Removed team connection: {team_name} from {game_code}")
            return True
            
        except ClientError as e:
            logger.error(f"Failed to remove team connection: {e}")
            return False

    async def get_teams_in_game(self, game_code: str) -> List[str]:
        """Get all team names in a game"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.team_connections_table)
            
            response = await table.query(
                KeyConditionExpression='game_code = :game_code',
                ExpressionAttributeValues={
                    ':game_code': game_code
                }
            )
            
            teams = [item['team_name'] for item in response.get('Items', [])]
            return teams
            
        except ClientError as e:
            logger.error(f"Failed to get teams in game: {e}")
            return []

    async def save_game_room(self, game_room: GameRoom) -> bool:
        """Save game room state to DynamoDB"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.active_games_table)
            
            item = {
                'game_code': game_room.game_code,
                'teams': game_room.teams,
                'game_state': game_room.game_state.value,
                'max_teams': game_room.max_teams,
                'created_at': game_room.created_at.isoformat(),
                'manager_connected': game_room.manager_connected,
                'ttl': self._get_ttl()
            }
            
            await table.put_item(Item=item)
            logger.info(f"Saved game room: {game_room.game_code}")
            return True
            
        except ClientError as e:
            logger.error(f"Failed to save game room: {e}")
            return False

    async def get_game_room(self, game_code: str) -> Optional[GameRoom]:
        """Get game room from DynamoDB"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.active_games_table)
            
            response = await table.get_item(
                Key={'game_code': game_code}
            )
            
            if 'Item' not in response:
                return None
            
            item = response['Item']
            return GameRoom(
                game_code=item['game_code'],
                teams=item['teams'],
                game_state=GameState(item['game_state']),
                max_teams=item['max_teams'],
                created_at=datetime.fromisoformat(item['created_at']),
                manager_connected=item['manager_connected']
            )
            
        except ClientError as e:
            logger.error(f"Failed to get game room: {e}")
            return None

    async def update_game_state(self, game_code: str, game_state: GameState) -> bool:
        """Update game state"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.active_games_table)
            
            await table.update_item(
                Key={'game_code': game_code},
                UpdateExpression='SET game_state = :state, ttl = :ttl',
                ExpressionAttributeValues={
                    ':state': game_state.value,
                    ':ttl': self._get_ttl()
                }
            )
            return True
            
        except ClientError as e:
            logger.error(f"Failed to update game state: {e}")
            return False

    async def cleanup_expired_connections(self) -> int:
        """Remove expired connections (TTL should handle this, but manual cleanup for reliability)"""
        try:
            await self.initialize()
            table = await self.dynamodb.Table(self.team_connections_table)
            
            # Scan for expired items (TTL might have delays)
            current_timestamp = int(datetime.now(timezone.utc).timestamp())
            
            response = await table.scan(
                FilterExpression='#ttl < :current_time',
                ExpressionAttributeNames={'#ttl': 'ttl'},
                ExpressionAttributeValues={':current_time': current_timestamp}
            )
            
            items_deleted = 0
            for item in response.get('Items', []):
                await table.delete_item(
                    Key={
                        'game_code': item['game_code'],
                        'team_name': item['team_name']
                    }
                )
                items_deleted += 1
            
            if items_deleted > 0:
                logger.info(f"Cleaned up {items_deleted} expired team connections")
            
            return items_deleted
            
        except ClientError as e:
            logger.error(f"Failed to cleanup expired connections: {e}")
            return 0

# Global DynamoDB service instance
dynamodb_service = DynamoDBService()
