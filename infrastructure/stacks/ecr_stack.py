from aws_cdk import (
    Stack,
    aws_ecr as ecr,
    CfnOutput
)
from constructs import Construct

class EcrStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        # ===== ECR REPOSITORIES FOR MICROSERVICES =====
        # Use existing repositories by importing them by name
        
        # Game Management Service Repository
        self.game_management_repo = ecr.Repository.from_repository_name(
            self, "GameManagementRepo",
            repository_name="sound-clash/game-management"
        )
        
        # Game API Service Repository
        self.game_api_repo = ecr.Repository.from_repository_name(
            self, "GameApiRepo", 
            repository_name="sound-clash/game-api"
        )
        
        # WebSocket Service Repository
        self.websocket_repo = ecr.Repository.from_repository_name(
            self, "WebSocketRepo",
            repository_name="sound-clash/websocket-service"
        )
        
        # Manager Console Service Repository
        self.manager_console_repo = ecr.Repository.from_repository_name(
            self, "ManagerConsoleRepo",
            repository_name="sound-clash/manager-console"
        )
        
        # Public Display Service Repository
        self.public_display_repo = ecr.Repository.from_repository_name(
            self, "PublicDisplayRepo",
            repository_name="sound-clash/public-display"
        )
        
        # ===== OUTPUTS =====
        
        CfnOutput(
            self, "GameManagementRepoUri",
            value=self.game_management_repo.repository_uri,
            description="Game Management ECR repository URI"
        )
        
        CfnOutput(
            self, "GameApiRepoUri",
            value=self.game_api_repo.repository_uri,
            description="Game API ECR repository URI"
        )
        
        CfnOutput(
            self, "WebSocketRepoUri",
            value=self.websocket_repo.repository_uri,
            description="WebSocket ECR repository URI"
        )
        
        CfnOutput(
            self, "ManagerConsoleRepoUri",
            value=self.manager_console_repo.repository_uri,
            description="Manager Console ECR repository URI"
        )
        
        CfnOutput(
            self, "PublicDisplayRepoUri",
            value=self.public_display_repo.repository_uri,
            description="Public Display ECR repository URI"
        )
