# MusicLynx Fuseki CDK Infrastructure

This directory contains the AWS CDK infrastructure code for deploying the MusicLynx Fuseki triple store.

## Overview

The CDK stack (`MusicLynxFusekiStack`) creates:

- **ECR Repository**: For storing the Fuseki Docker image
- **VPC**: Uses default VPC (free tier friendly)
- **ECS Cluster**: For running containers
- **Auto Scaling Group**: t3.micro EC2 instance (free tier eligible)
- **Security Group**: Allows port 3030 (Fuseki) and 22 (SSH)
- **IAM Roles**: For ECS instances and tasks
- **CloudWatch Logs**: For application logging
- **ECS Service**: Runs the Fuseki container

**Region**: Configured for eu-north-1 (Stockholm) which uses t3.micro (2 vCPUs, better than t2.micro)

## Prerequisites

- Node.js 18+
- AWS CLI configured
- AWS CDK installed (`npm install -g aws-cdk`)

## Quick Start

```bash
# Install dependencies
npm install

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy the stack
npx cdk deploy

# Destroy the stack
npx cdk destroy
```

## CDK Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm run watch` - Watch for changes and compile
- `npm run cdk` - Run CDK CLI commands
- `npm run deploy` - Deploy the stack
- `npm run synth` - Synthesize CloudFormation template
- `npm run diff` - Compare deployed stack with current state
- `npm run destroy` - Destroy the stack

## Stack Configuration

You can customize the stack by modifying `bin/musiclynx-fuseki.ts`:

```typescript
new MusicLynxFusekiStack(app, 'MusicLynxFusekiStack', {
  // AWS environment
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-north-1', // Stockholm region
  },

  // Custom configuration
  useDefaultVpc: true,
  adminPassword: 'your-secure-password',
  instanceType: ec2.InstanceType.of(
    ec2.InstanceClass.T3, // T3 for eu-north-1
    ec2.InstanceSize.MICRO
  ),
});
```

## Stack Outputs

After deployment, the stack provides these outputs:

- **ECRRepositoryUri**: URI for pushing Docker images
- **ClusterName**: Name of the ECS cluster
- **ServiceName**: Name of the ECS service
- **FusekiEndpointInstructions**: Command to get the endpoint IP
- **LogGroupName**: CloudWatch log group name

## Architecture

```
┌─────────────────────────────────────────┐
│           Default VPC                   │
│  ┌───────────────────────────────────┐  │
│  │  Public Subnet                    │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  EC2 Instance (t2.micro)    │  │  │
│  │  │  ┌───────────────────────┐  │  │  │
│  │  │  │  ECS Agent            │  │  │  │
│  │  │  │  ┌─────────────────┐  │  │  │  │
│  │  │  │  │ Fuseki Container│  │  │  │  │
│  │  │  │  │ Port: 3030      │  │  │  │  │
│  │  │  │  │ 108MB TTL data  │  │  │  │  │
│  │  │  │  └─────────────────┘  │  │  │  │
│  │  │  └───────────────────────┘  │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
         │                  │
         │                  │
    ┌────▼────┐      ┌──────▼──────┐
    │   ECR   │      │  CloudWatch │
    │ Registry│      │    Logs     │
    └─────────┘      └─────────────┘
```

## Cost Optimization

The stack is configured for AWS Free Tier:

- Uses **default VPC** (no VPC costs)
- **No NAT Gateway** (saves ~$32/month)
- **t3.micro instance** (750 hrs/month free, 2 vCPUs!)
- **No load balancer** (saves ~$16/month)
- **Container Insights disabled** (saves CloudWatch costs)
- **Log retention**: 1 week (minimal storage costs)

Estimated monthly cost within free tier: **$0** for first 12 months

**Note**: eu-north-1 uses t3.micro (2 vCPUs) instead of t2.micro (1 vCPU), giving you better performance for free!

## Development

### Project Structure

```
cdk/
├── bin/
│   └── musiclynx-fuseki.ts    # CDK app entry point
├── lib/
│   └── musiclynx-fuseki-stack.ts  # Stack definition
├── cdk.json                   # CDK configuration
├── package.json               # Dependencies
├── tsconfig.json              # TypeScript config
└── README.md                  # This file
```

### Making Changes

1. Modify the stack in `lib/musiclynx-fuseki-stack.ts`
2. Review changes: `npm run diff`
3. Deploy updates: `npm run deploy`

### Adding Resources

The stack uses AWS CDK L2 constructs for ease of use. Example:

```typescript
// Add an S3 bucket
import * as s3 from 'aws-cdk-lib/aws-s3';

const bucket = new s3.Bucket(this, 'MyBucket', {
  versioned: true,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
```

## Troubleshooting

### CDK Bootstrap Issues

If you get bootstrap errors:

```bash
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

### Stack Already Exists

If the stack already exists in a different state:

```bash
# Delete manually
aws cloudformation delete-stack --stack-name MusicLynxFusekiStack

# Wait for deletion
aws cloudformation wait stack-delete-complete --stack-name MusicLynxFusekiStack

# Redeploy
npx cdk deploy
```

### Diff Shows Unwanted Changes

If `cdk diff` shows unexpected changes, check:

1. CDK version matches `package.json`
2. Context values in `cdk.json`
3. Environment variables

## Security Considerations

For production use:

1. **Change admin password**: Set `FUSEKI_ADMIN_PASSWORD` environment variable
2. **Restrict security group**: Limit port 3030 to specific IPs
3. **Remove SSH access**: Remove port 22 from security group
4. **Use HTTPS**: Add an Application Load Balancer with ACM certificate
5. **Enable encryption**: Add EBS encryption to the launch template
6. **Use Secrets Manager**: Store admin password securely

## References

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS ECS Documentation](https://docs.aws.amazon.com/ecs/)
- [Apache Jena Fuseki Documentation](https://jena.apache.org/documentation/fuseki2/)
