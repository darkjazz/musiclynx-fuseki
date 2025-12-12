import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import { Construct } from 'constructs';

export interface MusicLynxFusekiStackProps extends cdk.StackProps {
  /**
   * Use default VPC instead of creating a new one
   * @default true
   */
  useDefaultVpc?: boolean;

  /**
   * Admin password for Fuseki
   * @default 'changeme'
   */
  adminPassword?: string;

  /**
   * Instance type for ECS EC2 instances
   * @default 't3.micro' (free tier eligible)
   */
  instanceType?: ec2.InstanceType;
}

export class MusicLynxFusekiStack extends cdk.Stack {
  public readonly ecrRepository: ecr.Repository;
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.Ec2Service;
  public readonly loadBalancerDnsName: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props?: MusicLynxFusekiStackProps) {
    super(scope, id, props);

    const useDefaultVpc = props?.useDefaultVpc ?? true;
    const adminPassword = props?.adminPassword ?? 'changeme';
    const instanceType = props?.instanceType ?? ec2.InstanceType.of(
      ec2.InstanceClass.T3,
      ec2.InstanceSize.MICRO
    );

    // VPC - use default or create new
    const vpc = useDefaultVpc
      ? ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true })
      : new ec2.Vpc(this, 'MusicLynxVPC', {
          maxAzs: 2,
          natGateways: 0, // No NAT gateway to stay in free tier
          subnetConfiguration: [
            {
              cidrMask: 24,
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
            },
          ],
        });

    // ECR Repository
    this.ecrRepository = new ecr.Repository(this, 'FusekiRepository', {
      repositoryName: 'musiclynx-fuseki',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      emptyOnDelete: true, // Clean up images on stack deletion
      lifecycleRules: [
        {
          description: 'Keep last 3 images',
          maxImageCount: 3,
        },
      ],
    });

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'MusicLynxCluster', {
      vpc,
      clusterName: 'musiclynx-cluster',
      containerInsights: false, // Disable to save costs
    });

    // Security Group for ECS instances
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Security group for MusicLynx Fuseki ECS instances',
      allowAllOutbound: true,
    });

    // Allow Fuseki port from anywhere (adjust for production)
    ecsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3030),
      'Allow Fuseki SPARQL endpoint access'
    );

    // Allow SSH for debugging (optional, remove for production)
    ecsSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH access for debugging'
    );

    // IAM Role for EC2 instances
    const ecsInstanceRole = new iam.Role(this, 'EcsInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'), // For Systems Manager access
      ],
    });

    // Auto Scaling Group for ECS EC2 instances
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'EcsAsg', {
      vpc,
      instanceType,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      securityGroup: ecsSecurityGroup,
      role: ecsInstanceRole,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, // Public subnets for free tier
      associatePublicIpAddress: true,
    });

    // Add capacity provider to cluster
    const capacityProvider = new ecs.AsgCapacityProvider(this, 'AsgCapacityProvider', {
      autoScalingGroup,
      enableManagedTerminationProtection: false,
    });

    this.cluster.addAsgCapacityProvider(capacityProvider);

    // CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, 'FusekiLogGroup', {
      logGroupName: '/ecs/musiclynx-fuseki',
      retention: logs.RetentionDays.ONE_WEEK, // Adjust as needed
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task Definition
    const taskDefinition = new ecs.Ec2TaskDefinition(this, 'FusekiTaskDef', {
      networkMode: ecs.NetworkMode.BRIDGE,
    });

    // Container Definition
    const container = taskDefinition.addContainer('fuseki', {
      image: ecs.ContainerImage.fromEcrRepository(this.ecrRepository, 'latest'),
      memoryReservationMiB: 896,
      cpu: 1024,
      environment: {
        ADMIN_PASSWORD: adminPassword,
        JVM_ARGS: '-Xmx768m -Xms512m',
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'fuseki',
        logGroup,
      }),
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3030/$/ping || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    container.addPortMappings({
      containerPort: 3030,
      hostPort: 3030,
      protocol: ecs.Protocol.TCP,
    });

    // Get desired count from context (allows starting with 0 tasks until image is ready)
    const desiredCountContext = this.node.tryGetContext('desiredCount');
    const desiredCount = desiredCountContext !== undefined ? Number(desiredCountContext) : 0;

    // ECS Service
    this.service = new ecs.Ec2Service(this, 'FusekiService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: desiredCount,
      serviceName: 'musiclynx-fuseki-service',
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
        },
      ],
      // Don't wait for service to stabilize during deployment
      // This prevents getting stuck when image doesn't exist yet
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'ECRRepositoryUri', {
      value: this.ecrRepository.repositoryUri,
      description: 'ECR Repository URI for pushing Docker images',
      exportName: 'MusicLynxFusekiECRUri',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS Cluster name',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: this.service.serviceName,
      description: 'ECS Service name',
    });

    new cdk.CfnOutput(this, 'FusekiEndpointInstructions', {
      value: 'Get EC2 public IP: aws ec2 describe-instances --filters "Name=tag:aws:autoscaling:groupName,Values=' +
        autoScalingGroup.autoScalingGroupName +
        '" --query "Reservations[0].Instances[0].PublicIpAddress" --output text',
      description: 'Command to get the Fuseki endpoint IP address',
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch Log Group for Fuseki logs',
    });

    // Tag resources for cost tracking
    cdk.Tags.of(this).add('Project', 'MusicLynx');
    cdk.Tags.of(this).add('Component', 'Fuseki');
    cdk.Tags.of(this).add('Environment', 'Production');
  }
}
