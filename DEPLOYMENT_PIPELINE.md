# MusicLynx Fuseki - CI/CD Pipeline Deployment

This project uses AWS CDK with CodePipeline for automated continuous deployment.

## Architecture

The deployment pipeline automatically:
1. **Source**: Monitors GitHub repository for changes
2. **Build Docker**: Builds TDB2 database from TTL files and creates Docker image
3. **Build CDK**: Synthesizes CloudFormation templates
4. **Deploy**: Deploys infrastructure and updates ECS service

## Prerequisites

1. **AWS CLI** configured with credentials
2. **Node.js** 18+ and npm
3. **Docker** (for local development only)
4. **GitHub Personal Access Token** with repo permissions

## One-Time Setup

### 1. Store GitHub Token in AWS Secrets Manager

```bash
# Get GitHub token (if using gh CLI)
gh auth token

# Or create a personal access token at:
# https://github.com/settings/tokens/new
# Permissions needed: repo (all), admin:repo_hook

# Store in Secrets Manager
aws secretsmanager create-secret \
  --name github-token \
  --description "GitHub token for CodePipeline" \
  --secret-string "your-github-token-here" \
  --region eu-north-1
```

### 2. Bootstrap CDK (if not already done)

```bash
cd cdk
npm install
npx cdk bootstrap aws://ACCOUNT-ID/eu-north-1
```

### 3. Deploy the Pipeline

```bash
# From the cdk directory
npx cdk deploy
```

This creates the pipeline stack which includes:
- CodePipeline with GitHub webhook
- CodeBuild projects for Docker and CDK builds
- ECR repository
- All necessary IAM roles

## How It Works

### First Deployment

1. Pipeline detects the initial state of your repository
2. **Build Docker** stage:
   - Runs `scripts/build-database.sh` to load TTL data into TDB2
   - Builds Docker image with pre-loaded database
   - Validates triplestore has correct data
   - Pushes image to ECR
3. **Build CDK** stage:
   - Synthesizes CloudFormation templates
4. **Deploy** stage:
   - Creates ECS cluster, Auto Scaling Group, Security Groups
   - Deploys ECS service with 1 task

### Subsequent Deployments

Every push to the `main` branch (or configured branch):
1. GitHub webhook triggers pipeline
2. Same build and deploy process runs
3. ECS performs rolling update to new Docker image
4. Zero-downtime deployment

## Pipeline Configuration

Edit `cdk/bin/musiclynx-fuseki.ts` to customize:

```typescript
new PipelineStack(app, 'MusicLynxFusekiPipelineStack', {
  githubOwner: 'darkjazz',        // Your GitHub username
  githubRepo: 'musiclynx-fuseki', // Your repo name
  githubBranch: 'main',           // Branch to track
  githubTokenSecretName: 'github-token',
});
```

## Monitoring

### View Pipeline Status

```bash
# Get pipeline URL
aws cloudformation describe-stacks \
  --stack-name MusicLynxFusekiPipelineStack \
  --query 'Stacks[0].Outputs[?OutputKey==`PipelineConsoleUrl`].OutputValue' \
  --output text \
  --region eu-north-1
```

Or visit AWS Console → CodePipeline → MusicLynxFusekiPipeline

### View Build Logs

```bash
# Docker build logs
aws logs tail /aws/codebuild/musiclynx-fuseki-docker-build --follow

# CDK build logs
aws logs tail /aws/codebuild/musiclynx-fuseki-cdk-synth --follow
```

### View Application Logs

```bash
# Fuseki logs
aws logs tail /ecs/musiclynx-fuseki --follow --region eu-north-1
```

## Get Endpoint

After deployment completes:

```bash
# Get the EC2 instance public IP
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*MusicLynxFusekiStack*" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text \
  --region eu-north-1

# Test endpoint
ENDPOINT=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*MusicLynxFusekiStack*" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text \
  --region eu-north-1)

curl "http://${ENDPOINT}:3030/musiclynx/query" \
  --data-urlencode "query=SELECT * { ?s ?p ?o } LIMIT 10"
```

