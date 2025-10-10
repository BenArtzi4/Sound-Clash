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
    """
    CDK Stack for the ECS Cluster with EC2 capacity using explicit Launch Template.
    """
    def __init__(self, scope: Construct, construct_id: str, vpc_stack, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        self.vpc = vpc_stack.vpc

        # Create the ECS Cluster
        self.cluster = ecs.Cluster(
            self, "SoundClashCluster",
            vpc=self.vpc,
            cluster_name="sound-clash-cluster",
            container_insights=True
        )

        # Create IAM role for ECS instances
        ecs_instance_role = iam.Role(
            self, "EcsInstanceRole",
            assumed_by=iam.ServicePrincipal("ec2.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AmazonEC2ContainerServiceforEC2Role"
                )
            ]
        )

        # Create security group for ECS instances
        self.ecs_sg = ec2.SecurityGroup(
            self, "EcsInstanceSecurityGroup",
            vpc=self.vpc,
            description="Security group for ECS instances",
            allow_all_outbound=True
        )

        # Allow ALB to reach ECS instances on dynamic ports (for dynamic port mapping)
        self.ecs_sg.add_ingress_rule(
            vpc_stack.alb_sg,
            ec2.Port.tcp_range(32768, 65535),
            "Allow ALB to reach ECS services on dynamic ports"
        )

        # Create user data script
        user_data = ec2.UserData.for_linux()
        user_data.add_commands(
            "#!/bin/bash",
            f"echo ECS_CLUSTER={self.cluster.cluster_name} >> /etc/ecs/ecs.config",
            "echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config"
        )

        # Create Launch Template using the high-level construct but with explicit configuration
        launch_template = ec2.LaunchTemplate(
            self, "EcsLaunchTemplate",
            instance_type=ec2.InstanceType("t3.small"),
            machine_image=ecs.EcsOptimizedImage.amazon_linux2(),
            role=ecs_instance_role,
            security_group=self.ecs_sg,
            user_data=user_data
        )

        # Create Auto Scaling Group with Launch Template (not Launch Configuration)
        asg = autoscaling.AutoScalingGroup(
            self, "EcsAutoScalingGroup",
            vpc=self.vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            launch_template=launch_template,  # This should use Launch Template
            min_capacity=1,
            max_capacity=5,
            desired_capacity=2
        )

        # Add the Auto Scaling Group to the ECS cluster using the proper CDK method
        # This registers the capacity with the cluster in a way CDK recognizes
        capacity_provider = ecs.AsgCapacityProvider(
            self, "EcsCapacityProvider",
            auto_scaling_group=asg,
            enable_managed_scaling=True,
            enable_managed_termination_protection=False
        )
        
        # Add capacity provider to cluster
        self.cluster.add_asg_capacity_provider(capacity_provider)

        # Output the cluster name and security group for other stacks
        CfnOutput(
            self, "EcsClusterName",
            value=self.cluster.cluster_name,
            description="The name of the ECS cluster"
        )
        
        CfnOutput(
            self, "EcsSecurityGroupId",
            value=self.ecs_sg.security_group_id,
            description="Security group ID for ECS instances"
        )
