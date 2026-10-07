// WAF, DDoS protection, API gateway, queues, notifications, monitoring, custom lines.
import type { Item, Line, Priced } from '../types';
import { aws, gcp, oci } from '../prices';
import {
  awsCost, awsFind, awsRate, gcpCost, gcpFind, gcpRate, line, must, num, ociCost, ociPart, ociRate, opts, priced, str,
  tierLine, yesNo,
} from './util';
import type { Ctx, Service } from './util';

// =====================================================================================
// WAF
// =====================================================================================

export const waf: Service = {
  id: 'waf',
  label: 'Web application firewall',
  group: 'Security',
  blurb: 'AWS WAF · Cloud Armor · OCI WAF',
  defaults: { acls: 1, rules: 10, requests: 10_000_000 },
  fields: [
    { key: 'acls', label: 'Web ACLs / policies', type: 'number', min: 1, step: 1 },
    { key: 'rules', label: 'Rules', type: 'number', min: 0, step: 1 },
    { key: 'requests', label: 'Requests', type: 'number', unit: '/ month', min: 0, step: 1000000 },
  ],
  providers: {
    aws: {
      product: 'AWS WAF',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'waf');
        const q = item.qty;
        return priced([
          line('Web ACLs', num(item.spec, 'acls', 1) * q, 'ACL-months', must(awsRate(awsFind(rows, 'WebACL')), 'web ACL')),
          line('Rules', num(item.spec, 'rules', 0) * q, 'rule-months', must(awsRate(awsFind(rows, 'Rule')), 'WAF rule')),
          line('Requests', num(item.spec, 'requests', 0) * q, 'requests', must(awsRate(awsFind(rows, 'Request')), 'WAF requests')),
        ], { sku: 'AWS WAF', notes: ['Managed rule groups from AWS Marketplace and Bot Control are extra.'] });
      },
    },
    gcp: {
      product: 'Cloud Armor Standard',
      price: async (ctx, item) => {
        const rows = [...(await gcp.region(ctx.region)), ...(await gcp.global())];
        const q = item.qty;
        return priced([
          line('Security policies', num(item.spec, 'acls', 1) * q, 'policy-months', must(gcpRate(gcpFind(rows, /^Networking Cloud Armor Policy$/)), 'Armor policy')),
          line('Rules', num(item.spec, 'rules', 0) * q, 'rule-months', must(gcpRate(gcpFind(rows, /^Networking Cloud Armor Rule$/)), 'Armor rule')),
          line('Requests', num(item.spec, 'requests', 0) * q, 'requests', must(gcpRate(gcpFind(rows, /^Networking Cloud Armor Requests$/)), 'Armor requests')),
        ], { sku: 'Cloud Armor Standard' });
      },
    },
    oci: {
      product: 'OCI Web Application Firewall',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const q = item.qty;
        const acls = num(item.spec, 'acls', 1) * q;
        const req = num(item.spec, 'requests', 0) * q;
        return priced([
          tierLine('WAF policies (first one free)', acls, 'policy-months', must(ociCost(ociPart(rows, 'B94579'), acls), 'WAF instance')),
          tierLine('Requests (first 10M free)', req, 'requests', must(ociCost(ociPart(rows, 'B94277'), req / 1e6), 'WAF requests')),
        ], { sku: 'OCI WAF', notes: ['OCI does not charge per rule.'] });
      },
    },
  },
};

// =====================================================================================
// DDoS protection (Shield Advanced)
// =====================================================================================

/** Whether this DDoS card carries the organization-wide subscription: a card on its own
 *  does; one inside a resource does only when the SA says so. */
export function subscribed(item: Item): boolean {
  return !str(item.spec, 'on') || str(item.spec, 'sub') === 'yes';
}

