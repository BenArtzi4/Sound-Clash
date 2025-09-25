from aws_cdk import (
    Stack,
    aws_ecs as ecs,
    aws_ec2 as ec2,
    aws_autoscaling as autoscaling,
    CfnOutput
)
from constructs import Construct

class EcsStack(Stack):
    """
    CDK Stack for the ECS Cluster with EC2 capacity using Launch Template.
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

        # Create Launch Template explicitly
        launch_template = ec2.LaunchTemplate(
            self, "EcsLaunchTemplate",
            instance_type=ec2.InstanceType("t3.micro"),
            machine_image=ecs.EcsOptimizedImage.amazon_linux2(),
            vpc=self.vpc,
            user_data=ec2.UserData.for_linux(),
            role=ec2.Role(
                self, "EcsInstanceRole",
                assumed_by=ec2.ServicePrincipal("ec2.amazonaws.com"),
                managed_policies=[
                    ec2.ManagedPolicy.from_aws_managed_policy_name(
                        "service-role/AmazonEC2ContainerServiceforEC2Role"
                    )
                ]
            )
        )

        # Add user data to join ECS cluster
        launch_template.add_user_data(
            f"echo ECS_CLUSTER={self.cluster.cluster_name} >> /etc/ecs/ecs.config"
        )

        # Create Auto Scaling Group with Launch Template
        auto_scaling_group = autoscaling.AutoScalingGroup(
            self, "DefaultAutoScalingGroup",
            vpc=self.vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS
            ),
            launch_template=launch_template,
            min_capacity=1,
            max_capacity=5,
            desired_capacity=2
        )

        # Add the Auto Scaling Group to the ECS cluster
        capacity_provider = ecs.AsgCapacityProvider(
            self, "AsgCapacityProvider",
            auto_scaling_group=auto_scaling_group
        )
        
        self.cluster.add_asg_capacity_provider(capacity_provider)

        # Output the cluster name, as it's a useful reference
        CfnOutput(
            self, "EcsClusterName",
            value=self.cluster.cluster_name,
            description="The name of the ECS cluster"
        )
