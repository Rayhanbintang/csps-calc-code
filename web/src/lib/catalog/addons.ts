// CDN and backup. Backup is an add-on: it sits inside the VM, disk, database or file share
// it protects and reads its size from there (see attachSpec in ../tree.ts).
import type { Spec } from '../types';
import { aws, gcp, oci } from '../prices';
import {
  awsCost, awsFind, awsRate, continent, gcpCost, gcpFind, gcpRate, line, must, num, ociCost, ociPart, ociRate, opts, priced, str,
  tierLine, unavailable,
} from './util';
import type { Ctx, Service } from './util';

// =====================================================================================
// CDN
// =====================================================================================

/** Where the viewers are. CDNs price by the viewer's location, not the origin region. */
export interface Geo { label: string; aws: string; gcp: string; azure: string }

export const GEO: Record<string, Geo> = {
  us: { label: 'United States', aws: 'US', gcp: 'North America', azure: 'Zone 1' },
  ca: { label: 'Canada', aws: 'CA', gcp: 'North America', azure: 'Zone 1' },
  eu: { label: 'Europe', aws: 'EU', gcp: 'Europe', azure: 'Zone 1' },
  ap: { label: 'Asia Pacific', aws: 'AP', gcp: 'Asia', azure: 'Zone 2' },
  jp: { label: 'Japan', aws: 'JP', gcp: 'Asia', azure: 'Zone 2' },
  in: { label: 'India', aws: 'IN', gcp: 'Asia', azure: 'Zone 5' },
  au: { label: 'Australia and New Zealand', aws: 'AU', gcp: 'Oceania', azure: 'Zone 4' },
  sa: { label: 'South America', aws: 'SA', gcp: 'Latin America', azure: 'Zone 3' },
  me: { label: 'Middle East', aws: 'ME', gcp: 'Other', azure: 'Zone 1' },
  za: { label: 'Africa', aws: 'ZA', gcp: 'Other', azure: 'Zone 1' },
};

/** The viewers' location: chosen on the card, or the continent of the region. */
export function geoOf(ctx: Ctx, spec: Spec): Geo {
  const g = str(spec, 'geo');
  if (GEO[g]) return GEO[g];
  const c = continent(ctx.provider, ctx.region);
  return GEO[{ apac: 'ap', na: 'us', eu: 'eu', sa: 'sa', me: 'me', af: 'za' }[c]];
}

export const cdn: Service = {
  id: 'cdn',
  label: 'CDN',
  group: 'Networking',
  blurb: 'CloudFront · Cloud CDN · Azure Front Door',
  defaults: { gb: 1000, requests: 10_000_000, geo: '' },
  fields: [
    { key: 'gb', label: 'Data out to viewers', type: 'number', unit: 'GB / month', min: 0, step: 100 },
    { key: 'requests', label: 'HTTPS requests', type: 'number', unit: '/ month', min: 0, step: 1000000 },
    {
      key: 'geo', label: 'Where the viewers are', type: 'select',
      options: [{ value: '', label: 'Same continent as the region' }, ...Object.entries(GEO).map(([value, g]) => ({ value, label: g.label }))],
      help: 'CDNs price by the viewers\' location. For a mix, add one card per location.',
    },
  ],
  providers: {
    aws: {
      product: 'Amazon CloudFront',
      price: async (ctx, item) => {
        const rows = await aws.global('cloudfront');
        const g = geoOf(ctx, item.spec);
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const req = num(item.spec, 'requests', 0) * item.qty;
        return priced([
          tierLine(`Data out to viewers in ${g.label}`, gb, 'GB', must(awsCost(awsFind(rows, `${g.aws}-DataTransfer-Out-Bytes`), gb), 'CloudFront data transfer')),
          line('HTTPS requests', req, 'requests', must(awsRate(awsFind(rows, `${g.aws}-Requests-Tier2-HTTPS`)), 'CloudFront requests')),
        ], { sku: 'CloudFront, pay as you go', notes: ['The always-free 1 TB and 10M requests a month are not taken off. Data from an AWS origin to CloudFront has no charge.'] });
      },
    },
    gcp: {
      product: 'Cloud CDN',
      price: async (ctx, item) => {
        const rows = await gcp.global();
        const g = geoOf(ctx, item.spec);
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const req = num(item.spec, 'requests', 0) * item.qty;
        return priced([
          tierLine(`Cache egress to ${g.gcp}`, gb, 'GiB', must(gcpCost(gcpFind(rows, new RegExp(`^Networking Cloud CDN Traffic Cache Data Transfer to ${g.gcp}$`)), gb), 'Cloud CDN egress')),
          tierLine('Cache lookups', req, 'requests', must(gcpCost(gcpFind(rows, /^Networking Cloud Cdn Cache Lookups$/), req), 'Cloud CDN lookups')),
        ], { sku: 'Cloud CDN', notes: ['Cloud CDN runs on an external Application Load Balancer; add that as a load balancer card. Cache fill from the origin is not included.'] });
      },
    },
    oci: {
      product: 'No OCI CDN',
      price: async () => unavailable('OCI has no CDN of its own.'),
    },
  },
};

