// Kubernetes control plane, functions, serverless containers.
import type { Item, Line, Priced } from '../types';
import { aws, gcp, oci } from '../prices';
import {
  H, awsCost, awsFind, awsRate, gcpCost, gcpFind, gcpRate, line, must, num, ociCost, ociPart, ociRate, opts, priced, str, tierLine,
} from './util';
import type { Ctx, Service } from './util';

// =====================================================================================
// Kubernetes control plane
// =====================================================================================

export const k8s: Service = {
  id: 'k8s',
  label: 'Kubernetes cluster',
  group: 'Compute',
  blurb: 'EKS · GKE · OKE (control plane; add worker VMs separately)',
  defaults: { support: 'standard' },
  fields: [
    { key: 'support', label: 'Version support', type: 'select', options: opts(['standard', 'Standard support'], ['extended', 'Extended support']) },
  ],
  providers: {
    aws: {
      product: 'Amazon EKS',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'eks');
        const ext = str(item.spec, 'support') === 'extended';
        const rate = must(awsRate(awsFind(rows, ext ? 'AmazonEKS-Hours:extendedSupport' : 'AmazonEKS-Hours:perCluster')), 'EKS cluster');
        return priced([line(`EKS cluster${ext ? ', extended support' : ''}`, H * item.qty, 'cluster-hours', rate)], {
          sku: 'EKS control plane', notes: ['Worker nodes are priced as virtual machines.'],
        });
      },
    },
    gcp: {
      product: 'Google Kubernetes Engine',
      price: async (ctx, item) => {
        const g = [...(await gcp.region(ctx.region)), ...(await gcp.global())];
        const ext = str(item.spec, 'support') === 'extended';
        const r = gcpFind(g, ext ? /^Extended Period Kubernetes Clusters$/ : /^Regional Kubernetes Clusters$/, 'OnDemand', 'gke');
        return priced([line(`GKE Standard cluster${ext ? ', extended period' : ''}`, H * item.qty, 'cluster-hours', must(gcpRate(r), 'GKE cluster'))], {
          sku: 'GKE Standard',
        });
      },
    },
    oci: {
      product: 'OCI Kubernetes Engine',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        return priced([line('OKE Enhanced cluster', H * item.qty, 'cluster-hours', must(ociRate(ociPart(rows, 'B96545')), 'OKE cluster'))], {
          sku: 'OKE Enhanced', notes: ['OKE Basic clusters are free but lack add-ons and virtual nodes.'],
        });
      },
    },
  },
};

// =====================================================================================
// Functions
// =====================================================================================

/** Cloud Run functions: vCPU that comes with each memory size (Google's table). */
function gcpFnCpu(mb: number): number {
  if (mb <= 128) return 0.083;
  if (mb <= 256) return 0.167;
  if (mb <= 512) return 0.333;
  if (mb <= 1024) return 0.583;
  if (mb <= 2048) return 1;
  if (mb <= 8192) return 2;
  if (mb <= 16384) return 4;
  return 8;
}

function fnUsage(item: Item) {
  const req = num(item.spec, 'requests', 1_000_000) * item.qty;
  const ms = num(item.spec, 'ms', 200);
  const mb = num(item.spec, 'mb', 512);
  return { req, ms, mb, gbs: req * (ms / 1000) * (mb / 1024) };
}

export const functions: Service = {
  id: 'functions',
  label: 'Functions',
  group: 'Compute',
  blurb: 'Lambda · Cloud Run functions · OCI Functions',
  defaults: { requests: 1_000_000, ms: 200, mb: 512, arch: 'x86' },
  fields: [
    { key: 'requests', label: 'Invocations', type: 'number', unit: '/ month', min: 0, step: 100000 },
    { key: 'ms', label: 'Average duration', type: 'number', unit: 'ms', min: 1, step: 10 },
    { key: 'mb', label: 'Memory', type: 'number', unit: 'MB', min: 128, step: 128 },
    { key: 'arch', label: 'CPU', type: 'select', options: opts(['x86', 'x86'], ['arm', 'Arm']) },
  ],
  providers: {
    aws: {
      product: 'AWS Lambda',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'lambda');
        const { req, gbs } = fnUsage(item);
        const arm = str(item.spec, 'arch') === 'arm';
        const lines: Line[] = [
          line('Requests', req, 'requests', must(awsRate(awsFind(rows, arm ? 'Request-ARM' : 'Request')), 'Lambda requests')),
          tierLine('Compute', gbs, 'GB-seconds', must(awsCost(awsFind(rows, arm ? 'Lambda-GB-Second-ARM' : 'Lambda-GB-Second'), gbs), 'Lambda compute')),
        ];
        return priced(lines, { sku: `Lambda ${arm ? 'Arm' : 'x86'}` });
      },
    },
    gcp: {
      product: 'Cloud Run functions',
      price: async (ctx, item) => {
        const rows = await gcp.region(ctx.region);
        const g = await gcp.global();
        const { req, ms, mb, gbs } = fnUsage(item);
        const cpuS = req * (ms / 1000) * gcpFnCpu(mb);
        const inv = gcpFind([...rows, ...g], /^Cloud Run Functions Invocations$/, 'OnDemand', 'functions');
        const cpu = gcpFind(rows, /^Cloud Run functions CPU \(Request-based billing\) in /, 'OnDemand', 'functions');
        const memR = gcpFind(rows, /^Cloud Run functions Memory \(Request-based billing\) in /, 'OnDemand', 'functions');
        return priced([
          tierLine('Invocations (first 2M free)', req, 'invocations', must(gcpCost(inv, req), 'invocations')),
          line(`CPU (${gcpFnCpu(mb)} vCPU at ${mb} MB)`, cpuS, 'vCPU-seconds', must(gcpRate(cpu), 'functions CPU')),
          line('Memory', gbs, 'GiB-seconds', must(gcpRate(memR), 'functions memory')),
        ], { sku: 'Cloud Run functions, request-based billing' });
      },
    },
    oci: {
      product: 'OCI Functions',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const { req, gbs } = fnUsage(item);
        return priced([
          tierLine('Invocations (first 2M free)', req, 'invocations', must(ociCost(ociPart(rows, 'B90618'), req / 1e6), 'invocations')),
          tierLine('Execution time (first 400,000 GB-s free)', gbs, 'GB-seconds', must(ociCost(ociPart(rows, 'B90617'), gbs / 10000), 'execution time')),
        ], { sku: 'OCI Functions' });
      },
    },
  },
};

