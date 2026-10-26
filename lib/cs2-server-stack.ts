import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface Cs2ServerStackProps extends cdk.StackProps {
  /**
   * Server instance type. Compute-optimized recommended (e.g., c6i.xlarge, c6a.xlarge).
   */
  readonly instanceType?: string;

  /**
   * EBS Root Volume size in GB. CS2 requires ~40-50GB.
   * @default 80
   */
  readonly volumeSizeGb?: number;

  /**
   * Steam Game Server Login Token (GSLT).
   * Generate at: https://steamcommunity.com/dev/managegameservers (App ID 730)
   */
  readonly gsltToken?: string;

  /**
   * CS2 Server Hostname.
   * @default 'CS2 Dedicated Server'
   */
  readonly serverName?: string;

  /**
   * Server access password. Leave empty for public access.
   */
  readonly serverPassword?: string;

  /**
   * RCON administrative password.
   * @default 'ChangeMeCS2Rcon123!'
   */
  readonly rconPassword?: string;

  /**
   * Starting map name.
   * @default 'de_dust2'
   */
  readonly startMap?: string;

  /**
   * Maximum concurrent players.
   * @default '10'
   */
  readonly maxPlayers?: string;

  /**
   * Game Mode: 0 = Casual, 1 = Competitive, 2 = Wingman
   * @default '1'
   */
  readonly gameMode?: string;

  /**
   * Game Type: 0 = Classic
   * @default '0'
   */
  readonly gameType?: string;

  /**
   * Optional CIDR block allowed for SSH (port 22). If empty, SSH port is closed and AWS SSM is used.
   */
  readonly sshAllowedCidr?: string;
}

export class Cs2ServerStack extends cdk.Stack {
  public readonly serverPublicIp: string;

  constructor(scope: Construct, id: string, props?: Cs2ServerStackProps) {
    super(scope, id, props);

    // Read config from context with fallback to props or utilitarian defaults
    const serverName = props?.serverName ?? this.node.tryGetContext('serverName') ?? 'CS2 Dedicated Server';
    const serverPassword = props?.serverPassword ?? this.node.tryGetContext('serverPassword') ?? '';
    const rconPassword = props?.rconPassword ?? this.node.tryGetContext('rconPassword') ?? 'ChangeMeCS2Rcon123!';
    const gsltToken = props?.gsltToken ?? this.node.tryGetContext('gsltToken') ?? '';
    const startMap = props?.startMap ?? this.node.tryGetContext('startMap') ?? 'de_dust2';
    const maxPlayers = props?.maxPlayers ?? this.node.tryGetContext('maxPlayers') ?? '10';
    const gameMode = props?.gameMode ?? this.node.tryGetContext('gameMode') ?? '1';
    const gameType = props?.gameType ?? this.node.tryGetContext('gameType') ?? '0';
    const instanceTypeStr = props?.instanceType ?? this.node.tryGetContext('instanceType') ?? 'c6i.xlarge';
    const volumeSizeGb = Number(props?.volumeSizeGb ?? this.node.tryGetContext('volumeSizeGb') ?? 80);
    const sshAllowedCidr = props?.sshAllowedCidr ?? this.node.tryGetContext('sshAllowedCidr');

    // 1. Cost-efficient VPC with Public Subnets only (0 NAT Gateways to avoid useless $32/mo overhead)
    const vpc = new ec2.Vpc(this, 'Cs2Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'PublicSubnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // 2. Security Group with exact CS2 traffic ports
    const securityGroup = new ec2.SecurityGroup(this, 'Cs2SecurityGroup', {
      vpc,
      description: 'Security Group for CS2 Dedicated Server',
      allowAllOutbound: true,
    });

    // CS2 Game Traffic (UDP 27015)
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(27015),
      'CS2 Game Server Port (UDP)'
    );

    // CS2 RCON / Query (TCP 27015)
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(27015),
      'CS2 Server RCON & Query Port (TCP)'
    );

