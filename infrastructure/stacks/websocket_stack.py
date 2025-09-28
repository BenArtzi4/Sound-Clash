"""
WebSocket Service Stack - ECS deployment configuration for WebSocket service
"""

from aws_cdk import (
    Stack,
    Duration,
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elbv2,
    aws_ecr as ecr,
    aws_iam as iam,
    CfnOutput
)
from constructs import Construct

class WebSocketServiceStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, 
                 vpc_stack, ecs_stack, alb_stack, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        self.vpc = vpc_stack.vpc
        self.cluster = ecs_stack.cluster
        self.alb = alb_stack.alb

        # Task execution role
        self.task_execution_role = iam.Role(
            self, "WebSocketTaskExecutionRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Task execution role for WebSocket Service",
        )

        self.task_execution_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "service-role/AmazonECSTaskExecutionRolePolicy"
            )
        )

        # Task role for runtime permissions
        self.task_role = iam.Role(
            self, "WebSocketTaskRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Task role for WebSocket Service runtime permissions",
        )

        # Add DynamoDB permissions
        self.task_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "AmazonDynamoDBFullAccess"
            )
        )

        # Use existing ECR Repository (referenced, not created)
        self.websocket_repository = ecr.Repository.from_repository_name(
            self, "WebSocketRepository",
            "sound-clash/websocket-service"
        )
        
        # Task Definition
        self.task_definition = ecs.Ec2TaskDefinition(
            self, "WebSocketTaskDef",
            family="websocket-service",
            execution_role=self.task_execution_role,
            task_role=self.task_role
        )
        
        # Container Definition - Use port 8002 to match ALB target group
        self.container = self.task_definition.add_container(
            "WebSocketContainer",
            image=ecs.ContainerImage.from_ecr_repository(self.websocket_repository),
            memory_limit_mib=512,
            cpu=256,
            essential=True,
            environment={
                "PORT": "8002",  # Changed to match ALB target group
                "AWS_REGION": self.region,
                "TEAM_CONNECTIONS_TABLE": "sound-clash-team-connections",
                "ACTIVE_GAMES_TABLE": "sound-clash-active-games"
            },
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="websocket-service"
            )
        )
        
        # Port mapping - Use port 8002 to match ALB target group
        self.container.add_port_mappings(
            ecs.PortMapping(
                container_port=8002,
                host_port=8002,
                protocol=ecs.Protocol.TCP
            )
        )
        
        # ECS Service
        self.service = ecs.Ec2Service(
            self, "WebSocketService",
            cluster=self.cluster,
            task_definition=self.task_definition,
            desired_count=1,
            service_name="websocket-service",
            health_check_grace_period=Duration.minutes(3)
        )
        
        # Use existing target group from ALB stack instead of creating new one
        self.service.attach_to_application_target_group(alb_stack.websocket_tg)
        
        # Outputs
        CfnOutput(
            self, "WebSocketServiceURL",
            value=f"ws://{alb_stack.alb.load_balancer_dns_name}/ws",
            description="WebSocket Service URL"
        )
        
        CfnOutput(
            self, "WebSocketHealthCheck",
            value=f"http://{alb_stack.alb.load_balancer_dns_name}/health",
            description="WebSocket Service Health Check"
        )
        
        CfnOutput(
            self, "WebSocketServiceNote",
            value="WebSocket service uses existing target group and listener rules from ALB stack",
            description="Deployment Configuration"
        )
