#!/bin/bash
# Deploy websocket-service to AWS ECS from CloudShell
set -e

echo "🚀 Deploying websocket-service..."

# Configuration
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="381492257993"
SERVICE_NAME="websocket-service"
CLUSTER_NAME="sound-clash-cluster"
ECR_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/sound-clash/${SERVICE_NAME}"

# Clone repository if not already cloned
if [ ! -d "Sound-Clash" ]; then
    echo "📦 Cloning repository..."
    git clone https://github.com/BenArtzi4/Sound-Clash.git
fi

cd Sound-Clash

# Pull latest changes
echo "⬇️ Pulling latest changes..."
git pull origin main

# Navigate to service directory
cd backend/${SERVICE_NAME}

# Login to ECR
echo "🔐 Logging in to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REPO}

# Build Docker image
echo "🔨 Building Docker image..."
docker build -t ${SERVICE_NAME}:latest .

# Tag image
echo "🏷️ Tagging image..."
docker tag ${SERVICE_NAME}:latest ${ECR_REPO}:latest

# Push to ECR
echo "⬆️ Pushing to ECR..."
docker push ${ECR_REPO}:latest

# Force new deployment
echo "🔄 Triggering ECS deployment..."
aws ecs update-service \
    --cluster ${CLUSTER_NAME} \
    --service ${SERVICE_NAME} \
    --force-new-deployment \
    --region ${AWS_REGION}

echo "✅ Deployment initiated! ECS will pull the new image and restart the service."
echo "Monitor deployment status with:"
echo "aws ecs describe-services --cluster ${CLUSTER_NAME} --services ${SERVICE_NAME} --region ${AWS_REGION}"