## Local Development

For local testing without deploying:

```bash
# Build database locally
chmod +x scripts/build-database.sh
./scripts/build-database.sh

# Build Docker image
docker build -t musiclynx-fuseki .

# Run locally
docker run -p 3030:3030 musiclynx-fuseki

# Test
curl http://localhost:3030/$/ping
```

## Updating the Infrastructure

### Update Code

```bash
# Make changes to cdk/lib/*.ts files
cd cdk
npm run build

# Test locally
npx cdk synth
npx cdk diff
```

### Deploy Updates

Simply commit and push:

```bash
git add .
git commit -m "Update infrastructure"
git push origin main
```

The pipeline automatically:
1. Detects the push
2. Rebuilds everything
3. Deploys changes

## Rollback

If a deployment fails, CodePipeline will not proceed and the previous version remains running.

To manually rollback:

```bash
# Find previous image tag
aws ecr describe-images \
  --repository-name musiclynx-fuseki \
  --region eu-north-1

# Update ECS service to use previous image
aws ecs update-service \
  --cluster musiclynx-cluster \
  --service musiclynx-fuseki-service \
  --force-new-deployment \
  --region eu-north-1
```

## Cost

**Free tier eligible** for 12 months:
- CodePipeline: 1 active pipeline free
- CodeBuild: 100 build minutes/month free
- EC2: 750 hours/month of t3.micro
- ECR: 500MB storage
- Data transfer: 100GB/month outbound

**After free tier**: ~$10-12/month
- EC2 t3.micro: ~$8/month
- CodeBuild: $0.005/min (only runs on deployments)
- ECR storage: $0.10/GB/month (~$0.40 for 400MB image)

## Destroying Everything

```bash
# Delete the infrastructure stack first
aws cloudformation delete-stack \
  --stack-name MusicLynxFusekiStack \
  --region eu-north-1

# Wait for completion
aws cloudformation wait stack-delete-complete \
  --stack-name MusicLynxFusekiStack \
  --region eu-north-1

# Delete the pipeline stack
cd cdk
npx cdk destroy

# Clean up ECR images (manual)
aws ecr batch-delete-image \
  --repository-name musiclynx-fuseki \
  --image-ids imageTag=latest \
  --region eu-north-1
```

## Troubleshooting

### Pipeline Fails at Build Docker Stage

Check CodeBuild logs:
```bash
aws logs tail /aws/codebuild/musiclynx-fuseki-docker-build --follow
```

Common issues:
- Missing TTL data files in `data/` directory
- Docker build timeout (increase build timeout in pipeline-stack.ts)
- Insufficient disk space (increase CodeBuild compute type)

### Pipeline Fails at Deploy Stage

Check CloudFormation events:
```bash
aws cloudformation describe-stack-events \
  --stack-name MusicLynxFusekiStack \
  --region eu-north-1
```

Common issues:
- ECS service can't pull image (check ECR permissions)
- Insufficient memory on EC2 instance
- Security group issues

### Task Not Starting

Check ECS service:
```bash
aws ecs describe-services \
  --cluster musiclynx-cluster \
  --services musiclynx-fuseki-service \
  --region eu-north-1
```

## Migration from Manual Deployment

If you previously deployed manually:

1. Delete old manual stack:
   ```bash
   aws cloudformation delete-stack --stack-name MusicLynxFusekiStack --region eu-north-1
   ```

2. Deploy new pipeline:
   ```bash
   cd cdk
   npx cdk deploy
   ```

3. Pipeline will create fresh infrastructure automatically.

## Further Reading

- [AWS CDK Pipelines Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.pipelines-readme.html)
- [AWS CodePipeline User Guide](https://docs.aws.amazon.com/codepipeline/)
- [Apache Jena Fuseki Documentation](https://jena.apache.org/documentation/fuseki2/)
