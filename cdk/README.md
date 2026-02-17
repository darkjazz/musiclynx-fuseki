# MusicLynx CDK Infrastructure

AWS CDK infrastructure for the MusicLynx PostgreSQL database on RDS.

## Stack

**MusicLynxRdsStack** (`lib/musiclynx-rds-stack.ts`) creates:

- **RDS PostgreSQL 16** instance (db.t3.micro, free tier eligible)
- **VPC**: Uses default VPC
- **Security Group**: Allows PostgreSQL access on port 5432
- **Secrets Manager**: Auto-generated database credentials
- **CloudWatch**: PostgreSQL log exports

**Region**: eu-north-1 (Stockholm)

## Prerequisites

- Node.js 18+
- AWS CLI configured
- AWS CDK installed (`npm install -g aws-cdk`)

## Commands

```bash
npm install              # Install dependencies
npx cdk bootstrap       # Bootstrap CDK (first time only)
npx cdk deploy           # Deploy the stack
npx cdk diff             # Compare deployed vs current
npx cdk destroy          # Destroy the stack
npm run build            # Compile TypeScript
```

## Stack Outputs

After deployment:

- **DatabaseEndpoint** - RDS hostname
- **DatabasePort** - PostgreSQL port
- **DatabaseName** - Database name
- **DatabaseSecretArn** - Secrets Manager ARN for credentials
- **ConnectionString** - `psql` connection command
- **GetPasswordCommand** - Command to retrieve the password

## Cost

Free tier eligible for 12 months:

- RDS: 750 hours/month db.t3.micro
- Storage: 20 GB GP2
- Backups: 7 days retention

Estimated: **$0/month** within free tier, ~$15/month after.
