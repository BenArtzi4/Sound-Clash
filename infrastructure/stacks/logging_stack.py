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
        # Import existing log groups instead of creating new ones
        
        # Game Management Service Logs
        self.game_management_logs = logs.LogGroup.from_log_group_name(
            self, "GameManagementLogs",
            log_group_name="/ecs/sound-clash/game-management"
        )
        
        # Game API Service Logs
        self.game_api_logs = logs.LogGroup.from_log_group_name(
            self, "GameApiLogs",
            log_group_name="/ecs/sound-clash/game-api"
        )
        
        # WebSocket Service Logs

        self.websocket_logs = logs.LogGroup.from_log_group_name(
            self, "WebSocketLogs",
            log_group_name="/ecs/sound-clash/websocket"
        )
        
        # Manager Console Service Logs
        self.manager_console_logs = logs.LogGroup.from_log_group_name(
            self, "ManagerConsoleLogs",
            log_group_name="/ecs/sound-clash/manager-console"
        )
        
        # Public Display Service Logs
        self.public_display_logs = logs.LogGroup.from_log_group_name(
            self, "PublicDisplayLogs",
            log_group_name="/ecs/sound-clash/public-display"
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
