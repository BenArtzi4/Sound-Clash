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
        
        # Game Management Service Repository
        self.game_management_repo = ecr.Repository(
            self, "GameManagementRepo",
            repository_name="sound-clash/game-management",
            lifecycle_rules=[
                ecr.LifecycleRule(
                    max_image_count=10,  # Keep only 10 most recent images
                    rule_priority=1,
                    description="Keep only 10 recent images to save storage costs"
                )
            ]
        )
        
        # Game API Service Repository
        self.game_api_repo = ecr.Repository(
            self, "GameApiRepo", 
            repository_name="sound-clash/game-api",
            lifecycle_rules=[
                ecr.LifecycleRule(
                    max_image_count=10,
                    rule_priority=1,
                    description="Keep only 10 recent images to save storage costs"
                )
            ]
        )
        
        # WebSocket Service Repository
        self.websocket_repo = ecr.Repository(
            self, "WebSocketRepo",
            repository_name="sound-clash/websocket-service",
            lifecycle_rules=[
                ecr.LifecycleRule(
                    max_image_count=10,
                    rule_priority=1,
                    description="Keep only 10 recent images to save storage costs"
                )
            ]
        )
        
        # Manager Console Service Repository
        self.manager_console_repo = ecr.Repository(
            self, "ManagerConsoleRepo",
            repository_name="sound-clash/manager-console",
            lifecycle_rules=[
                ecr.LifecycleRule(
                    max_image_count=10,
                    rule_priority=1,
                    description="Keep only 10 recent images to save storage costs"
                )
            ]
        )
        
        # Public Display Service Repository
        self.public_display_repo = ecr.Repository(
            self, "PublicDisplayRepo",
            repository_name="sound-clash/public-display",
            lifecycle_rules=[
                ecr.LifecycleRule(
                    max_image_count=10,
                    rule_priority=1,
                    description="Keep only 10 recent images to save storage costs"
                )
            ]
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