export const ddos: Service = {
  id: 'ddos',
  label: 'DDoS protection (advanced)',
  group: 'Security',
  blurb: 'Shield Advanced · Cloud Armor Enterprise · included on OCI',
  defaults: { resources: 2, gb: 1000 },
  fields: [
    { key: 'resources', label: 'Protected resources', type: 'number', min: 1, step: 1, show: (s) => !s.on },
    { key: 'gb', label: 'Data out from protected resources', type: 'number', unit: 'GB / month', min: 0, step: 100 },
    {
      key: 'sub', label: 'Include the subscription on this card', type: 'select', options: yesNo, show: (s) => !!s.on,
      help: 'AWS Shield Advanced and Cloud Armor Enterprise charge one subscription for the whole organization. Keep it on one card only.',
    },
  ],
  providers: {
    aws: {
      product: 'AWS Shield Advanced',
      price: async (ctx, item) => {
        const g = await aws.global('shield');
        const rows = await aws.rows(ctx.region, 'shield');
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const fee = must(awsRate(awsFind(g, 'Shield-Monthly-Fee')), 'Shield subscription');
        const lines: Line[] = [];
        if (subscribed(item)) lines.push(line('Shield Advanced subscription', item.qty, 'months', fee));
        // Shield bills data out by the kind of resource it protects.
        const on = str(item.spec, 'on');
        const dt = on === 'cdn'
          ? awsFind(g, 'Global-DataTransfer-Shield-Bytes', 'CloudFrontDistribution')
          : awsFind(rows, 'DataTransfer-Shield-Bytes', on === 'ip' ? 'ShieldProtectionEIP' : 'LoadBalancing');
        if (gb) lines.push(tierLine('Data out from protected resources', gb, 'GB', must(awsCost(dt, gb), 'Shield data transfer')));
        const notes = subscribed(item)
          ? ['The subscription covers the whole AWS Organization and needs a one-year commitment. Add it once per organization.']
          : ['Protection of this resource only; the organization-wide subscription is on another card.'];
        return priced(lines, { sku: 'Shield Advanced', notes });
      },
    },
    gcp: {
      product: 'Cloud Armor Enterprise',
      price: async (ctx, item) => {
        const rows = [...(await gcp.region(ctx.region)), ...(await gcp.global())];
        const attached = !!str(item.spec, 'on');
        const res = (attached ? 1 : num(item.spec, 'resources', 2)) * item.qty;
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const cdnOn = str(item.spec, 'on') === 'cdn';
        const protectedRow = gcpFind(rows, /^Networking Cloud Armor Enterprise Paygo: Protected Resource$/);
        const lines: Line[] = [];
        if (subscribed(item)) lines.push(line('Enterprise pay-as-you-go enrolment', item.qty, 'months', must(gcpRate(gcpFind(rows, /^Networking Cloud Armor Enterprise Paygo: Enrollment$/)), 'Armor Enterprise enrolment')));
        // The enrolment includes two protected resources; a resource card on its own pays the full rate.
        lines.push(attached
          ? line('Protected resource', res, 'resource-months', must(gcpRate(protectedRow), 'protected resources'))
          : tierLine('Protected resources (first 2 included)', res, 'resource-months', must(gcpCost(protectedRow, res), 'protected resources')));
        const fee = cdnOn ? /^Networking Cloud Armor Enterprise Paygo: Data Processing Fee for CDN$/ : /^Networking Cloud Armor Enterprise Paygo: Data Processing Fee for Load Balancer$/;
        lines.push(tierLine('Data processing', gb, 'GiB', must(gcpCost(gcpFind(rows, fee), gb), 'Armor data processing')));
        return priced(lines, { sku: 'Cloud Armor Enterprise, pay as you go' });
      },
    },
    oci: {
      product: 'OCI DDoS protection',
      price: async () => priced([line('Layer 3/4 DDoS protection', 1, 'each', 0)], { sku: 'OCI DDoS protection', notes: ['OCI includes DDoS protection for every tenancy at no charge.'] }),
    },
  },
};

// =====================================================================================
// API gateway
// =====================================================================================

