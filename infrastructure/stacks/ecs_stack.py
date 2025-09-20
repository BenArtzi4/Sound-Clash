from aws_cdk import (
    Stack,
    aws_ecs as ecs,
    aws_ec2 as ec2,
    aws_iam as iam,
    aws_autoscaling as autoscaling,
    CfnOutput
)
from constructs import Construct

class EcsStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, vpc_stack, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        self.vpc = vpc_stack.vpc
        
        # ===== ECS CLUSTER =====
        
        self.cluster = ecs.Cluster(
            self, "SoundClashCluster",
            vpc=self.vpc,
            cluster_name="sound-clash-cluster"
        )
        
        # ===== IAM ROLES =====
        
        # Task execution role
        self.task_execution_role = iam.Role(
            self, "EcsTaskExecutionRole",
            assumed_by=iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AmazonECSTaskExecutionRolePolicy")
            ]
        )
        
        # EC2 instance role for ECS
        self.instance_role = iam.Role(
            self, "EcsInstanceRole",
            assumed_by=iam.ServicePrincipal("ec2.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AmazonEC2ContainerServiceforEC2Role")
            ]
        )
        
        # Instance profile for the role
        self.instance_profile = iam.InstanceProfile(
            self, "EcsInstanceProfile",
            role=self.instance_role
        )
        
        # ===== SECURITY GROUP =====
        
        self.instance_security_group = ec2.SecurityGroup(
            self, "EcsInstanceSecurityGroup",
            vpc=self.vpc,
            description="Security group for ECS instances",
            allow_all_outbound=True
        )
        
        # Allow ALB to reach ECS instances
        self.instance_security_group.add_ingress_rule(
            peer=vpc_stack.alb_sg,
            connection=ec2.Port.tcp_range(8000, 8004),
            description="Allow ALB to reach ECS services"
        )
        
        # ===== LAUNCH TEMPLATE =====
        
        # User data for ECS registration
        user_data = ec2.UserData.for_linux()
        user_data.add_commands(
            f"echo ECS_CLUSTER={self.cluster.cluster_name} >> /etc/ecs/ecs.config",
            "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config"
        )
        
        self.launch_template = ec2.LaunchTemplate(
            self, "EcsLaunchTemplate",
            instance_type=ec2.InstanceType("t3.micro"),
            machine_image=ecs.EcsOptimizedImage.amazon_linux2(),
            user_data=user_data,
            security_group=self.instance_security_group,
            role=self.instance_role  # This was missing - required for ECS
        )
        
        # ===== AUTO SCALING GROUP =====
        
        self.auto_scaling_group = autoscaling.AutoScalingGroup(
            self, "EcsAutoScalingGroup",
            vpc=self.vpc,
            launch_template=self.launch_template,
            min_capacity=1,
            max_capacity=5,
            desired_capacity=2,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            )
        )
        
        # ===== CAPACITY PROVIDER =====
        
        capacity_provider = ecs.AsgCapacityProvider(
            self, "AsgCapacityProvider",
            auto_scaling_group=self.auto_scaling_group,
            enable_managed_scaling=True,
            enable_managed_termination_protection=False
        )
        
        self.cluster.add_asg_capacity_provider(capacity_provider)
        
        # ===== OUTPUTS =====
        
        CfnOutput(
            self, "ClusterName",
            value=self.cluster.cluster_name,
            description="ECS Cluster name"
        )
        
        CfnOutput(
            self, "ClusterArn",
            value=self.cluster.cluster_arn,
            description="ECS Cluster ARN"
        )
        
        CfnOutput(
            self, "TaskExecutionRoleArn",
            value=self.task_execution_role.role_arn,
            description="ECS Task Execution Role ARN"
        )
        
        CfnOutput(
            self, "InstanceRoleArn",
            value=self.instance_role.role_arn,
            description="ECS Instance Role ARN"
        )