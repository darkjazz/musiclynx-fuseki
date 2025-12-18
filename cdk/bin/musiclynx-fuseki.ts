#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MusicLynxRdsStack } from '../lib/musiclynx-rds-stack';

const app = new cdk.App();

const region = process.env.CDK_DEFAULT_REGION || 'eu-north-1';

// RDS PostgreSQL Stack
// Replaces DBpedia with a reliable, self-hosted database
new MusicLynxRdsStack(app, 'MusicLynxRdsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
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

app.synth();
