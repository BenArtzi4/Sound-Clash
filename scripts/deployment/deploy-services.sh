#!/bin/bash
# Deploy all microservices to AWS ECS
# Usage: ./deploy-services.sh [environment]

ENVIRONMENT=${1:-development}

echo "🚀 Deploying Sound Clash services to $ENVIRONMENT..."

# Load environment variables
if [ -f ".env/$ENVIRONMENT.env" ]; then
    export $(cat .env/$ENVIRONMENT.env | xargs)
fi

# Deploy infrastructure first
echo "📦 Deploying infrastructure..."
cd infrastructure
cdk deploy --all --require-approval never
cd ..

# Build and push Docker images
services=("game-management" "song-management" "game-api" "websocket-service" "manager-console" "public-display")

for service in "${services[@]}"; do
    echo "🔨 Building and deploying $service..."
    
    # Build Docker image
    docker build -t $service ./backend/$service
    
    # Tag for ECR
    docker tag $service:latest ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/sound-clash/$service:latest
    
    # Push to ECR
    docker push ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/sound-clash/$service:latest
    
    # Update ECS service
    aws ecs update-service --cluster sound-clash-cluster --service $service --force-new-deployment
done

echo "✅ Deployment complete!"
echo "🌐 Frontend URL: $FRONTEND_URL"
echo "🔧 ALB URL: $ALB_URL"
