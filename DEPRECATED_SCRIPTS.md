# Deprecated Scripts

The following scripts are deprecated and replaced by the automated CI/CD pipeline.

## Deprecated

### deploy.sh
**Replaced by**: AWS CodePipeline (automated deployment on git push)
**Why**: Manual deployment is error-prone and doesn't handle the image/infra dependency correctly

### update-image.sh
**Replaced by**: CodeBuild in pipeline (automated Docker build and ECR push)
**Why**: Pipeline ensures consistent builds with proper caching and validation

### get-endpoint.sh
**Replaced by**: CloudFormation outputs
**How**: `aws cloudformation describe-stacks --stack-name MusicLynxFusekiStack --query 'Stacks[0].Outputs'`

### check-status.sh, force-cleanup.sh
**Replaced by**: Proper ECS service management in pipeline
**Why**: Pipeline handles task lifecycle correctly, these were band-aids for manual deployment issues

### build-data.sh
**Moved to**: `scripts/build-database.sh`
**Why**: Part of automated build process, moved to scripts/ for better organization

### load-data.sh
**Deleted**: No longer needed
**Why**: Data is pre-loaded into Docker image during build, not at runtime

## Still Valid

### destroy.sh
**Status**: Keep as-is
**Purpose**: Emergency cleanup script
**Usage**: `./destroy.sh` to delete all AWS resources

### docker-compose.yml
**Status**: Keep as-is
**Purpose**: Local development
**Usage**: `docker-compose up` for local testing

## Migration Path

If you have been using manual deployment:

1. Delete old stack: `aws cloudformation delete-stack --stack-name MusicLynxFusekiStack`
2. Set up GitHub token: See DEPLOYMENT_PIPELINE.md
3. Deploy pipeline: `cd cdk && npx cdk deploy`
4. Push to GitHub: Pipeline handles everything automatically
