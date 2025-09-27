from aws_cdk import (
    Stack,
    aws_ec2 as ec2,
    CfnOutput
)
from constructs import Construct

class VpcStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        # VPC with 3 AZs for high availability
        self.vpc = ec2.Vpc(
            self, "SoundClashVpc",
            cidr="10.0.0.0/16",
            max_azs=3,
            subnet_configuration=[
                # Public subnets for ALB (internet-facing)
                ec2.SubnetConfiguration(
                    name="Public",
                    subnet_type=ec2.SubnetType.PUBLIC,
                    cidr_mask=24
                ),
                # Private subnets for ECS tasks (with internet via NAT)
                ec2.SubnetConfiguration(
                    name="Private",
                    subnet_type=ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidr_mask=24
                ),
                # Isolated subnets for databases (no internet)
                ec2.SubnetConfiguration(
                    name="Database",
                    subnet_type=ec2.SubnetType.PRIVATE_ISOLATED,
                    cidr_mask=24
                )
            ],
            # Cost optimization: Single NAT Gateway ($45/month)
            nat_gateways=1
        )
        
        # Application Load Balancer Security Group
        self.alb_sg = ec2.SecurityGroup(
            self, "AlbSecurityGroup",
            vpc=self.vpc,
            description="Security group for ALB - internet access",
            allow_all_outbound=True
        )
        
        # Allow HTTP traffic from internet
        self.alb_sg.add_ingress_rule(
            ec2.Peer.any_ipv4(),
            ec2.Port.tcp(80),
            "HTTP access from internet"
        )
        
        # Allow HTTPS traffic from internet
        self.alb_sg.add_ingress_rule(
            ec2.Peer.any_ipv4(),
            ec2.Port.tcp(443),
            "HTTPS access from internet"
        )
        
        # Outputs for other stacks to use
        CfnOutput(
            self, "VpcId",
            value=self.vpc.vpc_id,
            description="VPC ID"
        )
        
        CfnOutput(
            self, "VpcCidr",
            value=self.vpc.vpc_cidr_block,
            description="VPC CIDR block"
        )
