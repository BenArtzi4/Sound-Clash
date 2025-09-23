"""
ECS deployment configuration for Song Management Service
"""

from aws_cdk import (
    Stack,
    aws_ecs as ecs,
    aws_ec2 as ec2,
    aws_elasticloadbalancingv2 as elbv2,
    aws_logs as logs,
    CfnOutput
)
from constructs import Construct

class SongServiceStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, 
                 vpc_stack, ecs_stack, alb_stack, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        self.vpc = vpc_stack.vpc
        self.cluster = ecs_stack.cluster
        self.alb = alb_stack.alb
        
        # CloudWatch Log Group for Song Service
        self.log_group = logs.LogGroup(
            self, "SongServiceLogGroup",
            log_group_name="/ecs/song-management",
            retention=logs.RetentionDays.ONE_WEEK  # Cost optimization
        )
        
        # Task Definition for Song Management Service
        self.task_definition = ecs.Ec2TaskDefinition(
            self, "SongServiceTaskDef",
            family="song-management"
        )
        
        # Container Definition
        self.container = self.task_definition.add_container(
            "SongServiceContainer",
            image=ecs.ContainerImage.from_registry(
                f"{self.account}.dkr.ecr.{self.region}.amazonaws.com/song-management:latest"
            ),
            memory_limit_mib=512,  # 512 MB memory
            cpu=256,  # 0.25 vCPU
            essential=True,
            environment={
                "PORT": "8001",
                "AWS_REGION": self.region
            },
            secrets={
                # Database credentials from Secrets Manager
                "POSTGRES_PASSWORD": ecs.Secret.from_secrets_manager(
                    alb_stack.database_stack.db_secret,
                    field="password"
                )
            },
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="song-service",
                log_group=self.log_group
            )
        )
        
        # Port mapping
        self.container.add_port_mappings(
            ecs.PortMapping(
                container_port=8001,
                host_port=8001,
                protocol=ecs.Protocol.TCP
            )
        )
        
        # ECS Service
        self.service = ecs.Ec2Service(
            self, "SongService",
            cluster=self.cluster,
            task_definition=self.task_definition,
            desired_count=1,  # Start with 1 instance
            service_name="song-management",
            enable_logging=True
        )
        
        # Auto Scaling configuration
        scaling = self.service.auto_scale_task_count(
            min_capacity=1,
            max_capacity=3  # Maximum 3 instances for cost control
        )
        
        # Scale based on CPU utilization
        scaling.scale_on_cpu_utilization(
            "SongServiceCpuScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.minutes(5),
            scale_out_cooldown=Duration.minutes(2)
        )
        
        # Application Load Balancer Target Group
        self.target_group = elbv2.ApplicationTargetGroup(
            self, "SongServiceTargetGroup",
            port=8001,
            protocol=elbv2.ApplicationProtocol.HTTP,
            vpc=self.vpc,
            target_type=elbv2.TargetType.INSTANCE,
            health_check=elbv2.HealthCheck(
                enabled=True,
                healthy_http_codes="200",
                interval=Duration.seconds(30),
                path="/health",
                protocol=elbv2.Protocol.HTTP,
                timeout=Duration.seconds(5),
                unhealthy_threshold_count=3
            )
        )
        
        # Register ECS service with target group
        self.service.register_load_balancer_targets(
            ecs.EcsTarget(
                container_name="SongServiceContainer",
                container_port=8001,
                new_target_group_id="ECS",
                listener_id="SongServiceListener",
                protocol=ecs.Protocol.TCP
            )
        )
        
        # ALB Listener Rule for Song Service
        self.listener_rule = elbv2.ApplicationListenerRule(
            self, "SongServiceListenerRule",
            listener=alb_stack.listener,
            priority=200,  # Higher priority than default
            conditions=[
                elbv2.ListenerCondition.path_patterns(["/api/songs/*"])
            ],
            action=elbv2.ListenerAction.forward([self.target_group])
        )
        
        # Outputs
        CfnOutput(
            self, "SongServiceURL",
            value=f"http://{alb_stack.alb.load_balancer_dns_name}/api/songs",
            description="Song Management Service URL"
        )
        
        CfnOutput(
            self, "SongServiceHealthCheck",
            value=f"http://{alb_stack.alb.load_balancer_dns_name}/api/songs/health",
            description="Song Service Health Check URL"
        )