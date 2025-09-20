from aws_cdk import (
    Stack,
    aws_elasticloadbalancingv2 as elbv2,
    aws_ec2 as ec2,
    CfnOutput,
    Duration
)
from constructs import Construct

class AlbStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, vpc_stack, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        self.vpc = vpc_stack.vpc
        
        # ===== APPLICATION LOAD BALANCER =====
        
        # Create Application Load Balancer
        self.alb = elbv2.ApplicationLoadBalancer(
            self, "SoundClashALB",
            vpc=self.vpc,
            internet_facing=True,
            load_balancer_name="sound-clash-alb",
            security_group=vpc_stack.alb_sg,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PUBLIC
            )
        )
        
        # ===== TARGET GROUPS FOR MICROSERVICES =====
        
        # Game Management Service Target Group (port 8000)
        self.game_management_tg = elbv2.ApplicationTargetGroup(
            self, "GameManagementTG",
            vpc=self.vpc,
            port=8000,
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_group_name="game-management-tg",
            health_check=elbv2.HealthCheck(
                enabled=True,
                healthy_http_codes="200",
                path="/health",
                protocol=elbv2.Protocol.HTTP,
                timeout=Duration.seconds(5),
                interval=Duration.seconds(30),
                healthy_threshold_count=2,
                unhealthy_threshold_count=3
            )
        )
        
        # Game API Service Target Group (port 8001)
        self.game_api_tg = elbv2.ApplicationTargetGroup(
            self, "GameApiTG",
            vpc=self.vpc,
            port=8001,
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_group_name="game-api-tg",
            health_check=elbv2.HealthCheck(
                enabled=True,
                healthy_http_codes="200",
                path="/health",
                protocol=elbv2.Protocol.HTTP,
                timeout=Duration.seconds(5),
                interval=Duration.seconds(30)
            )
        )
        
        # WebSocket Service Target Group (port 8002)
        self.websocket_tg = elbv2.ApplicationTargetGroup(
            self, "WebSocketTG",
            vpc=self.vpc,
            port=8002,
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_group_name="websocket-tg",
            health_check=elbv2.HealthCheck(
                enabled=True,
                healthy_http_codes="200",
                path="/health",
                protocol=elbv2.Protocol.HTTP,
                timeout=Duration.seconds(5),
                interval=Duration.seconds(30)
            ),
            stickiness_cookie_duration=Duration.hours(1)  # Sticky sessions for WebSocket
        )
        
        # Manager Console Target Group (port 8003)
        self.manager_console_tg = elbv2.ApplicationTargetGroup(
            self, "ManagerConsoleTG",
            vpc=self.vpc,
            port=8003,
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_group_name="manager-console-tg",
            health_check=elbv2.HealthCheck(
                enabled=True,
                healthy_http_codes="200",
                path="/health",
                protocol=elbv2.Protocol.HTTP,
                timeout=Duration.seconds(5),
                interval=Duration.seconds(30)
            )
        )
        
        # Public Display Target Group (port 8004)
        self.public_display_tg = elbv2.ApplicationTargetGroup(
            self, "PublicDisplayTG",
            vpc=self.vpc,
            port=8004,
            protocol=elbv2.ApplicationProtocol.HTTP,
            target_group_name="public-display-tg",
            health_check=elbv2.HealthCheck(
                enabled=True,
                healthy_http_codes="200",
                path="/health",
                protocol=elbv2.Protocol.HTTP,
                timeout=Duration.seconds(5),
                interval=Duration.seconds(30)
            )
        )
        
        # ===== HTTP LISTENER WITH ROUTING RULES =====
        
        # Create HTTP listener with default 404 response
        self.http_listener = self.alb.add_listener(
            "HttpListener",
            port=80,
            protocol=elbv2.ApplicationProtocol.HTTP,
            default_action=elbv2.ListenerAction.fixed_response(
                status_code=404,
                content_type="application/json",
                message_body='{"error": "Service not found"}'
            )
        )
        
        # ===== PATH-BASED ROUTING RULES =====
        
        # Route /api/games/* to Game Management Service
        elbv2.ApplicationListenerRule(
            self, "GameManagementRule",
            listener=self.http_listener,
            priority=100,
            conditions=[
                elbv2.ListenerCondition.path_patterns(["/api/games/*"])
            ],
            action=elbv2.ListenerAction.forward([self.game_management_tg])
        )
        
        # Route /api/gameplay/* to Game API Service  
        elbv2.ApplicationListenerRule(
            self, "GameApiRule",
            listener=self.http_listener,
            priority=200,
            conditions=[
                elbv2.ListenerCondition.path_patterns(["/api/gameplay/*"])
            ],
            action=elbv2.ListenerAction.forward([self.game_api_tg])
        )
        
        # Route WebSocket connections to WebSocket Service
        elbv2.ApplicationListenerRule(
            self, "WebSocketRule",
            listener=self.http_listener,
            priority=300,
            conditions=[
                elbv2.ListenerCondition.path_patterns(["/ws/*", "/socket.io/*"])
            ],
            action=elbv2.ListenerAction.forward([self.websocket_tg])
        )
        
        # Route /api/manager/* to Manager Console
        elbv2.ApplicationListenerRule(
            self, "ManagerConsoleRule",
            listener=self.http_listener,
            priority=400,
            conditions=[
                elbv2.ListenerCondition.path_patterns(["/api/manager/*"])
            ],
            action=elbv2.ListenerAction.forward([self.manager_console_tg])
        )
        
        # Route /api/display/* to Public Display
        elbv2.ApplicationListenerRule(
            self, "PublicDisplayRule",
            listener=self.http_listener,
            priority=500,
            conditions=[
                elbv2.ListenerCondition.path_patterns(["/api/display/*"])
            ],
            action=elbv2.ListenerAction.forward([self.public_display_tg])
        )
        
        # ===== OUTPUTS =====
        
        CfnOutput(
            self, "LoadBalancerDNS",
            value=self.alb.load_balancer_dns_name,
            description="Application Load Balancer DNS name"
        )
        
        CfnOutput(
            self, "LoadBalancerArn",
            value=self.alb.load_balancer_arn,
            description="Application Load Balancer ARN"
        )
        
        CfnOutput(
            self, "GameManagementTargetGroupArn",
            value=self.game_management_tg.target_group_arn,
            description="Game Management Target Group ARN"
        )
        
        CfnOutput(
            self, "GameApiTargetGroupArn",
            value=self.game_api_tg.target_group_arn,
            description="Game API Target Group ARN"
        )
        
        CfnOutput(
            self, "WebSocketTargetGroupArn",
            value=self.websocket_tg.target_group_arn,
            description="WebSocket Target Group ARN"
        )
        
        CfnOutput(
            self, "ManagerConsoleTargetGroupArn",
            value=self.manager_console_tg.target_group_arn,
            description="Manager Console Target Group ARN"
        )
        
        CfnOutput(
            self, "PublicDisplayTargetGroupArn",
            value=self.public_display_tg.target_group_arn,
            description="Public Display Target Group ARN"
        )