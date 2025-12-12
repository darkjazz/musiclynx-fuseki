#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { MusicLynxFusekiStack } from '../lib/musiclynx-fuseki-stack';

const app = new cdk.App();

const region = process.env.CDK_DEFAULT_REGION || 'eu-north-1';

// eu-north-1 (Stockholm) only has t3 instances, not t2
// t3.micro is free tier eligible just like t2.micro
const instanceType = ec2.InstanceType.of(
  ec2.InstanceClass.T3,
  ec2.InstanceSize.MICRO
);

new MusicLynxFusekiStack(app, 'MusicLynxFusekiStack', {
  // Stack configuration
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },

  // Custom props
  useDefaultVpc: true, // Use existing default VPC (free tier friendly)
  adminPassword: process.env.FUSEKI_ADMIN_PASSWORD || 'changeme',
  instanceType: instanceType,

  // Stack properties
  description: 'MusicLynx Fuseki Triple Store on ECS (Free Tier - eu-north-1)',
  tags: {
    Project: 'MusicLynx',
    ManagedBy: 'CDK',
  },
});

app.synth();
