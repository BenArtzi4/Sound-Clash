"""
Game Management Service ECS Stack
"""
from aws_cdk import (
    Stack,
    Duration,
    aws_ecs as ecs,
    aws_elasticloadbalancingv2 as elbv2,
    aws_iam as iam,
    aws_logs as logs,
    CfnOutput
)
from constructs import Construct

class GameManagementServiceStack(Stack):
    def __init__(
        self, scope: Construct, construct_id: str,
        vpc_stack,
        ecs_stack,
        alb_stack,
        database_stack,
        **kwargs
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        # Use existing resources from other stacks
        self.vpc = vpc_stack.vpc
        self.cluster = ecs_stack.cluster
        self.alb = alb_stack.alb

        # Task Execution Role
        self.task_execution_role = iam.Role(
            self, "GameManagementTaskExecutionRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Task execution role for Game Management Service ECS containers",
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AmazonECSTaskExecutionRolePolicy"),
                iam.ManagedPolicy.from_aws_managed_policy_name("SecretsManagerReadWrite")
            ]
        )

        # Task Role with permissions for database access
        self.task_role = iam.Role(
            self, "GameManagementTaskRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Task role for Game Management Service with database permissions",
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("AmazonRDSDataFullAccess"),
                iam.ManagedPolicy.from_aws_managed_policy_name("AmazonDynamoDBFullAccess")
            ]
        )

        # CloudWatch Log Group
        self.log_group = logs.LogGroup(
            self, "GameManagementLogGroup",
            log_group_name="/ecs/game-management",
            retention=logs.RetentionDays.ONE_WEEK
        )

        # Task Definition
        self.task_definition = ecs.TaskDefinition(
            self, "GameManagementTaskDef",
            family="game-management",
            compatibility=ecs.Compatibility.EC2,
            cpu="256",
            memory_mib="512",
            task_role=self.task_role,
            execution_role=self.task_execution_role
        )

        # Container Definition
        self.container = self.task_definition.add_container(
            "GameManagementContainer",
            image=ecs.ContainerImage.from_registry(
                f"{self.account}.dkr.ecr.{self.region}.amazonaws.com/sound-clash/game-management:latest"
            ),
            cpu=256,
            memory_limit_mib=512,
            environment={
                "PORT": "8000",  # Changed to match ALB target group port
                "AWS_REGION": self.region,
                "POSTGRES_HOST": database_stack.postgres_instance.instance_endpoint.hostname,
                "POSTGRES_DB": "soundclash",
                "POSTGRES_USER": "postgres",
                "POSTGRES_PORT": "5432",
                "DATABASE_INTEGRATION": "enabled"  # Force task definition update
            },
            secrets={
                "POSTGRES_PASSWORD": ecs.Secret.from_secrets_manager(
                    database_stack.db_secret,
                    field="password"
                )
            },
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="game-management",
                log_group=self.log_group
            ),
            port_mappings=[
                ecs.PortMapping(
                    container_port=8000,  # Changed to match ALB target group
                    host_port=8000,      # Changed to match ALB target group
                    protocol=ecs.Protocol.TCP
                )
            ]
        )

        # ECS Service - use the existing target group from ALB stack
        self.service = ecs.Ec2Service(
            self, "GameManagementService",
            cluster=self.cluster,
            task_definition=self.task_definition,
            service_name="game-management",
            desired_count=1,
            health_check_grace_period=Duration.seconds(180),
            max_healthy_percent=200,
            min_healthy_percent=50
        )

        # Attach the service to the existing target group from ALB stack
        self.service.attach_to_application_target_group(alb_stack.game_management_tg)

        # Output the service name
        CfnOutput(
            self, "GameManagementServiceName",
            value=self.service.service_name,
            description="Name of the Game Management ECS service"
        )
