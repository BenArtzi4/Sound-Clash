#!/usr/bin/env python3
import aws_cdk as cdk
from stacks.vpc_stack import VpcStack
from stacks.database_stack import DatabaseStack
from stacks.ecs_stack import EcsStack
from stacks.alb_stack import AlbStack
from stacks.ecr_stack import EcrStack
from stacks.logging_stack import LoggingStack
from stacks.frontend_stack import FrontendStack
from stacks.song_service_stack import SongServiceStack
from stacks.websocket_stack import WebSocketServiceStack

app = cdk.App()

# Environment configuration
env = cdk.Environment(
    account=app.node.try_get_context("account"),
    region=app.node.try_get_context("region") or "us-east-1"
)

# ===== DEPLOY STACKS IN CORRECT ORDER TO AVOID CONFLICTS =====

# 1. Foundational Layer: VPC and ECR (completely independent)
vpc_stack = VpcStack(app, "SoundClashVpcStack", env=env)
ecr_stack = EcrStack(app, "SoundClashEcrStack", env=env)

# 2. Infrastructure Layer: ECS and ALB (depends on VPC only)
ecs_stack = EcsStack(app, "SoundClashEcsStack", vpc_stack=vpc_stack, env=env)
alb_stack = AlbStack(app, "SoundClashAlbStack", vpc_stack=vpc_stack, env=env)

# 3. Data Layer: Databases (force deployment of new version)
# This creates new security groups and stops using VPC exports
database_stack = DatabaseStack(app, "SoundClashDatabaseStack", 
                              vpc_stack=vpc_stack, 
                              ecs_stack=ecs_stack,
                              env=env)

# 4. Application Layer: Services and Frontend (depend on previous layers)
song_service_stack = SongServiceStack(
    app, "SongServiceStack",
    vpc_stack=vpc_stack,
    ecs_stack=ecs_stack,
    alb_stack=alb_stack,
    database_stack=database_stack,
    env=env
)

websocket_service_stack = WebSocketServiceStack(
    app, "WebSocketServiceStack",
    vpc_stack=vpc_stack,
    ecs_stack=ecs_stack,
    alb_stack=alb_stack,
    env=env
)

# 5. Other independent stacks
frontend_stack = FrontendStack(app, "SoundClashFrontendStack", env=env)
logging_stack = LoggingStack(app, "SoundClashLoggingStack", env=env)

app.synth()
