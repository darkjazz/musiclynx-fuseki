#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MusicLynxRdsStack } from '../lib/musiclynx-rds-stack';
import { MusicLynxServerStack } from '../lib/musiclynx-server-stack';

const app = new cdk.App();

const region = process.env.CDK_DEFAULT_REGION || 'eu-north-1';
const account = process.env.CDK_DEFAULT_ACCOUNT;

const env = { account, region };

// RDS PostgreSQL Stack
const rdsStack = new MusicLynxRdsStack(app, 'MusicLynxRdsStack', {
  env,
  description: 'MusicLynx PostgreSQL Database (RDS Free Tier - eu-north-1)',
  useDefaultVpc: true,
  databaseName: 'musiclynx',
  masterUsername: 'musiclynx_admin',
  tags: {
    Project: 'MusicLynx',
    Component: 'Database',
    ManagedBy: 'CDK',
  },
});

// ECS Server Stack
const serverStack = new MusicLynxServerStack(app, 'MusicLynxServerStack', {
  env,
  description: 'MusicLynx Express Server (ECS EC2 t3.micro - eu-north-1)',
  dbEndpoint: rdsStack.database.dbInstanceEndpointAddress,
  dbPort: rdsStack.database.dbInstanceEndpointPort,
  dbName: 'musiclynx',
  dbSecretArn: rdsStack.databaseSecret.secretArn,
});
serverStack.addDependency(rdsStack);

app.synth();
