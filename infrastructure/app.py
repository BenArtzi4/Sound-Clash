#!/usr/bin/env python3
import aws_cdk as cdk
from stacks.vpc_stack import VpcStack
from stacks.database_stack import DatabaseStack
from stacks.ecs_stack import EcsStack
from stacks.alb_stack import AlbStack
from stacks.ecr_stack import EcrStack
from stacks.logging_stack import LoggingStack

app = cdk.App()

# Environment configuration
env = cdk.Environment(
    account=app.node.try_get_context("account"),
    region=app.node.try_get_context("region") or "us-east-1"
)

# ===== DEPLOY STACKS IN DEPENDENCY ORDER =====

# 1. Foundation: VPC and networking (no dependencies)
vpc_stack = VpcStack(app, "SoundClashVpcStack", env=env)

# 2. Data Layer: Databases (depends on VPC)
database_stack = DatabaseStack(app, "SoundClashDatabaseStack", vpc_stack=vpc_stack, env=env)

# 3. Container Infrastructure: Independent stacks
ecs_stack = EcsStack(app, "SoundClashEcsStack", vpc_stack=vpc_stack, env=env)
ecr_stack = EcrStack(app, "SoundClashEcrStack", env=env)
logging_stack = LoggingStack(app, "SoundClashLoggingStack", env=env)

# 4. Load Balancer: Routes traffic to containers (depends on VPC)
alb_stack = AlbStack(app, "SoundClashAlbStack", vpc_stack=vpc_stack, env=env)

app.synth()