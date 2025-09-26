@echo off
REM Windows deployment script for Sound Clash services
REM Usage: deploy-services.bat [environment]

set ENVIRONMENT=%1
if "%ENVIRONMENT%"=="" set ENVIRONMENT=development

echo 🚀 Deploying Sound Clash services to %ENVIRONMENT%...

REM Load environment variables
if exist ".env\%ENVIRONMENT%.env" (
    for /f "delims=" %%x in (.env\%ENVIRONMENT%.env) do set "%%x"
)

REM Deploy infrastructure first
echo 📦 Deploying infrastructure...
cd infrastructure
call cdk deploy --all --require-approval never
cd ..

REM Build and push Docker images
set services=game-management song-management game-api websocket-service manager-console public-display

for %%s in (%services%) do (
    echo 🔨 Building and deploying %%s...
    
    REM Build Docker image
    docker build -t %%s ./backend/%%s
    
    REM Tag for ECR
    docker tag %%s:latest %AWS_ACCOUNT_ID%.dkr.ecr.%AWS_REGION%.amazonaws.com/sound-clash/%%s:latest
    
    REM Push to ECR
    docker push %AWS_ACCOUNT_ID%.dkr.ecr.%AWS_REGION%.amazonaws.com/sound-clash/%%s:latest
    
    REM Update ECS service
    aws ecs update-service --cluster sound-clash-cluster --service %%s --force-new-deployment
)

echo ✅ Deployment complete!
echo 🌐 Frontend URL: %FRONTEND_URL%
echo 🔧 ALB URL: %ALB_URL%
pause
