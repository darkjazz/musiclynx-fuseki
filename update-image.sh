#!/bin/bash
set -e

export AWS_REGION=${AWS_REGION:-eu-north-1}

echo "Updating MusicLynx Fuseki image..."
echo ""

# Get ECR URI
export ECR_REPO_URI=$(aws cloudformation describe-stacks \
    --stack-name MusicLynxFusekiStack \
    --query 'Stacks[0].Outputs[?OutputKey==`ECRRepositoryUri`].OutputValue' \
    --output text \
    --region $AWS_REGION)

echo "ECR Repository: $ECR_REPO_URI"
echo ""

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REPO_URI

# Build new image
echo "Building Docker image..."
docker build -t musiclynx-fuseki:latest .

# Tag image
echo "Tagging image..."
docker tag musiclynx-fuseki:latest $ECR_REPO_URI:latest

# Push to ECR
echo "Pushing image to ECR..."
docker push $ECR_REPO_URI:latest

# Force service update
echo "Forcing ECS service update..."
aws ecs update-service \
    --cluster musiclynx-cluster \
    --service musiclynx-fuseki-service \
    --force-new-deployment \
    --region $AWS_REGION \
    --no-cli-pager

echo ""
echo "✓ Image updated! Service is redeploying..."
echo ""
echo "Wait ~2-3 minutes, then check status with:"
echo "  ./check-status.sh"
echo ""
echo "View logs:"
echo "  aws logs tail /ecs/musiclynx-fuseki --follow --region $AWS_REGION"
