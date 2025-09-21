from aws_cdk import (
    Stack,
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_iam as iam,
    CfnOutput,
    RemovalPolicy,
    Duration,
    Size
)
from constructs import Construct
import os

class FrontendStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        # S3 bucket for static website hosting
        self.website_bucket = s3.Bucket(
            self, "WebsiteBucket",
            bucket_name=f"sound-clash-frontend-{self.account}-{self.region}",
            website_index_document="index.html",
            website_error_document="index.html",  # SPA routing support
            public_read_access=True,
            block_public_access=s3.BlockPublicAccess(
                block_public_acls=False,
                block_public_policy=False,
                ignore_public_acls=False,
                restrict_public_buckets=False
            ),
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            cors=[
                s3.CorsRule(
                    allowed_headers=["*"],
                    allowed_methods=[
                        s3.HttpMethods.GET,
                        s3.HttpMethods.HEAD
                    ],
                    allowed_origins=["*"],
                    max_age=3600
                )
            ]
        )
        
        # CloudFront Origin Access Identity (not needed for static website origin)
        # self.origin_access_identity = cloudfront.OriginAccessIdentity(
        #     self, "OriginAccessIdentity",
        #     comment=f"Sound Clash Frontend OAI"
        # )
        
        # Grant CloudFront access to S3 bucket (not needed for static website)
        # self.website_bucket.grant_read(self.origin_access_identity)
        
        # CloudFront distribution - using S3 static website origin
        self.distribution = cloudfront.Distribution(
            self, "Distribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3StaticWebsiteOrigin(
                    bucket=self.website_bucket
                ),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cached_methods=cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
                compress=True
            ),
            default_root_object="index.html",
            error_responses=[
                # SPA routing - redirect all 404s to index.html
                cloudfront.ErrorResponse(
                    http_status=404,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.minutes(0)
                ),
                cloudfront.ErrorResponse(
                    http_status=403,
                    response_http_status=200,
                    response_page_path="/index.html",
                    ttl=Duration.minutes(0)
                )
            ],
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,  # US, Canada, Europe only
            comment="Sound Clash Frontend Distribution"
        )
        
        # Deploy the frontend build to S3
        frontend_build_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
        
        self.deployment = s3deploy.BucketDeployment(
            self, "DeployWebsite",
            sources=[s3deploy.Source.asset(frontend_build_path)],
            destination_bucket=self.website_bucket,
            distribution=self.distribution,
            distribution_paths=["/*"],  # Invalidate all paths
            memory_limit=512,
            ephemeral_storage_size=Size.mebibytes(512)
        )
        
        # Outputs
        CfnOutput(
            self, "WebsiteBucketName",
            value=self.website_bucket.bucket_name,
            description="Name of the S3 bucket hosting the website"
        )
        
        CfnOutput(
            self, "DistributionId",
            value=self.distribution.distribution_id,
            description="CloudFront Distribution ID"
        )
        
        CfnOutput(
            self, "DistributionDomainName",
            value=self.distribution.distribution_domain_name,
            description="CloudFront Distribution Domain Name"
        )
        
        CfnOutput(
            self, "WebsiteURL",
            value=f"https://{self.distribution.distribution_domain_name}",
            description="Website URL"
        )
        
        CfnOutput(
            self, "S3WebsiteURL",
            value=self.website_bucket.bucket_website_url,
            description="S3 Website URL (for testing)"
        )