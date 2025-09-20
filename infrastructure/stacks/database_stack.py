from aws_cdk import (
    Stack,
    aws_dynamodb as dynamodb,
    aws_rds as rds,
    aws_elasticache as elasticache,
    aws_secretsmanager as secrets,
    aws_ec2 as ec2,
    RemovalPolicy,
    Duration,
    CfnOutput
)
from constructs import Construct

class DatabaseStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, vpc_stack, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        self.vpc = vpc_stack.vpc
        
        # ===== DYNAMODB TABLES (Ephemeral Data with TTL) =====
        
        # Active Games Table (4-hour TTL)
        self.active_games_table = dynamodb.Table(
            self, "ActiveGamesTable",
            table_name="sound-clash-active-games",
            partition_key=dynamodb.Attribute(
                name="gameCode",
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="ttl",
            removal_policy=RemovalPolicy.DESTROY  # For development
        )
        
        # Add GSI for status queries
        self.active_games_table.add_global_secondary_index(
            index_name="StatusIndex",
            partition_key=dynamodb.Attribute(
                name="game_status",
                type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="created_at",
                type=dynamodb.AttributeType.STRING
            )
        )
        
        # Game Sessions Table (Round data with TTL)
        self.game_sessions_table = dynamodb.Table(
            self, "GameSessionsTable",
            table_name="sound-clash-game-sessions",
            partition_key=dynamodb.Attribute(
                name="gameCode",
                type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="roundId",
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="ttl",
            removal_policy=RemovalPolicy.DESTROY
        )
        
        # Buzz Events Table (High-frequency writes)
        self.buzz_events_table = dynamodb.Table(
            self, "BuzzEventsTable",
            table_name="sound-clash-buzz-events",
            partition_key=dynamodb.Attribute(
                name="gameCodeRoundId",
                type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="timestamp",
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="ttl",
            removal_policy=RemovalPolicy.DESTROY
        )
        
        # Team Connections Table (WebSocket management)
        self.team_connections_table = dynamodb.Table(
            self, "TeamConnectionsTable",
            table_name="sound-clash-team-connections",
            partition_key=dynamodb.Attribute(
                name="gameCode",
                type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="teamName",
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            time_to_live_attribute="ttl",
            removal_policy=RemovalPolicy.DESTROY
        )
        
        # ===== RDS POSTGRESQL (Persistent Data) =====
        
        # Database credentials secret
        self.db_secret = secrets.Secret(
            self, "DatabaseSecret",
            description="RDS PostgreSQL credentials for Sound Clash",
            generate_secret_string=secrets.SecretStringGenerator(
                secret_string_template='{"username": "postgres"}',
                generate_string_key="password",
                exclude_characters='"@/\\',
                password_length=16
            )
        )
        
        # Database subnet group (isolated subnets)
        self.db_subnet_group = rds.SubnetGroup(
            self, "DatabaseSubnetGroup",
            description="Subnet group for Sound Clash RDS PostgreSQL",
            vpc=self.vpc,
            vpc_subnets=ec2.SubnetSelection(
                subnet_type=ec2.SubnetType.PRIVATE_ISOLATED
            )
        )
        
        # RDS PostgreSQL instance
        self.postgres_instance = rds.DatabaseInstance(
            self, "PostgresDatabase",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.VER_14
            ),
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.T4G,
                ec2.InstanceSize.MICRO  # Free tier eligible
            ),
            allocated_storage=20,  # Free tier: 20GB
            max_allocated_storage=100,  # Auto-scaling limit
            storage_type=rds.StorageType.GP3,
            database_name="soundclash",
            credentials=rds.Credentials.from_secret(self.db_secret),
            vpc=self.vpc,
            subnet_group=self.db_subnet_group,
            security_groups=[vpc_stack.rds_sg],
            multi_az=False,  # Single-AZ for development
            backup_retention=Duration.days(7),
            deletion_protection=False,  # Allow deletion for development
            removal_policy=RemovalPolicy.DESTROY
        )
        
        # ===== ELASTICACHE REDIS (Caching) =====
        
        # ElastiCache subnet group
        self.cache_subnet_group = elasticache.CfnSubnetGroup(
            self, "CacheSubnetGroup",
            description="Subnet group for Sound Clash ElastiCache Redis",
            subnet_ids=[subnet.subnet_id for subnet in self.vpc.private_subnets]
        )
        
        # Redis cluster
        self.redis_cluster = elasticache.CfnCacheCluster(
            self, "RedisCluster",
            cache_node_type="cache.t3.micro",  # ~$12/month
            engine="redis",
            engine_version="7.0",
            num_cache_nodes=1,
            cache_subnet_group_name=self.cache_subnet_group.ref,
            vpc_security_group_ids=[vpc_stack.redis_sg.security_group_id]
        )
        
        # ===== OUTPUTS =====
        
        CfnOutput(
            self, "ActiveGamesTableName",
            value=self.active_games_table.table_name,
            description="Active games DynamoDB table name"
        )
        
        CfnOutput(
            self, "GameSessionsTableName", 
            value=self.game_sessions_table.table_name,
            description="Game sessions DynamoDB table name"
        )
        
        CfnOutput(
            self, "BuzzEventsTableName",
            value=self.buzz_events_table.table_name,
            description="Buzz events DynamoDB table name"
        )
        
        CfnOutput(
            self, "TeamConnectionsTableName",
            value=self.team_connections_table.table_name,
            description="Team connections DynamoDB table name"
        )
        
        CfnOutput(
            self, "PostgresEndpoint",
            value=self.postgres_instance.instance_endpoint.hostname,
            description="RDS PostgreSQL endpoint"
        )
        
        CfnOutput(
            self, "RedisEndpoint",
            value=self.redis_cluster.attr_redis_endpoint_address,
            description="ElastiCache Redis endpoint"
        )
        
        CfnOutput(
            self, "DatabaseSecretArn",
            value=self.db_secret.secret_arn,
            description="Database credentials secret ARN"
        )