import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { FusekiStage } from './fuseki-stage';

export interface PipelineStackProps extends cdk.StackProps {
  /**
   * GitHub repository owner
   */
  githubOwner: string;

  /**
   * GitHub repository name
   */
  githubRepo: string;

  /**
   * GitHub branch to track
   * @default 'main'
   */
  githubBranch?: string;

  /**
   * GitHub OAuth token stored in Secrets Manager
   * Create with: gh auth token | aws secretsmanager create-secret --name github-token --secret-string file:///dev/stdin
   * @default 'github-token'
   */
  githubTokenSecretName?: string;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const githubBranch = props.githubBranch ?? 'main';
    const githubTokenSecretName = props.githubTokenSecretName ?? 'github-token';

    // Source artifact
    const sourceArtifact = new codepipeline.Artifact('SourceCode');
    const cloudAssemblyArtifact = new codepipeline.Artifact('CloudAssembly');

    // GitHub source action
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'GitHub_Source',
      owner: props.githubOwner,
      repo: props.githubRepo,
      branch: githubBranch,
      oauthToken: cdk.SecretValue.secretsManager(githubTokenSecretName),
      output: sourceArtifact,
      trigger: codepipeline_actions.GitHubTrigger.WEBHOOK,
    });

    // CodeBuild project for building Docker image and TDB database
    const dockerBuildProject = new codebuild.PipelineProject(this, 'DockerBuild', {
      projectName: 'musiclynx-fuseki-docker-build',
      description: 'Build MusicLynx Fuseki Docker image with TDB2 database',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true, // Required for Docker builds
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          AWS_ACCOUNT_ID: {
            value: this.account,
          },
          AWS_DEFAULT_REGION: {
            value: this.region,
          },
        },
      },
      buildSpec: codebuild.BuildSpec.fromSourceFilename('buildspec.yml'),
      cache: codebuild.Cache.local(codebuild.LocalCacheMode.DOCKER_LAYER),
    });

    // Grant permissions to push to ECR
    dockerBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:PutImage',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
        ],
        resources: ['*'],
      })
    );

    // Grant permissions to read TTL files from S3
    dockerBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [
          'arn:aws:s3:::musiclynx-fuseki-data-eu-north-1',
          'arn:aws:s3:::musiclynx-fuseki-data-eu-north-1/*',
        ],
      })
    );

    // CodeBuild project for CDK synth
    const cdkSynthProject = new codebuild.PipelineProject(this, 'CdkSynth', {
      projectName: 'musiclynx-fuseki-cdk-synth',
      description: 'Synthesize CDK CloudFormation templates',
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'cd cdk',
              'npm ci',
            ],
          },
          build: {
            commands: [
              'npm run build',
              'npx cdk synth',
            ],
          },
        },
        artifacts: {
          'base-directory': 'cdk/cdk.out',
          files: ['**/*'],
        },
      }),
    });

    // Pipeline
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'MusicLynxFusekiPipeline',
      restartExecutionOnUpdate: true,
      crossAccountKeys: false, // Not needed for single account
    });

    // Source stage
    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Build stage - Docker image
    pipeline.addStage({
      stageName: 'Build_Docker',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Build_And_Push_Image',
          project: dockerBuildProject,
          input: sourceArtifact,
        }),
      ],
    });

    // Build stage - CDK synth
    pipeline.addStage({
      stageName: 'Build_CDK',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Synth_CloudFormation',
          project: cdkSynthProject,
          input: sourceArtifact,
          outputs: [cloudAssemblyArtifact],
        }),
      ],
    });

    // Deploy stage
    const deployStage = new FusekiStage(this, 'Deploy', {
      env: {
        account: this.account,
        region: this.region,
      },
    });

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipeline_actions.CloudFormationCreateUpdateStackAction({
          actionName: 'Deploy_Infrastructure',
          stackName: 'Deploy-MusicLynxFusekiStack',
          templatePath: cloudAssemblyArtifact.atPath('Deploy-MusicLynxFusekiStack.template.json'),
          adminPermissions: true, // Required for creating IAM roles
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline name',
    });

    new cdk.CfnOutput(this, 'PipelineConsoleUrl', {
      value: `https://${this.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipeline.pipelineName}/view`,
      description: 'CodePipeline console URL',
    });

    // Tag resources
    cdk.Tags.of(this).add('Project', 'MusicLynx');
    cdk.Tags.of(this).add('Component', 'Pipeline');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}
