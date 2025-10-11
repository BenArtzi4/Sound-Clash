from aws_cdk import (
    Stack,
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins as origins,
    aws_certificatemanager as acm,
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
        
        # S3 bucket for static website hosting (simplified config)
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
        
        # Custom cache policies for different asset types
        
        # Cache policy for static assets (CSS, JS, images) - long cache
        static_cache_policy = cloudfront.CachePolicy(
            self, "StaticAssetsCachePolicy",
            cache_policy_name=f"SoundClash-StaticAssets-{self.stack_name}",
            comment="Cache policy for static assets with long TTL",
            default_ttl=Duration.days(30),
            max_ttl=Duration.days(365),
            min_ttl=Duration.seconds(0),
            cookie_behavior=cloudfront.CacheCookieBehavior.none(),
            header_behavior=cloudfront.CacheHeaderBehavior.allow_list(
                "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"
            ),
            query_string_behavior=cloudfront.CacheQueryStringBehavior.none(),
            enable_accept_encoding_brotli=True,
            enable_accept_encoding_gzip=True
        )
        
        # Cache policy for HTML files - short cache for faster updates
        html_cache_policy = cloudfront.CachePolicy(
            self, "HTMLCachePolicy",
            cache_policy_name=f"SoundClash-HTML-{self.stack_name}",
            comment="Cache policy for HTML files with short TTL",
            default_ttl=Duration.minutes(5),
            max_ttl=Duration.days(1),
            min_ttl=Duration.seconds(0),
            cookie_behavior=cloudfront.CacheCookieBehavior.none(),
            header_behavior=cloudfront.CacheHeaderBehavior.allow_list(
                "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"
            ),
            query_string_behavior=cloudfront.CacheQueryStringBehavior.none(),
            enable_accept_encoding_brotli=True,
            enable_accept_encoding_gzip=True
        )

        # Import existing ACM certificate for custom domain
        # Certificate covers soundclash.org and *.soundclash.org
        certificate = acm.Certificate.from_certificate_arn(
            self, "SoundClashCertificate",
            certificate_arn="arn:aws:acm:us-east-1:381492257993:certificate/545b6731-5363-4c1d-873b-4eaaaffd69da"
        )

        # CloudFront distribution with optimized caching and custom domain
        self.distribution = cloudfront.Distribution(
            self, "Distribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3StaticWebsiteOrigin(
                    bucket=self.website_bucket
                ),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cached_methods=cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                cache_policy=html_cache_policy,  # Default for HTML
                compress=True,
                origin_request_policy=cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN
            ),
            
            # Additional behaviors for different asset types
            additional_behaviors={
                # Static assets (JS, CSS, images) - long cache
                "/assets/*": cloudfront.BehaviorOptions(
                    origin=origins.S3StaticWebsiteOrigin(bucket=self.website_bucket),
                    viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowed_methods=cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                    cached_methods=cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                    cache_policy=static_cache_policy,
                    compress=True,
                    origin_request_policy=cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN
                )
            },
            
            default_root_object="index.html",

            # Custom domain configuration
            domain_names=["www.soundclash.org", "soundclash.org"],
            certificate=certificate,

            # Enhanced error responses for SPA
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
                ),
                # Handle other errors
                cloudfront.ErrorResponse(
                    http_status=500,
                    response_http_status=500,
                    response_page_path="/index.html",
                    ttl=Duration.minutes(1)
                )
            ],
            
            price_class=cloudfront.PriceClass.PRICE_CLASS_100,  # US, Canada, Europe
            comment="Sound Clash Frontend Distribution - Optimized"
        )
        
        # Deploy the frontend build to S3
        frontend_build_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
        
        self.deployment = s3deploy.BucketDeployment(
            self, "DeployWebsite",
            sources=[s3deploy.Source.asset(frontend_build_path)],
            destination_bucket=self.website_bucket,
            distribution=self.distribution,
            distribution_paths=["/*"],  # Invalidate all paths
            memory_limit=1024,  # Increased memory for better performance
            ephemeral_storage_size=Size.mebibytes(1024)
        )
        
        # Outputs
        CfnOutput(
            self, "WebsiteBucketName",
            value=self.website_bucket.bucket_name,
            description="S3 bucket hosting the frontend"
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
            description="Main Website URL (use this for production)"
        )
        
        CfnOutput(
            self, "S3WebsiteURL",
            value=self.website_bucket.bucket_website_url,
            description="Direct S3 Website URL (for testing only)"
        )