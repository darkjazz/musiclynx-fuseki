import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface MusicLynxRdsStackProps extends cdk.StackProps {
  /**
   * Use default VPC instead of creating a new one
   * @default true
   */
  useDefaultVpc?: boolean;

  /**
   * Database name
   * @default 'musiclynx'
   */
  databaseName?: string;

  /**
   * Master username
   * @default 'musiclynx_admin'
   */
  masterUsername?: string;
}

export class MusicLynxRdsStack extends cdk.Stack {
  public readonly database: rds.DatabaseInstance;
  public readonly databaseSecret: secretsmanager.ISecret;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: MusicLynxRdsStackProps) {
    super(scope, id, props);

    const useDefaultVpc = props?.useDefaultVpc ?? true;
    const databaseName = props?.databaseName ?? 'musiclynx';
    const masterUsername = props?.masterUsername ?? 'musiclynx_admin';

    // VPC - use default or create new
    const vpc = useDefaultVpc
      ? ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true })
      : new ec2.Vpc(this, 'MusicLynxVPC', {
          maxAzs: 2,
          natGateways: 0,
          subnetConfiguration: [
            {
              cidrMask: 24,
              name: 'Public',
              subnetType: ec2.SubnetType.PUBLIC,
            },
          ],
        });

    // Security Group for RDS
    this.securityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc,
      description: 'Security group for MusicLynx RDS PostgreSQL',
      allowAllOutbound: true,
    });

    // Allow PostgreSQL access from anywhere (adjust for production)
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access'
    );

    // Create database credentials secret
    this.databaseSecret = new secretsmanager.Secret(this, 'DBCredentials', {
      secretName: 'musiclynx-db-credentials',
      description: 'MusicLynx PostgreSQL database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: masterUsername }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // RDS PostgreSQL Instance - Free Tier Eligible
    this.database = new rds.DatabaseInstance(this, 'MusicLynxDB', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO // Free tier eligible
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Public for easy access
      },
      securityGroups: [this.securityGroup],
      databaseName,
      credentials: rds.Credentials.fromSecret(this.databaseSecret),
      allocatedStorage: 20, // Free tier: up to 20 GB
      maxAllocatedStorage: 20, // Prevent auto-scaling beyond free tier
      storageType: rds.StorageType.GP2,
      publiclyAccessible: true, // For initial data load from local machine
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT, // Create snapshot on delete
      backupRetention: cdk.Duration.days(7), // Free tier: up to 7 days
      multiAz: false, // Single AZ for free tier
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: false, // Costs extra
      cloudwatchLogsExports: ['postgresql'], // Export logs to CloudWatch
      preferredBackupWindow: '03:00-04:00', // 3-4 AM UTC
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00', // Sunday 4-5 AM UTC
    });

    // Outputs
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.dbInstanceEndpointAddress,
      description: 'RDS PostgreSQL endpoint address',
      exportName: 'MusicLynxDatabaseEndpoint',
    });

    new cdk.CfnOutput(this, 'DatabasePort', {
      value: this.database.dbInstanceEndpointPort,
      description: 'RDS PostgreSQL port',
      exportName: 'MusicLynxDatabasePort',
    });

    new cdk.CfnOutput(this, 'DatabaseName', {
      value: databaseName,
      description: 'Database name',
      exportName: 'MusicLynxDatabaseName',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseSecret.secretArn,
      description: 'ARN of the secret containing database credentials',
      exportName: 'MusicLynxDatabaseSecretArn',
    });

    new cdk.CfnOutput(this, 'ConnectionString', {
      value: `psql -h ${this.database.dbInstanceEndpointAddress} -p ${this.database.dbInstanceEndpointPort} -U ${masterUsername} -d ${databaseName}`,
      description: 'PostgreSQL connection command (get password from Secrets Manager)',
    });

    new cdk.CfnOutput(this, 'GetPasswordCommand', {
      value: `aws secretsmanager get-secret-value --secret-id ${this.databaseSecret.secretName} --query SecretString --output text | jq -r .password`,
      description: 'Command to retrieve database password',
    });

    // Tag resources for cost tracking
    cdk.Tags.of(this).add('Project', 'MusicLynx');
    cdk.Tags.of(this).add('Component', 'Database');
    cdk.Tags.of(this).add('Environment', 'Production');
  }
}
