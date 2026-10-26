#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Cs2ServerStack } from '../lib/cs2-server-stack';

const app = new cdk.App();

new Cs2ServerStack(app, 'Cs2ServerStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-central-1',
  },
  description: 'CS2 Dedicated Server on EC2 with minimal latency and high cost efficiency',
});
