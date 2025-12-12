# MusicLynx Fuseki Deployment Guide for AWS ECS

This guide walks you through deploying the MusicLynx triple store on AWS ECS using the free tier with AWS CDK.

## Prerequisites

- AWS Account with free tier eligibility
- AWS CLI installed and configured (`aws configure`)
- Docker installed locally
- Node.js 18+ installed (`node --version`)
- npm installed

## Architecture Overview

- **Region**: eu-north-1 (Stockholm)
- **IaC**: AWS CDK (TypeScript)
- **Service**: Apache Jena Fuseki triple store
- **Data**: 108MB of artist abstracts and categories (pre-loaded)
- **Compute**: ECS on EC2 (t3.micro - 1GB RAM, 2 vCPUs)
- **Storage**: Pre-baked into Docker image (no persistent volume needed)
- **Cost**: Free tier eligible for 12 months

## Quick Start (Automated Deployment)

The fastest way to deploy is using the automated deployment script:

```bash
# Set your AWS region (optional, defaults to eu-north-1)
export AWS_REGION=eu-north-1

# Run the deployment script
./deploy.sh
```

This script will:
1. Install CDK dependencies
2. Bootstrap CDK in your AWS account (if needed)
3. Deploy the infrastructure
4. Build and push the Docker image to ECR
5. Start the ECS service
6. Display the endpoint URL

**That's it!** The script handles everything automatically.

### Get the Endpoint URL

```bash
./get-endpoint.sh
```

### Test the Deployment

```bash
# Get your endpoint IP
export FUSEKI_IP=$(./get-endpoint.sh | grep "http://" | head -1 | cut -d' ' -f3 | cut -d':' -f2 | tr -d '/')

# Test health endpoint
curl http://$FUSEKI_IP:3030/$/ping

# Test SPARQL query
curl "http://$FUSEKI_IP:3030/musiclynx/query" \
  --data-urlencode "query=SELECT * { ?s ?p ?o } LIMIT 10"
```

### Destroy Infrastructure

```bash
./destroy.sh
```

---

## Manual Deployment (Step by Step)

If you prefer to deploy manually or want to understand each step:

### Step 1: Install Dependencies

```bash
# Navigate to CDK directory
cd cdk

# Install Node.js dependencies
npm install

cd ..
```

### Step 2: Test Locally (Optional but Recommended)

```bash
# Build and test the Docker image locally
docker build -t musiclynx-fuseki .
docker run -p 3030:3030 musiclynx-fuseki

# In another terminal, test the endpoint
curl http://localhost:3030/$/ping
curl "http://localhost:3030/musiclynx/query" --data-urlencode "query=SELECT * { ?s ?p ?o } LIMIT 10"
```

### Step 3: Bootstrap CDK

```bash
# Set your AWS region
export AWS_REGION=eu-north-1

# Get your AWS account ID
export AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# Bootstrap CDK (only needed once per account/region)
cd cdk
npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION
cd ..
```

### Step 4: Deploy Infrastructure with CDK

```bash
cd cdk

# Review what will be deployed
npx cdk diff

# Deploy the stack
npx cdk deploy

cd ..
```

This will create:
- ECR repository
- ECS cluster
- Auto Scaling Group with t3.micro instance (free tier)
- Security groups
- IAM roles
- CloudWatch log group
- ECS task definition and service

**Note**: eu-north-1 (Stockholm) uses t3.micro instead of t2.micro. Both are free tier eligible!

### Step 5: Build and Push Docker Image

```bash
# Get ECR repository URI from CDK outputs
export ECR_REPO_URI=$(aws cloudformation describe-stacks \
    --stack-name MusicLynxFusekiStack \
    --query 'Stacks[0].Outputs[?OutputKey==`ECRRepositoryUri`].OutputValue' \
    --output text \
    --region $AWS_REGION)

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
    docker login --username AWS --password-stdin $ECR_REPO_URI

# Build the image
docker build -t musiclynx-fuseki .

# Tag the image
docker tag musiclynx-fuseki:latest $ECR_REPO_URI:latest

# Push to ECR
docker push $ECR_REPO_URI:latest
```

### Step 6: Force ECS Service Update

```bash
# Trigger deployment of the new image
aws ecs update-service \
    --cluster musiclynx-cluster \
    --service musiclynx-fuseki-service \
    --force-new-deployment \
    --region $AWS_REGION
```

### Step 7: Get the Public IP

