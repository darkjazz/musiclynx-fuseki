#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineStack } from '../lib/pipeline-stack';

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

app.synth();