// =====================================================================================
// Serverless containers
// =====================================================================================

function ctUsage(item: Item) {
  const tasks = num(item.spec, 'tasks', 2) * item.qty;
  const hrs = Math.min(H, num(item.spec, 'hours', H));
  return { tasks, hrs, vcpu: num(item.spec, 'vcpu', 1), gb: num(item.spec, 'gb', 2) };
}

export const containers: Service = {
  id: 'containers',
  label: 'Serverless containers',
  group: 'Compute',
  blurb: 'Fargate · Cloud Run · OCI Container Instances',
  defaults: { tasks: 2, vcpu: 1, gb: 2, hours: H, arch: 'x86' },
  fields: [
    { key: 'tasks', label: 'Running tasks', type: 'number', min: 1, step: 1 },
    { key: 'vcpu', label: 'vCPU per task', type: 'number', min: 0.25, step: 0.25 },
    { key: 'gb', label: 'Memory per task', type: 'number', unit: 'GB', min: 0.5, step: 0.5 },
    { key: 'hours', label: 'Running hours', type: 'number', unit: 'h / month', min: 0, step: 1 },
    { key: 'arch', label: 'CPU', type: 'select', options: opts(['x86', 'x86'], ['arm', 'Arm']) },
  ],
  providers: {
    aws: {
      product: 'AWS Fargate',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'fargate');
        const { tasks, hrs, vcpu, gb } = ctUsage(item);
        const arm = str(item.spec, 'arch') === 'arm';
        return priced([
          line('vCPU', tasks * vcpu * hrs, 'vCPU-hours', must(awsRate(awsFind(rows, arm ? 'Fargate-ARM-vCPU-Hours:perCPU' : 'Fargate-vCPU-Hours:perCPU')), 'Fargate vCPU')),
          line('Memory', tasks * gb * hrs, 'GB-hours', must(awsRate(awsFind(rows, arm ? 'Fargate-ARM-GB-Hours' : 'Fargate-GB-Hours')), 'Fargate memory')),
        ], { sku: `Fargate Linux ${arm ? 'Arm' : 'x86'}` });
      },
    },
    gcp: {
      product: 'Cloud Run',
      price: async (ctx, item) => {
        const rows = await gcp.region(ctx.region);
        const { tasks, hrs, vcpu, gb } = ctUsage(item);
        const s = tasks * hrs * 3600;
        return priced([
          line('vCPU (instance-based billing)', s * vcpu, 'vCPU-seconds', must(gcpRate(gcpFind(rows, /^Services CPU \(Instance-based billing\) in /, 'OnDemand', 'run')), 'Cloud Run CPU')),
          line('Memory (instance-based billing)', s * gb, 'GiB-seconds', must(gcpRate(gcpFind(rows, /^Services Memory \(Instance-based billing\) in /, 'OnDemand', 'run')), 'Cloud Run memory')),
        ], { sku: 'Cloud Run service, instance-based billing' });
      },
    },
    oci: {
      product: 'OCI Container Instances',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const { tasks, hrs, vcpu, gb } = ctUsage(item);
        const ocpu = Math.max(1, Math.ceil(vcpu / 2));
        return priced([
          line(`E4 OCPU (${ocpu} per container)`, tasks * ocpu * hrs, 'OCPU-hours', must(ociRate(ociPart(rows, 'B93113')), 'E4 OCPU')),
          line('Memory', tasks * gb * hrs, 'GB-hours', must(ociRate(ociPart(rows, 'B93114')), 'E4 memory')),
        ], { sku: 'Container Instances on E4 Flex', notes: ['OCI bills container instances at the shape price; 1 OCPU = 2 vCPU.'] });
      },
    },
  },
};
