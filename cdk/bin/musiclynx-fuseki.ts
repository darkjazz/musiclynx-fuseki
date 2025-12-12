#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';
import { MusicLynxFusekiStack } from '../lib/musiclynx-fuseki-stack';

const app = new cdk.App();

const region = process.env.CDK_DEFAULT_REGION || 'eu-north-1';

// CI/CD Pipeline Stack
// This creates a self-mutating pipeline that automatically deploys on git push
new PipelineStack(app, 'MusicLynxFusekiPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  description: 'CI/CD Pipeline for MusicLynx Fuseki Triple Store',
  githubOwner: 'darkjazz',
  githubRepo: 'musiclynx-fuseki',
  githubBranch: 'main', // Change to 'develop' if needed
  githubTokenSecretName: 'github-access-token',
  tags: {
    Project: 'MusicLynx',
    Component: 'Pipeline',
    ManagedBy: 'CDK',
  },
});

// Infrastructure Stack
// This is deployed by the pipeline
new MusicLynxFusekiStack(app, 'MusicLynxFusekiStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: region,
  },
  description: 'MusicLynx Fuseki Triple Store on ECS (Free Tier - eu-north-1)',
  useDefaultVpc: true,
});

app.synth();
