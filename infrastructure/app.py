#!/usr/bin/env python3 
import aws_cdk as cdk 
from stacks.vpc_stack import VpcStack 
from stacks.database_stack import DatabaseStack 
 
app = cdk.App() 
 
# Environment configuration 
env = cdk.Environment( 
    account=app.node.try_get_context("account"), 
    region=app.node.try_get_context("region") || "us-east-1" 
) 
 
# Deploy stacks in dependency order 
vpc_stack = VpcStack(app, "SoundClashVpcStack", env=env) 
database_stack = DatabaseStack(app, "SoundClashDatabaseStack", vpc_stack=vpc_stack, env=env) 
 
app.synth() 
