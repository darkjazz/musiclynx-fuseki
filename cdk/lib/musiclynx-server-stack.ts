import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface MusicLynxServerStackProps extends cdk.StackProps {
  dbEndpoint: string;
  dbPort: string;
  dbName: string;
  dbSecretArn: string;
}

export class MusicLynxServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MusicLynxServerStackProps) {
    super(scope, id, props);

    const { dbEndpoint, dbPort, dbName, dbSecretArn } = props;

    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });

    // ECR repository
    const repository = new ecr.Repository(this, 'MusicLynxServerRepo', {
      repositoryName: 'musiclynx-server',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ECS cluster
    const cluster = new ecs.Cluster(this, 'MusicLynxCluster', {
      clusterName: 'musiclynx',
      vpc,
    });

    // Security group for EC2 instance
    const instanceSg = new ec2.SecurityGroup(this, 'InstanceSecurityGroup', {
      vpc,
      description: 'Security group for MusicLynx server',
      allowAllOutbound: true,
    });
    instanceSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8080), 'HTTP');
    instanceSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH');

    // EC2 capacity - t3.micro, always 1 instance (no cold starts)
    const asg = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 1,
      maxCapacity: 1,
      securityGroup: instanceSg,
    });

    const capacityProvider = new ecs.AsgCapacityProvider(this, 'AsgCapacityProvider', {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
    });
    cluster.addAsgCapacityProvider(capacityProvider);

    // DB secret reference for injecting credentials into the container
    const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DBSecret', dbSecretArn);

    // CloudWatch logs - 1 week retention
    const logGroup = new logs.LogGroup(this, 'ServerLogGroup', {
      logGroupName: '/ecs/musiclynx-server',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task definition
    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'ServerTaskDef');
    dbSecret.grantRead(taskDefinition.taskRole);

    taskDefinition.addContainer('musiclynx-server', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      memoryReservationMiB: 896,
      cpu: 1024,
      environment: {
        NODE_ENV: 'production',
        PORT: '8080',
        USE_POSTGRES: 'true',
        DB_HOST: dbEndpoint,
        DB_PORT: dbPort,
        DB_NAME: dbName,
        AB_DB_HOST: dbEndpoint,
        AB_DB_PORT: dbPort,
        AB_DB_NAME: 'acousticbrainz',
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        AB_DB_USERNAME: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        AB_DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'musiclynx-server',
        logGroup,
      }),
      portMappings: [{ containerPort: 8080, hostPort: 8080 }],
    });

    // ECS service
    new ecs.Ec2Service(this, 'MusicLynxService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
    });

    // Outputs
    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR repository URI — use this to push the server image',
      exportName: 'MusicLynxServerEcrUri',
    });

    cdk.Tags.of(this).add('Project', 'MusicLynx');
    cdk.Tags.of(this).add('Component', 'Server');
    cdk.Tags.of(this).add('Environment', 'Production');
  }
}
