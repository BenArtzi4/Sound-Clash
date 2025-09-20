from aws_cdk import (
    Stack,
    aws_logs as logs,
    CfnOutput
)
from constructs import Construct

class LoggingStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        # ===== CLOUDWATCH LOG GROUPS FOR MICROSERVICES =====
        
        # Game Management Service Logs
        self.game_management_logs = logs.LogGroup(
            self, "GameManagementLogs",
            log_group_name="/ecs/sound-clash/game-management",
            retention=logs.RetentionDays.ONE_WEEK
        )
        
        # Game API Service Logs
        self.game_api_logs = logs.LogGroup(
            self, "GameApiLogs",
            log_group_name="/ecs/sound-clash/game-api",
            retention=logs.RetentionDays.ONE_WEEK
        )
        
        # WebSocket Service Logs
        self.websocket_logs = logs.LogGroup(
            self, "WebSocketLogs",
            log_group_name="/ecs/sound-clash/websocket",
            retention=logs.RetentionDays.ONE_WEEK
        )
        
        # Manager Console Service Logs
        self.manager_console_logs = logs.LogGroup(
            self, "ManagerConsoleLogs",
            log_group_name="/ecs/sound-clash/manager-console",
            retention=logs.RetentionDays.ONE_WEEK
        )
        
        # Public Display Service Logs
        self.public_display_logs = logs.LogGroup(
            self, "PublicDisplayLogs",
            log_group_name="/ecs/sound-clash/public-display",
            retention=logs.RetentionDays.ONE_WEEK
        )
        
        # ===== OUTPUTS =====
        
        CfnOutput(
            self, "GameManagementLogGroup",
            value=self.game_management_logs.log_group_name,
            description="Game Management CloudWatch Log Group"
        )
        
        CfnOutput(
            self, "GameApiLogGroup",
            value=self.game_api_logs.log_group_name,
            description="Game API CloudWatch Log Group"
        )
        
        CfnOutput(
            self, "WebSocketLogGroup",
            value=self.websocket_logs.log_group_name,
            description="WebSocket CloudWatch Log Group"
        )
        
        CfnOutput(
            self, "ManagerConsoleLogGroup",
            value=self.manager_console_logs.log_group_name,
            description="Manager Console CloudWatch Log Group"
        )
        
        CfnOutput(
            self, "PublicDisplayLogGroup",
            value=self.public_display_logs.log_group_name,
            description="Public Display CloudWatch Log Group"
        )