export const apigw: Service = {
  id: 'apigw',
  label: 'API gateway',
  group: 'Integration',
  blurb: 'API Gateway · API Gateway · API Gateway',
  defaults: { type: 'rest', requests: 10_000_000 },
  fields: [
    { key: 'type', label: 'API type', type: 'select', options: opts(['rest', 'REST'], ['http', 'HTTP (lighter)']) },
    { key: 'requests', label: 'Requests', type: 'number', unit: '/ month', min: 0, step: 1000000 },
  ],
  providers: {
    aws: {
      product: 'Amazon API Gateway',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'apigw');
        const http = str(item.spec, 'type') === 'http';
        const req = num(item.spec, 'requests', 0) * item.qty;
        return priced([tierLine(`${http ? 'HTTP' : 'REST'} API requests`, req, 'requests', must(awsCost(awsFind(rows, http ? 'ApiGatewayHttpRequest' : 'ApiGatewayRequest'), req), 'API requests'))], {
          sku: `API Gateway ${http ? 'HTTP' : 'REST'} API`,
        });
      },
    },
    gcp: {
      product: 'API Gateway',
      price: async (_ctx, item) => {
        // Google's price feed has no SKU for API Gateway calls; these are the published
        // rates from cloud.google.com/api-gateway/pricing: first 2M calls free, then
        // $3.00 per million up to 1B, then $1.50 per million.
        const req = num(item.spec, 'requests', 0) * item.qty;
        const cost = Math.max(0, Math.min(req, 1e9) - 2e6) * 3e-6 + Math.max(0, req - 1e9) * 1.5e-6;
        return priced([tierLine('API calls (first 2M free)', req, 'calls', cost)], {
          sku: 'API Gateway', notes: ['Rate from Google\'s published API Gateway price page; not refreshed daily.'],
        });
      },
    },
    oci: {
      product: 'OCI API Gateway',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const req = num(item.spec, 'requests', 0) * item.qty;
        return priced([line('API calls', req, 'calls', must(ociRate(ociPart(rows, 'B92072')), 'API calls') / 1e6)], { sku: 'OCI API Gateway' });
      },
    },
  },
};

// =====================================================================================
// Message queue
// =====================================================================================

export const queue: Service = {
  id: 'queue',
  label: 'Message queue',
  group: 'Integration',
  blurb: 'SQS · Pub/Sub · OCI Queue',
  defaults: { type: 'standard', requests: 10_000_000, kb: 4 },
  fields: [
    { key: 'type', label: 'Queue type', type: 'select', options: opts(['standard', 'Standard'], ['fifo', 'FIFO (ordered)']) },
    { key: 'requests', label: 'Requests', type: 'number', unit: '/ month', min: 0, step: 1000000, help: 'Send, receive and delete each count as a request.' },
    { key: 'kb', label: 'Average message size', type: 'number', unit: 'KB', min: 1, step: 1 },
  ],
  providers: {
    aws: {
      product: 'Amazon SQS',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'sqs');
        const fifo = str(item.spec, 'type') === 'fifo';
        const req = num(item.spec, 'requests', 0) * item.qty * Math.ceil(num(item.spec, 'kb', 4) / 64);
        // us-east-1 names its request rows -RBP; the other regions name them -Tier1.
        return priced([tierLine(`${fifo ? 'FIFO' : 'Standard'} requests (64 KB chunks)`, req, 'requests', must(awsCost(awsFind(rows, fifo ? 'Requests-FIFO-Tier1' : 'Requests-Tier1') ?? awsFind(rows, fifo ? 'Requests-FIFO-RBP' : 'Requests-RBP'), req), 'SQS requests'))], {
          sku: `SQS ${fifo ? 'FIFO' : 'Standard'}`,
        });
      },
    },
    gcp: {
      product: 'Pub/Sub',
      price: async (_ctx, item) => {
        const g = await gcp.global();
        // Pub/Sub bills throughput: publish plus delivery, at least 1 KB per message.
        const msgs = (num(item.spec, 'requests', 0) / 3) * item.qty;
        const tib = (msgs * Math.max(1, num(item.spec, 'kb', 4)) * 2 * 1000) / 1024 ** 4;
        return priced([tierLine('Message throughput (first 10 GiB free)', tib, 'TiB', must(gcpCost(gcpFind(g, /^Message Delivery Basic$/, 'OnDemand', 'pubsub'), tib), 'Pub/Sub throughput'))], {
          sku: 'Pub/Sub', notes: ['Requests are converted to messages at three requests (send, receive, delete) per message.'],
        });
      },
    },
    oci: {
      product: 'OCI Queue',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const req = num(item.spec, 'requests', 0) * item.qty;
        return priced([tierLine('Requests (first 1M free)', req, 'requests', must(ociCost(ociPart(rows, 'B95697'), req / 1e6), 'Queue requests'))], { sku: 'OCI Queue' });
      },
    },
  },
};

// =====================================================================================
// Notifications
// =====================================================================================

