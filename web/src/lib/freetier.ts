// Free tiers per service and cloud, shown behind an info icon on each card.
//
// A free tier belongs to the account (or billing account, or tenancy), not to one
// estimate line, so the calculator does not subtract it on its own. Some providers put
// the allowance into their price list as a $0 first tier; those prices already include
// it, and `inPrice` says so. Limits were read from each provider's page on 2026-10-06.
import type { Provider } from './types';

export interface FreeTier {
  /** The allowance, in the provider's units. */
  text: string;
  /** Whether the price on the card already counts the allowance. */
  inPrice: 'yes' | 'no' | 'partly';
  /** What `partly` covers. */
  detail?: string;
  src: string;
}

const AWS_FREE = 'https://aws.amazon.com/free/';
const GCP_FREE = 'https://docs.cloud.google.com/free/docs/free-cloud-features';
const OCI_FREE = 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm';
const OCI_LIST = 'https://www.oracle.com/cloud/price-list/';

/** Account-wide offers for new customers, shown under every service's allowance. */
export const NEW_ACCOUNT: Partial<Record<Provider, { text: string; src: string }>> = {
  aws: { text: 'New AWS accounts (since 15 Jul 2025) get $100 in credits, up to $100 more, and a free plan for up to 6 months.', src: AWS_FREE },
  gcp: { text: 'New Google Cloud customers get $300 in credits for 90 days.', src: GCP_FREE },
};

const TIERS: Record<string, Partial<Record<Provider, FreeTier>>> = {
  vm: {
    gcp: { text: 'One e2-micro VM a month in us-west1, us-central1 or us-east1.', inPrice: 'no', src: GCP_FREE },
    oci: {
      text: 'Two AMD micro VMs (1/8 OCPU, 1 GB). Ampere A1: 1,500 OCPU-hours and 9,000 GB-hours a month, about 2 OCPU and 12 GB.',
      inPrice: 'partly', detail: 'The Ampere A1 allowance is in the price; the AMD micro VMs are not offered here.', src: OCI_FREE,
    },
  },
  disk: {
    gcp: { text: '30 GB-months of pd-standard in us-west1, us-central1 and us-east1.', inPrice: 'no', src: GCP_FREE },
    oci: { text: '200 GB of boot and block volumes combined.', inPrice: 'no', src: OCI_FREE },
  },
  object: {
    gcp: {
      text: '5 GB-months of regional storage in US regions; 5,000 Class A and 50,000 Class B operations a month.',
      inPrice: 'partly', detail: 'The operations allowance is in the price; the storage allowance is not.', src: GCP_FREE,
    },
    oci: {
      text: '20 GB across Standard, Infrequent Access and Archive; 50,000 API requests a month.',
      inPrice: 'partly', detail: "Oracle's price list makes the first 10 GB of Standard free; the price uses that.", src: OCI_FREE,
    },
  },
  functions: {
    aws: { text: '1M requests and 400,000 GB-seconds a month, x86 and Arm.', inPrice: 'no', src: 'https://aws.amazon.com/lambda/pricing/' },
    gcp: {
      text: '2M invocations, 400,000 GB-seconds, 200,000 GHz-seconds and 5 GB of egress a month.',
      inPrice: 'partly', detail: 'The invocation allowance is in the price; compute time is not.', src: GCP_FREE,
    },
    oci: { text: '2M invocations and 400,000 GB-seconds a month.', inPrice: 'yes', src: OCI_LIST },
  },
  containers: {
    gcp: {
      text: 'Cloud Run, request-based billing: 2M requests, 360,000 GB-seconds and 180,000 vCPU-seconds a month.',
      inPrice: 'no', detail: 'The card prices instance-based billing, which has no free allowance.', src: GCP_FREE,
    },
  },
  k8s: {
    gcp: { text: 'The cluster fee of one zonal Standard or Autopilot cluster a month. Nodes are charged.', inPrice: 'no', src: GCP_FREE },
  },
  queue: {
    aws: { text: '1M requests a month.', inPrice: 'no', src: 'https://aws.amazon.com/sqs/pricing/' },
    gcp: { text: '10 GiB of Pub/Sub messages a month.', inPrice: 'yes', src: GCP_FREE },
    oci: { text: '1M requests a month.', inPrice: 'yes', src: OCI_LIST },
  },
  notify: {
    gcp: { text: '10 GiB of Pub/Sub messages a month.', inPrice: 'yes', src: GCP_FREE },
    oci: { text: '1M HTTPS and 1,000 email deliveries a month.', inPrice: 'yes', src: OCI_FREE },
  },
  monitoring: {
    aws: { text: '10 custom metrics, 10 alarms, 5 GB of logs, 3 dashboards and 1M API requests a month.', inPrice: 'no', src: 'https://aws.amazon.com/cloudwatch/pricing/' },
    gcp: { text: '150 MiB of metrics per billing account and 50 GiB of logs per project a month.', inPrice: 'yes', src: GCP_FREE },
    oci: { text: '500M ingestion and 1B retrieval data points; 10 GB of logs a month.', inPrice: 'yes', src: OCI_FREE },
  },
  egress: {
    aws: { text: '100 GB a month to the internet, shared across all services and regions.', inPrice: 'no', src: 'https://aws.amazon.com/ec2/pricing/on-demand/' },
    gcp: {
      text: '1 GB a month from North America.',
      inPrice: 'partly', detail: "Some routes in Google's price list start with a free first GiB; the price follows the price list.", src: GCP_FREE,
    },
    oci: { text: '10 TB of outbound data a month.', inPrice: 'yes', src: OCI_FREE },
  },
  lb: {
    oci: { text: 'One flexible load balancer at 10 Mbps.', inPrice: 'yes', src: OCI_FREE },
  },
  db: {
    oci: { text: 'Two Autonomous Databases (1 OCPU, 20 GB each) and one single-node MySQL HeatWave with 50 GB.', inPrice: 'no', src: OCI_FREE },
  },
  waf: {
    oci: { text: 'The first WAF policy and 10M requests a month.', inPrice: 'yes', src: OCI_LIST },
  },
  apigw: {
    gcp: { text: 'The first 2M API calls a month.', inPrice: 'yes', src: 'https://cloud.google.com/api-gateway/pricing' },
  },
};

export function freeTier(svc: string, provider: Provider): FreeTier | undefined {
  return TIERS[svc]?.[provider];
}

/** One line for a tooltip or screen reader. */
export function freeTierText(svc: string, provider: Provider): string {
  const t = freeTier(svc, provider);
  if (!t) return '';
  const inPrice = t.inPrice === 'yes' ? 'Already in this price.' : t.inPrice === 'no' ? 'Not taken off this price.' : t.detail ?? '';
  return `Free tier: ${t.text} ${t.inPrice === 'no' && t.detail ? `${t.detail} ` : ''}${inPrice}`.trim();
}
