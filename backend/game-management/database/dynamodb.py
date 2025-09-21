"""
DynamoDB client for ephemeral game data
"""

import boto3
import os
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import json

class DynamoDBManager:
    def __init__(self):
        # Use local endpoint for development
        endpoint_url = os.getenv('DYNAMODB_ENDPOINT')
        
        self.dynamodb = boto3.resource(
            'dynamodb',
            region_name=os.getenv('AWS_REGION', 'us-east-1'),
            endpoint_url=endpoint_url if endpoint_url else None,
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
        )
        
        self.active_games_table = os.getenv('ACTIVE_GAMES_TABLE', 'sound-clash-active-games')
        self.game_sessions_table = os.getenv('GAME_SESSIONS_TABLE', 'sound-clash-game-sessions')
    
    def _get_ttl(self, hours: int = 4) -> int:
        """Get TTL timestamp (4 hours from now)"""
        return int((datetime.utcnow() + timedelta(hours=hours)).timestamp())
    
    async def create_game(self, game_code: str, game_data: Dict[str, Any]) -> bool:
        """Create new game in DynamoDB"""
        try:
            table = self.dynamodb.Table(self.active_games_table)
            
            item = {
                'gameCode': game_code,
                'status': 'waiting',
                'teams': [],
                'settings': game_data.get('settings', {}),
                'created_at': datetime.utcnow().isoformat(),
                'ttl': self._get_ttl()
            }
            
            table.put_item(Item=item)
            return True
        except Exception as e:
            print(f"Error creating game in DynamoDB: {e}")
            return False
    
    async def get_game(self, game_code: str) -> Optional[Dict[str, Any]]:
        """Get game from DynamoDB"""
        try:
            table = self.dynamodb.Table(self.active_games_table)
            response = table.get_item(Key={'gameCode': game_code})
            return response.get('Item')
        except Exception as e:
            print(f"Error getting game from DynamoDB: {e}")
            return None
    
    async def update_game(self, game_code: str, updates: Dict[str, Any]) -> bool:
        """Update game in DynamoDB"""
        try:
            table = self.dynamodb.Table(self.active_games_table)
            
            # Build update expression
            update_expression = "SET "
            expression_values = {}
            
            for key, value in updates.items():
                update_expression += f"{key} = :{key}, "
                expression_values[f":{key}"] = value
            
            update_expression = update_expression.rstrip(", ")
            
            table.update_item(
                Key={'gameCode': game_code},
                UpdateExpression=update_expression,
                ExpressionAttributeValues=expression_values
            )
            return True
        except Exception as e:
            print(f"Error updating game in DynamoDB: {e}")
            return False

# Global DynamoDB manager instance
dynamodb_manager = DynamoDBManager()