export const notify: Service = {
  id: 'notify',
  label: 'Notifications (pub/sub topics)',
  group: 'Integration',
  blurb: 'SNS · Pub/Sub · OCI Notifications',
  defaults: { publishes: 1_000_000, http: 1_000_000, email: 10000 },
  fields: [
    { key: 'publishes', label: 'Messages published', type: 'number', unit: '/ month', min: 0, step: 100000 },
    { key: 'http', label: 'HTTP/S deliveries', type: 'number', unit: '/ month', min: 0, step: 100000 },
    { key: 'email', label: 'Email deliveries', type: 'number', unit: '/ month', min: 0, step: 1000 },
  ],
  providers: {
    aws: {
      product: 'Amazon SNS',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'sns');
        const q = item.qty;
        const p = num(item.spec, 'publishes', 0) * q, h = num(item.spec, 'http', 0) * q, e = num(item.spec, 'email', 0) * q;
        return priced([
          tierLine('Publish requests', p, 'requests', must(awsCost(awsFind(rows, 'Requests-Tier1'), p), 'SNS requests')),
          tierLine('HTTP/S deliveries', h, 'deliveries', must(awsCost(awsFind(rows, 'DeliveryAttempts-HTTP'), h), 'SNS HTTP')),
          tierLine('Email deliveries', e, 'deliveries', must(awsCost(awsFind(rows, 'DeliveryAttempts-SMTP'), e), 'SNS email')),
        ], { sku: 'SNS Standard topic' });
      },
    },
    gcp: {
      product: 'Pub/Sub',
      price: async (_ctx, item) => {
        const g = await gcp.global();
        const msgs = (num(item.spec, 'publishes', 0) + num(item.spec, 'http', 0)) * item.qty;
        const tib = (msgs * 1000) / 1024 ** 4;
        return priced([tierLine('Message throughput (1 KB minimum per message)', tib, 'TiB', must(gcpCost(gcpFind(g, /^Message Delivery Basic$/, 'OnDemand', 'pubsub'), tib), 'Pub/Sub throughput'))], {
          sku: 'Pub/Sub push subscription', notes: ['Google Cloud has no managed email delivery; email lines are not priced.'],
        });
      },
    },
    oci: {
      product: 'OCI Notifications',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const h = num(item.spec, 'http', 0) * item.qty, e = num(item.spec, 'email', 0) * item.qty;
        return priced([
          tierLine('HTTPS deliveries (first 1M free)', h, 'deliveries', must(ociCost(ociPart(rows, 'B90940'), h / 1e6), 'HTTPS delivery')),
          tierLine('Email deliveries (first 1,000 free)', e, 'emails', must(ociCost(ociPart(rows, 'B90941'), e / 1000), 'email delivery')),
        ], { sku: 'OCI Notifications', notes: ['Publishing to a topic has no charge.'] });
      },
    },
  },
};

// =====================================================================================
// Monitoring and logs
// =====================================================================================

/** One time series written every minute is 43,800 points a month. */
export const POINTS = 43_800;

