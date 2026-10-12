// Free tiers per service and cloud, shown behind an info icon on each card.
//
// A free tier belongs to the account (or billing account, or tenancy), not to one
// estimate line, so totals never subtract it. Where a provider writes the allowance into
// its price list as a $0 first tier, the pricers charge that tier at the paid rate
// (`tierPolicy` in prices.ts). Limits were read from each provider's page on 2026-10-06.
import type { Provider } from './types';

export interface FreeTier {
  /** The allowance, in the provider's units. */
  text: string;
  /** A note on how the allowance relates to what the card prices. */
  detail?: string;
  src: string;
}

const AWS_FREE = 'https://aws.amazon.com/free/';
const GCP_FREE = 'https://docs.cloud.google.com/free/docs/free-cloud-features';
const OCI_FREE = 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm';
const OCI_LIST = 'https://www.oracle.com/cloud/price-list/';
const AZ_ACCOUNT = 'https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account';
const AZ_LIST = 'https://prices.azure.com/api/retail/prices';

/** Account-wide offers for new customers, shown under every service's allowance. */
export const NEW_ACCOUNT: Partial<Record<Provider, { text: string; src: string }>> = {
  aws: { text: 'New AWS accounts (since 15 Jul 2025) get $100 in credits, up to $100 more, and a free plan for up to 6 months.', src: AWS_FREE },
  gcp: { text: 'New Google Cloud customers get $300 in credits for 90 days.', src: GCP_FREE },
  azure: { text: 'New Azure customers get $200 in credits for 30 days and 12 months of free amounts on 20+ services.', src: AZ_ACCOUNT },
};

const TIERS: Record<string, Partial<Record<Provider, FreeTier>>> = {
  cdn: {
    aws: { text: '1 TB of data out and 10M HTTP or HTTPS requests a month, always free.', src: 'https://aws.amazon.com/cloudfront/pricing/' },
  },
  vm: {
    azure: { text: '12 months for new customers: 750 hours each of B1s, B2pts v2 (Arm) and B2ats v2 (AMD) a month.', src: AZ_ACCOUNT },
    gcp: { text: 'One e2-micro VM a month in us-west1, us-central1 or us-east1.', src: GCP_FREE },
    oci: {
      text: 'Two AMD micro VMs (1/8 OCPU, 1 GB). Ampere A1: 1,500 OCPU-hours and 9,000 GB-hours a month, about 2 OCPU and 12 GB.',
      detail: 'The AMD micro VMs are not offered here.', src: OCI_FREE,
    },
  },
  disk: {
    gcp: { text: '30 GB-months of pd-standard in us-west1, us-central1 and us-east1.', src: GCP_FREE },
    oci: { text: '200 GB of boot and block volumes combined.', src: OCI_FREE },
  },
  object: {
    gcp: {
      text: '5 GB-months of regional storage in US regions; 5,000 Class A and 50,000 Class B operations a month.',
      src: GCP_FREE,
    },
    oci: {
      text: '20 GB across Standard, Infrequent Access and Archive; 50,000 API requests a month.',
      src: OCI_FREE,
    },
  },
  functions: {
    azure: { text: '1M executions and 400,000 GB-seconds a month (Consumption plan).', src: AZ_LIST },
    aws: { text: '1M requests and 400,000 GB-seconds a month, x86 and Arm.', src: 'https://aws.amazon.com/lambda/pricing/' },
    gcp: {
      text: '2M invocations, 400,000 GB-seconds, 200,000 GHz-seconds and 5 GB of egress a month.',
      src: GCP_FREE,
    },
    oci: { text: '2M invocations and 400,000 GB-seconds a month.', src: OCI_LIST },
  },
  containers: {
    gcp: {
      text: 'Cloud Run, request-based billing: 2M requests, 360,000 GB-seconds and 180,000 vCPU-seconds a month.',
      detail: 'The card prices instance-based billing, which has no free allowance.', src: GCP_FREE,
    },
  },
  k8s: {
    azure: { text: 'The AKS Free tier has no cluster fee.', detail: 'The card prices the Standard tier, which carries an uptime SLA.', src: AZ_LIST },
    gcp: { text: 'The cluster fee of one zonal Standard or Autopilot cluster a month. Nodes are charged.', src: GCP_FREE },
  },
  queue: {
    aws: { text: '1M requests a month.', src: 'https://aws.amazon.com/sqs/pricing/' },
    gcp: { text: '10 GiB of Pub/Sub messages a month.', src: GCP_FREE },
    oci: { text: '1M requests a month.', src: OCI_LIST },
  },
  notify: {
    aws: { text: '1M publishes, 100,000 HTTP or HTTPS deliveries and 1,000 email deliveries a month.', src: 'https://aws.amazon.com/sns/pricing/' },
    azure: { text: '100,000 Event Grid operations a month.', src: AZ_LIST },
    gcp: { text: '10 GiB of Pub/Sub messages a month.', src: GCP_FREE },
    oci: { text: '1M HTTPS and 1,000 email deliveries a month.', src: OCI_FREE },
  },
  monitoring: {
    azure: { text: '5 GB of log ingestion a month and 10 metric alert time series.', src: AZ_LIST },
    aws: { text: '10 custom metrics, 10 alarms, 5 GB of logs, 3 dashboards and 1M API requests a month.', src: 'https://aws.amazon.com/cloudwatch/pricing/' },
    gcp: { text: '150 MiB of metrics per billing account and 50 GiB of logs per project a month.', src: GCP_FREE },
    oci: { text: '500M ingestion and 1B retrieval data points; 10 GB of logs a month.', src: OCI_FREE },
  },
  egress: {
    azure: { text: '100 GB a month to the internet.', src: AZ_LIST },
    aws: { text: '100 GB a month to the internet, shared across all services and regions.', src: 'https://aws.amazon.com/ec2/pricing/on-demand/' },
    gcp: {
      text: '1 GB a month from North America.',
      src: GCP_FREE,
    },
    oci: { text: '10 TB of outbound data a month.', src: OCI_FREE },
  },
  backup: {
    oci: { text: 'Backups count toward the 20 GB of free Object Storage.', src: OCI_FREE },
  },
  lb: {
    oci: { text: 'One flexible load balancer at 10 Mbps.', src: OCI_FREE },
  },
  db: {
    azure: { text: 'Azure SQL Database: 100,000 vCore-seconds of serverless use and 32 GB of storage a month.', detail: 'The card prices provisioned General Purpose compute.', src: AZ_ACCOUNT },
    oci: { text: 'Two Autonomous Databases (1 OCPU, 20 GB each) and one single-node MySQL HeatWave with 50 GB.', src: OCI_FREE },
  },
  waf: {
    oci: { text: 'The first WAF policy and 10M requests a month.', src: OCI_LIST },
  },
  apigw: {
    azure: { text: '1M calls a month on the Consumption tier.', src: AZ_LIST },
    gcp: { text: 'The first 2M API calls a month.', src: 'https://cloud.google.com/api-gateway/pricing' },
  },
};

/** Said with every allowance: the totals never take it off. */
export const CHARGED = 'The total charges this in full, so the real bill can come out lower.';

export function freeTier(svc: string, provider: Provider): FreeTier | undefined {
  return TIERS[svc]?.[provider];
}

/** One line for a tooltip or screen reader. */
export function freeTierText(svc: string, provider: Provider): string {
  const t = freeTier(svc, provider);
  if (!t) return '';
  return `Free tier: ${t.text} ${t.detail ? `${t.detail} ` : ''}${CHARGED}`;
}
