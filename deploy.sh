#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}MusicLynx Fuseki Deployment Script${NC}"
echo "===================================="
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# Get AWS account and region
export AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=${AWS_REGION:-eu-north-1}

echo "AWS Account: $AWS_ACCOUNT"
echo "AWS Region: $AWS_REGION"
echo ""

# Step 1: Install CDK dependencies
echo -e "${YELLOW}Step 1: Installing CDK dependencies...${NC}"
cd cdk
if [ ! -d "node_modules" ]; then
    npm install
fi
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 2: Bootstrap CDK (if needed)
echo -e "${YELLOW}Step 2: Bootstrapping CDK environment...${NC}"
npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION || true
echo -e "${GREEN}✓ CDK bootstrapped${NC}"
echo ""

# Step 3: Deploy infrastructure with service at 0 tasks (image doesn't exist yet)
echo -e "${YELLOW}Step 3: Deploying CDK stack (service will start with 0 tasks)...${NC}"
npx cdk deploy --require-approval never --context desiredCount=0
echo -e "${GREEN}✓ Infrastructure deployed${NC}"
echo ""

# Get ECR repository URI from stack outputs
export ECR_REPO_URI=$(aws cloudformation describe-stacks \
    --stack-name MusicLynxFusekiStack \
    --query 'Stacks[0].Outputs[?OutputKey==`ECRRepositoryUri`].OutputValue' \
    --output text \
    --region $AWS_REGION)

echo "ECR Repository: $ECR_REPO_URI"
echo ""

# Step 4: Build and push Docker image BEFORE starting the service
echo -e "${YELLOW}Step 4: Building and pushing Docker image...${NC}"
cd ..

# Login to ECR
echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REPO_URI

# Build image
echo "Building Docker image..."
docker build -t musiclynx-fuseki:latest .

# Tag image
echo "Tagging image..."
docker tag musiclynx-fuseki:latest $ECR_REPO_URI:latest

# Push image
echo "Pushing image to ECR..."
docker push $ECR_REPO_URI:latest

echo -e "${GREEN}✓ Docker image built and pushed${NC}"
echo ""

# Step 5: Now scale up the ECS service to 1 (image is ready now)
echo -e "${YELLOW}Step 5: Starting ECS service (scaling to 1 task)...${NC}"
aws ecs update-service \
    --cluster musiclynx-cluster \
    --service musiclynx-fuseki-service \
    --desired-count 1 \
    --force-new-deployment \
    --region $AWS_REGION \
    --no-cli-pager > /dev/null

echo -e "${GREEN}✓ ECS service starting${NC}"
echo ""

# Step 6: Get public IP
echo -e "${YELLOW}Step 6: Waiting for service to start (this may take 2-3 minutes)...${NC}"
sleep 30

ASG_NAME=$(aws cloudformation describe-stack-resources \
    --stack-name MusicLynxFusekiStack \
    --query 'StackResources[?ResourceType==`AWS::AutoScaling::AutoScalingGroup`].PhysicalResourceId' \
    --output text \
    --region $AWS_REGION)

PUBLIC_IP=$(aws ec2 describe-instances \
    --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text \
    --region $AWS_REGION)

if [ "$PUBLIC_IP" != "None" ] && [ -n "$PUBLIC_IP" ]; then
    echo -e "${GREEN}✓ Service is running${NC}"
    echo ""
    echo "=========================================="
    echo -e "${GREEN}Deployment Complete!${NC}"
    echo "=========================================="
    echo ""
    echo "Fuseki Endpoint: http://$PUBLIC_IP:3030"
    echo ""
    echo "Test your deployment:"
    echo "  curl http://$PUBLIC_IP:3030/\$/ping"
    echo ""
    echo "Query endpoint:"
    echo "  http://$PUBLIC_IP:3030/musiclynx/query"
    echo ""
    echo "View logs:"
    echo "  aws logs tail /ecs/musiclynx-fuseki --follow --region $AWS_REGION"
    echo ""
else
    echo -e "${YELLOW}Note: Instance is still starting up. Run this to get the IP when ready:${NC}"
    echo "  ./get-endpoint.sh"
fi