export const monitoring: Service = {
  id: 'monitoring',
  label: 'Monitoring and logs',
  group: 'Operations',
  blurb: 'CloudWatch · Cloud Monitoring and Logging · OCI Monitoring and Logging',
  defaults: { metrics: 50, alarms: 20, logs: 50, stored: 100 },
  fields: [
    { key: 'metrics', label: 'Custom metrics', type: 'number', min: 0, step: 10, help: 'Built-in VM, database and load balancer metrics are free on all three clouds.' },
    { key: 'alarms', label: 'Alarms', type: 'number', min: 0, step: 1 },
    { key: 'logs', label: 'Logs ingested', type: 'number', unit: 'GB / month', min: 0, step: 10 },
    { key: 'stored', label: 'Logs stored', type: 'number', unit: 'GB', min: 0, step: 10 },
  ],
  providers: {
    aws: {
      product: 'Amazon CloudWatch',
      price: async (ctx, item) => {
        const rows = await aws.rows(ctx.region, 'cloudwatch');
        const q = item.qty;
        const m = num(item.spec, 'metrics', 0) * q, a = num(item.spec, 'alarms', 0) * q, l = num(item.spec, 'logs', 0) * q, s = num(item.spec, 'stored', 0) * q;
        return priced([
          tierLine('Custom metrics', m, 'metrics', must(awsCost(awsFind(rows, 'CW:MetricMonitorUsage'), m), 'metrics')),
          line('Standard alarms', a, 'alarms', must(awsRate(awsFind(rows, 'CW:AlarmMonitorUsage')), 'alarms')),
          line('Logs ingested', l, 'GB', must(awsRate(awsFind(rows, 'DataProcessing-Bytes', 'PutLogEvents')), 'log ingestion')),
          line('Logs stored', s, 'GB-month', must(awsRate(awsFind(rows, 'TimedStorage-ByteHrs')), 'log storage')),
        ], { sku: 'CloudWatch' });
      },
    },
    gcp: {
      product: 'Cloud Monitoring and Logging',
      price: async (_ctx, item) => {
        const g = await gcp.global();
        const q = item.qty;
        const mib = (num(item.spec, 'metrics', 0) * POINTS * 8 * q) / 1024 ** 2;
        const l = num(item.spec, 'logs', 0) * q, s = num(item.spec, 'stored', 0) * q, a = num(item.spec, 'alarms', 0) * q;
        // Google starts charging for alerting policies on 1 Sep 2027 (cloud.google.com/products/observability/pricing):
        // $0.35 a month per metric reference, plus $0.50 per million points the conditions read.
        const lines = [
          tierLine('Custom metric volume (first 150 MiB free)', mib, 'MiB', must(gcpCost(gcpFind(g, /^Metric Volume$/, 'OnDemand', 'monitoring'), mib), 'metric volume')),
          tierLine('Logs ingested (first 50 GiB free)', l, 'GiB', must(gcpCost(gcpFind(g, /^Log Storage cost$/, 'OnDemand', 'logging'), l), 'log ingestion')),
          line('Logs kept past 30 days', s, 'GiB-month', must(gcpRate(gcpFind(g, /^Log Retention cost$/, 'OnDemand', 'logging')), 'log retention')),
        ];
        const notes = ['Metric volume assumes one point a minute, 8 bytes each.'];
        if (a) {
          lines.push(line('Alerting policies (no charge until 1 Sep 2027)', a, 'policies', 0));
          notes.push(`From 1 Sep 2027 Google charges $0.35 a month per metric in an alerting policy: about $${(a * 0.35).toFixed(2)} a month for ${a} single-metric policies, plus $0.50 per million points read.`);
        }
        return priced(lines, { sku: 'Cloud Monitoring + Cloud Logging', notes });
      },
    },
    oci: {
      product: 'OCI Monitoring and Logging',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const q = item.qty;
        const pts = (num(item.spec, 'metrics', 0) * POINTS * q) / 1e6;
        const s = num(item.spec, 'stored', 0) * q;
        return priced([
          tierLine('Metric data points (first 500M free)', pts, 'million points', must(ociCost(ociPart(rows, 'B90925'), pts), 'monitoring ingestion')),
          tierLine('Log storage (first 10 GB free)', s, 'GB-month', must(ociCost(ociPart(rows, 'B92593'), s), 'log storage')),
        ], { sku: 'OCI Monitoring + Logging', notes: ['OCI does not charge for alarms or log ingestion.'] });
      },
    },
  },
};

// =====================================================================================
// Custom line (on-prem, licences, support, anything not in the catalog)
// =====================================================================================

export async function customPrice(_ctx: Ctx, item: Item): Promise<Priced> {
  const monthly = num(item.spec, 'monthly', 0);
  const upfront = num(item.spec, 'upfront', 0);
  const lines: Line[] = [line(str(item.spec, 'what', 'Custom line'), item.qty, str(item.spec, 'unit', 'units'), monthly)];
  return priced(lines, { upfront: upfront * item.qty, sku: 'Entered by hand', notes: ['Price entered by hand; not from a provider price list.'] });
}

export const custom: Service = {
  id: 'custom',
  label: 'Custom line item',
  group: 'Other',
  blurb: 'On-prem hardware, licences, support, colocation',
  defaults: { what: 'Server, amortised', unit: 'servers', monthly: 0, upfront: 0 },
  fields: [
    { key: 'what', label: 'Description', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'monthly', label: 'Monthly price per unit', type: 'number', unit: 'USD', min: 0, step: 1 },
    { key: 'upfront', label: 'One-time price per unit', type: 'number', unit: 'USD', min: 0, step: 1 },
  ],
  providers: {
    aws: { product: 'Custom', price: customPrice },
    gcp: { product: 'Custom', price: customPrice },
    oci: { product: 'Custom', price: customPrice },
    onprem: { product: 'On-prem', price: customPrice },
  },
};