// =====================================================================================
// Backup
// =====================================================================================

const whatOpts = opts(['vm', 'VM or disk snapshots'], ['db', 'Database backups'], ['file', 'File share backups']);

export const backup: Service = {
  id: 'backup',
  label: 'Backup',
  group: 'Storage',
  blurb: 'AWS Backup / snapshots · snapshots · Azure Backup · OCI backups',
  defaults: { what: 'vm', gb: 100 },
  fields: [
    { key: 'what', label: 'What is backed up', type: 'select', options: whatOpts, show: (s) => !s.on },
    {
      key: 'gb', label: 'Backup storage', type: 'number', unit: 'GB', min: 0, step: 10,
      help: 'The size the backups keep. Snapshots after the first store only the changes, so this is often close to the data size plus daily change times the days kept.',
    },
  ],
  providers: {
    aws: {
      product: 'EBS snapshots / AWS Backup',
      price: async (ctx, item) => {
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const what = str(item.spec, 'what', 'vm');
        if (what === 'db') {
          const rows = await aws.rows(ctx.region, 'rds');
          return priced([line('RDS backup storage', gb, 'GB-month', must(awsRate(awsFind(rows, 'RDS:ChargedBackupUsage', undefined, { databaseEngine: 'Any' })), 'RDS backup storage'))], {
            sku: 'RDS backup storage', notes: ['RDS keeps backups up to the size of the database at no charge; enter only the backup storage above that.'],
          });
        }
        if (what === 'file') {
          const rows = await aws.rows(ctx.region, 'backup');
          return priced([line('AWS Backup warm storage (EFS)', gb, 'GB-month', must(awsRate(awsFind(rows, 'WarmStorage-ByteHrs-EFS')), 'EFS backup storage'))], { sku: 'AWS Backup for EFS' });
        }
        const rows = await aws.rows(ctx.region, 'ec2x');
        return priced([line('EBS snapshot storage', gb, 'GB-month', must(awsRate(awsFind(rows, 'EBS:SnapshotUsage')), 'EBS snapshots'))], {
          sku: 'EBS snapshots (Standard)', notes: ['AWS Backup for EBS bills the same snapshot storage.'],
        });
      },
    },
    gcp: {
      product: 'Snapshots and backups',
      price: async (ctx, item) => {
        const rows = await gcp.region(ctx.region);
        const gb = num(item.spec, 'gb', 0) * item.qty;
        const what = str(item.spec, 'what', 'vm');
        const [label, re, sku] = ({
          vm: ['Standard snapshot storage', /^Storage PD Snapshot( in .+)?$/, 'Persistent Disk standard snapshots'],
          db: ['Cloud SQL backup storage', /^Cloud SQL: Backups( in .+)?$/, 'Cloud SQL backups'],
          file: ['Filestore backup storage', /^Filestore Backup Usage/, 'Filestore backups'],
        } as Record<string, [string, RegExp, string]>)[what];
        const row = gcpFind(rows, re) ?? gcpFind(await gcp.global(), re);
        const notes = what === 'db' ? ['Cloud SQL keeps seven automated backups by default; enter the storage they take.'] : [];
        return priced([line(label, gb, 'GiB-month', must(gcpRate(row), label))], { sku, notes });
      },
    },
    oci: {
      product: 'OCI backups',
      price: async (_ctx, item) => {
        const rows = await oci.all();
        const gb = num(item.spec, 'gb', 0) * item.qty;
        if (str(item.spec, 'what', 'vm') === 'db') {
          return priced([line('Database backup storage', gb, 'GB-month', must(ociRate(ociPart(rows, 'B92483')), 'database backup storage'))], { sku: 'MySQL HeatWave backup storage' });
        }
        return priced([tierLine('Backups kept in Object Storage', gb, 'GB-month', must(ociCost(ociPart(rows, 'B91628'), gb), 'Object Storage'))], {
          sku: 'Block Volume / File Storage backups', notes: ['OCI stores volume and file system backups in Object Storage at the Standard rate.'],
        });
      },
    },
  },
};

/** Azure Backup bills a fee per protected instance by its size, plus the storage used. */
export function azureInstanceFee(gb: number): { count: number; label: string } {
  if (gb < 50) return { count: 0.5, label: 'under 50 GB: half the instance fee' };
  if (gb <= 500) return { count: 1, label: '50 to 500 GB' };
  return { count: Math.ceil(gb / 500), label: `each 500 GB, ${Math.ceil(gb / 500)} units` };
}