    // GOTV / SourceTV (UDP 27020)
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(27020),
      'CS2 SourceTV / GOTV Port (UDP)'
    );

    // Steam Client Communication (UDP 27005)
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(27005),
      'Steam Client Connection Port (UDP)'
    );

    // Steam Datagram Relay / SDR (UDP 51840)
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(51840),
      'Steam Datagram Relay Port (UDP)'
    );

    // SSH (Optional) - SSM is preferred for secure zero-port shell access
    if (sshAllowedCidr) {
      securityGroup.addIngressRule(
        ec2.Peer.ipv4(sshAllowedCidr),
        ec2.Port.tcp(22),
        'SSH Access'
      );
    }

    // 3. IAM Role with SSM Managed Instance Core (no open SSH port or key pair required)
    const role = new iam.Role(this, 'Cs2ServerRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'IAM Role for CS2 Server EC2 Instance with SSM access',
    });
    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );

    // 4. Amazon Linux 2023 AMI with x86_64 architecture
    const machineImage = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: ec2.AmazonLinuxCpuType.X86_64,
    });

    // 5. UserData script: Installs Docker and executes CS2 dedicated container as systemd unit
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '#!/bin/bash',
      'set -xe',
      'dnf update -y',
      'dnf install -y docker',
      'systemctl enable docker',
      'systemctl start docker',
      'usermod -aG docker ec2-user',
      '',
      'mkdir -p /opt/cs2-data',
      'chmod 777 /opt/cs2-data',
      '',
      'cat <<\'EOF\' > /etc/systemd/system/cs2.service',
      '[Unit]',
      'Description=Counter-Strike 2 Dedicated Server',
      'After=docker.service',
      'Requires=docker.service',
      '',
      '[Service]',
      'TimeoutStartSec=0',
      'Restart=always',
      'RestartSec=10',
      'ExecStartPre=-/usr/bin/docker stop cs2-server',
      'ExecStartPre=-/usr/bin/docker rm cs2-server',
      'ExecStartPre=/usr/bin/docker pull joedrumgoole/cs2-server:latest',
      `ExecStart=/usr/bin/docker run --name cs2-server \\
  --net=host \\
  -v /opt/cs2-data:/home/steam/cs2-dedicated \\
  -e CS2_SERVERNAME="${serverName}" \\
  -e CS2_PW="${serverPassword}" \\
  -e CS2_RCON_PW="${rconPassword}" \\
  -e SRCDS_TOKEN="${gsltToken}" \\
  -e CS2_STARTMAP="${startMap}" \\
  -e CS2_MAXPLAYERS="${maxPlayers}" \\
  -e CS2_GAME_MODE="${gameMode}" \\
  -e CS2_GAME_TYPE="${gameType}" \\
  -e CS2_PORT="27015" \\
  -e CS2_TV_PORT="27020" \\
  joedrumgoole/cs2-server:latest`,
      'ExecStop=/usr/bin/docker stop cs2-server',
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      '',
      'systemctl daemon-reload',
      'systemctl enable cs2.service',
      'systemctl start cs2.service'
    );

    // 6. EC2 Instance
    const instance = new ec2.Instance(this, 'Cs2ServerInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(instanceTypeStr),
      machineImage,
      securityGroup,
      role,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(volumeSizeGb, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: true,
          }),
        },
      ],
    });

    // 7. Static Elastic IP for consistent connection address
    const eip = new ec2.CfnEIP(this, 'Cs2ServerEIP', {
      tags: [
        {
          key: 'Name',
          value: 'CS2 Server Elastic IP',
        },
      ],
    });

    new ec2.CfnEIPAssociation(this, 'Cs2ServerEIPAssociation', {
      instanceId: instance.instanceId,
      allocationId: eip.attrAllocationId,
    });

    this.serverPublicIp = eip.ref;

    // 8. Outputs for instant connection and management
    new cdk.CfnOutput(this, 'ServerPublicIpOutput', {
      value: eip.ref,
      description: 'Static Public IP of the CS2 server',
      exportName: 'Cs2ServerPublicIp',
    });

    new cdk.CfnOutput(this, 'GameConnectCommand', {
      value: `connect ${eip.ref}:27015${serverPassword ? `; password ${serverPassword}` : ''}`,
      description: 'In-game console connect command',
    });

    new cdk.CfnOutput(this, 'SsmSessionCommand', {
      value: `aws ssm start-session --target ${instance.instanceId}`,
      description: 'AWS CLI command to connect directly to server terminal via SSM',
    });
  }
}
