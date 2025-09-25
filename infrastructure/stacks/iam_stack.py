from aws_cdk import (
    Stack,
    aws_iam as iam
)
from constructs import Construct

class IamStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # Create the ECS Task Execution Role
        # This role is used by the ECS container agent to pull images and write logs
        # It's completely independent and doesn't reference any other stack resources
        self.task_execution_role = iam.Role(
            self, "EcsTaskExecutionRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            description="Task execution role for ECS containers",
            role_name="SoundClash-EcsTaskExecutionRole"
        )

        # Add the standard AWS managed policy for ECS task execution
        # This provides permissions for ECR pulls and CloudWatch Logs writes
        self.task_execution_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "service-role/AmazonECSTaskExecutionRolePolicy"
            )
        )
        
        # Additional permissions for accessing Secrets Manager
        # (needed for database passwords)
        self.task_execution_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "SecretsManagerReadWrite"
            )
        )
