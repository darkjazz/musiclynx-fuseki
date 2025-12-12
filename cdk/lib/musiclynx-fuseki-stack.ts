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

    // Create Launch Template with T3 Unlimited for consistent performance
    const launchTemplate = new ec2.LaunchTemplate(this, 'EcsLaunchTemplate', {
      instanceType,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(),
      securityGroup: ecsSecurityGroup,
      role: ecsInstanceRole,
      userData: ec2.UserData.forLinux(),
    });

    // Add ECS cluster configuration to user data
    const userData = launchTemplate.userData;
    if (userData) {
      userData.addCommands(
        `echo ECS_CLUSTER=${this.cluster.clusterName} >> /etc/ecs/ecs.config`
      );
    }

    // Enable T3 Unlimited using CloudFormation escape hatch
    // This prevents query slowdowns when CPU credits are exhausted
    // Charges only for CPU usage beyond baseline (typically <$1/month for this workload)
    const cfnLaunchTemplate = launchTemplate.node.defaultChild as ec2.CfnLaunchTemplate;
    cfnLaunchTemplate.launchTemplateData = {
      ...cfnLaunchTemplate.launchTemplateData,
      creditSpecification: {
        cpuCredits: 'unlimited',
      },
    };

    // Auto Scaling Group for ECS EC2 instances
    const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'EcsAsg', {
      vpc,
      launchTemplate,
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, // Public subnets for free tier
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

    // Grant S3 read access to download TTL files at runtime
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:ListBucket'],
        resources: [
          'arn:aws:s3:::musiclynx-fuseki-data-eu-north-1',
          'arn:aws:s3:::musiclynx-fuseki-data-eu-north-1/*',
        ],
      })
    );

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

    // ECS Service
    // The pipeline ensures the Docker image exists before deploying this stack
    this.service = new ecs.Ec2Service(this, 'FusekiService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 1, // Pipeline ensures image exists first
      serviceName: 'musiclynx-fuseki-service',
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
        },
      ],
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
