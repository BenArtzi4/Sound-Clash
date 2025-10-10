"""
ECS deployment configuration for Song Management Service using EC2
"""

from aws_cdk import (
    Stack,
    Duration,
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elbv2,
    aws_ecr as ecr,
    aws_iam as iam,
    aws_ec2 as ec2,
    aws_logs as logs,
    CfnOutput
)
from constructs import Construct

class SongServiceStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, 
                 vpc_stack, ecs_stack, alb_stack, database_stack, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        self.vpc = vpc_stack.vpc
        self.cluster = ecs_stack.cluster
        self.alb = alb_stack.alb

        # CREATE THE TASK EXECUTION ROLE LOCALLY IN THIS STACK
        self.task_execution_role = iam.Role(
            self, "SongServiceTaskExecutionRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Task execution role for Song Service ECS containers",
        )

        # Add the standard AWS managed policy for ECS task execution
        self.task_execution_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "service-role/AmazonECSTaskExecutionRolePolicy"
            )
        )
        
        # Additional permissions for accessing Secrets Manager
        self.task_execution_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "SecretsManagerReadWrite"
            )
        )

        # CREATE TASK ROLE FOR RUNTIME PERMISSIONS
        self.task_role = iam.Role(
            self, "SongServiceTaskRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Task role for Song Service runtime permissions",
        )

        # Use ECR Repository from its name
        self.song_repository = ecr.Repository.from_repository_name(
            self, "SongServiceRepository",
            "sound-clash-song-management"
        )
        
        # Task Definition for Song Management Service using EC2
        self.task_definition = ecs.Ec2TaskDefinition(
            self, "SongServiceTaskDef",
            family="song-management",
            execution_role=self.task_execution_role,
            task_role=self.task_role
        )
        
        # Container Definition
        self.container = self.task_definition.add_container(
            "SongServiceContainer",
            # Use the ECR Repository for the image
            image=ecs.ContainerImage.from_ecr_repository(self.song_repository),
            memory_limit_mib=256,  # Reduced to fit available memory
            cpu=128,
            essential=True,
            environment={
                "PORT": "8001",
                "AWS_REGION": self.region,
                "POSTGRES_HOST": database_stack.postgres_instance.instance_endpoint.hostname,
                "POSTGRES_DB": "soundclash", 
                "POSTGRES_USER": "postgres",
                "POSTGRES_PORT": "5432"
            },
            secrets={
                "POSTGRES_PASSWORD": ecs.Secret.from_secrets_manager(
                    database_stack.db_secret,
                    field="password"
                )
            },
            # Logging
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="song-service"
            )
        )
        
        # Port mapping for EC2 with DYNAMIC port mapping (prevents conflicts)
        self.container.add_port_mappings(
            ecs.PortMapping(
                container_port=8001,
                host_port=0,  # Dynamic port assignment
                protocol=ecs.Protocol.TCP
            )
        )
        
        # Create dedicated target group with proper dynamic port configuration
        self.target_group = elbv2.ApplicationTargetGroup(
            self, "SongServiceTargetGroup",
            port=8001,
            protocol=elbv2.ApplicationProtocol.HTTP,
            vpc=self.vpc,
            target_type=elbv2.TargetType.INSTANCE,
            target_group_name="song-service-final-tg",
            deregistration_delay=Duration.seconds(30),
            health_check=elbv2.HealthCheck(
                enabled=True,
                healthy_http_codes="200",
                interval=Duration.seconds(30),
                path="/health",
                protocol=elbv2.Protocol.HTTP,
                port="traffic-port",  # Use actual dynamic port
                timeout=Duration.seconds(5),
                unhealthy_threshold_count=3,
                healthy_threshold_count=2
            )
        )
        
        # ECS EC2 Service
        self.service = ecs.Ec2Service(
            self, "SongService",
            cluster=self.cluster,
            task_definition=self.task_definition,
            desired_count=1,
            service_name="song-management-service",
            health_check_grace_period=Duration.minutes(3)
        )
        
        # Attach service to our target group
        self.service.attach_to_application_target_group(self.target_group)
        
        # Create ALB listener rule at priority 155
        self.listener_rule = elbv2.ApplicationListenerRule(
            self, "SongServiceListenerRule",
            listener=alb_stack.http_listener,
            priority=155,
            conditions=[
                elbv2.ListenerCondition.path_patterns(["/api/songs/*"])
            ],
            action=elbv2.ListenerAction.forward([self.target_group])
        )
        
        # Auto Scaling configuration
        scaling = self.service.auto_scale_task_count(
            min_capacity=1,
            max_capacity=3
        )
        
        scaling.scale_on_cpu_utilization(
            "SongServiceCpuScaling",
            target_utilization_percent=70,
            scale_in_cooldown=Duration.minutes(5),
            scale_out_cooldown=Duration.minutes(2)
        )
        
        # Outputs
        CfnOutput(
            self, "SongServiceURL",
            value=f"http://{alb_stack.alb.load_balancer_dns_name}/api/songs",
            description="Song Management Service URL"
        )
        
        CfnOutput(
            self, "SongServiceHealthCheck",
            value=f"http://{alb_stack.alb.load_balancer_dns_name}/health",
            description="Song Service Health Check URL"
        )
