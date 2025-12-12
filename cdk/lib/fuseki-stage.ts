import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { MusicLynxFusekiStack } from './musiclynx-fuseki-stack';

/**
 * Deployment stage for MusicLynx Fuseki infrastructure
 * This allows the pipeline to deploy the infrastructure stack
 */
export class FusekiStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);

    // Create the Fuseki infrastructure stack
    // The pipeline will automatically deploy this stack
    new MusicLynxFusekiStack(this, 'MusicLynxFusekiStack', {
      description: 'MusicLynx Fuseki Triple Store on ECS (Free Tier - eu-north-1)',
      useDefaultVpc: true,
      // Start with 1 task - the image will be available from the Build stage
      env: props?.env,
    });
  }
}