```bash
# Wait a few minutes for the service to start
sleep 60

# Get the Auto Scaling Group name
export ASG_NAME=$(aws cloudformation describe-stack-resources \
    --stack-name MusicLynxFusekiStack \
    --query 'StackResources[?ResourceType==`AWS::AutoScaling::AutoScalingGroup`].PhysicalResourceId' \
    --output text \
    --region $AWS_REGION)

# Get the EC2 instance public IP
export PUBLIC_IP=$(aws ec2 describe-instances \
    --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text \
    --region $AWS_REGION)

echo "Fuseki Endpoint: http://$PUBLIC_IP:3030"
```

### Step 8: Test Your Deployment

```bash
# Test health endpoint
curl http://$PUBLIC_IP:3030/$/ping

# Test SPARQL query for abstracts
curl "http://$PUBLIC_IP:3030/musiclynx/query" \
    --data-urlencode "query=SELECT * { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?o } LIMIT 10"

# Test SPARQL query for categories
curl "http://$PUBLIC_IP:3030/musiclynx/query" \
    --data-urlencode "query=SELECT * { ?s <http://www.w3.org/2004/02/skos/core#broader> ?o } LIMIT 10"
```

### Step 9: Update MusicLynx Server

Update your MusicLynx server configuration to use the new endpoint:

```javascript
// In your musiclynx-server config
const FUSEKI_ENDPOINT = 'http://YOUR_PUBLIC_IP:3030/musiclynx/query';
```

## Monitoring and Maintenance

### View Logs

```bash
aws logs tail /ecs/musiclynx-fuseki --follow --region $AWS_REGION
```

### Check Service Status

```bash
aws ecs describe-services \
    --cluster musiclynx-cluster \
    --services musiclynx-fuseki-service \
    --region $AWS_REGION
```

### Update the Image

```bash
# After making changes to your TTL data or Fuseki configuration:

# 1. Rebuild the Docker image
docker build -t musiclynx-fuseki .

# 2. Tag the image
docker tag musiclynx-fuseki:latest $ECR_REPO_URI:latest

# 3. Push to ECR
docker push $ECR_REPO_URI:latest

# 4. Force new deployment
aws ecs update-service \
    --cluster musiclynx-cluster \
    --service musiclynx-fuseki-service \
    --force-new-deployment \
    --region $AWS_REGION
```

### Update Infrastructure

```bash
# If you make changes to the CDK stack:
cd cdk

# Review changes
npx cdk diff

# Deploy updates
npx cdk deploy

cd ..
```

## Cost Management

### Free Tier Limits
- **EC2**: 750 hours/month of t3.micro (covers 24/7 operation)
- **ECR**: 500MB storage (your image ~300-400MB)
- **Data Transfer**: 100GB/month outbound (within AWS region)
- **CloudWatch Logs**: 5GB ingestion, 5GB storage

**Note**: t3.micro provides 2 vCPUs vs t2.micro's 1 vCPU, so you get better performance while staying in free tier!

### Clean Up (if needed)

Using CDK makes cleanup much easier:

```bash
cd cdk

# Destroy all infrastructure
npx cdk destroy

cd ..
```

This will remove:
- ECS service and tasks
- EC2 instances
- ECS cluster
- Security groups
- IAM roles
- CloudWatch log groups
- ECR repository (with images)
- All other resources created by the stack

## Troubleshooting

### Container won't start
- Check CloudWatch logs: `aws logs tail /ecs/musiclynx-fuseki --follow`
- Verify the image was pushed successfully to ECR
- Check EC2 instance has enough memory (should have ~100MB free after Fuseki starts)

### Can't connect to endpoint
- Verify security group allows port 3030
- Check task is running: `aws ecs list-tasks --cluster musiclynx-cluster`
- Verify EC2 instance is in "running" state

### Data not loading
- Check container logs for data loading messages
- Verify TTL files are in the image: `docker run --rm --entrypoint ls musiclynx-fuseki /data`

## Production Recommendations

For production use, consider:
1. **Use Application Load Balancer** for better availability
2. **Set up HTTPS** with ACM certificate
3. **Enable ECS Service Auto Scaling** (though not needed for current load)
4. **Use AWS Backup** or EBS snapshots if you allow data updates
5. **Set up CloudWatch alarms** for health monitoring
6. **Use AWS Secrets Manager** for admin password

## Support

For issues specific to:
- **Fuseki**: https://jena.apache.org/documentation/fuseki2/
- **MusicLynx**: https://github.com/darkjazz/musiclynx
- **AWS ECS**: https://docs.aws.amazon.com/ecs/
