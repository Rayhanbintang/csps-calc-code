// Prices real items against the fetched price files and checks the dollar values.
// Expected rates were read from the raw provider feeds on 2026-10-05; when a provider
// changes a list price, the matching test fails and the expectation needs a look.
//
// Needs fetched prices in public/prices (or PRICES_DIR). Run after the daily fetch.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Item, Pricing, Provider } from './types';
import { ctxFor, newItem, priceItem, moveItem } from './engine';
import { loadManifest } from './prices';
import type { Manifest } from './prices';

const dir = process.env.PRICES_DIR ?? fileURLToPath(new URL('../../public/prices', import.meta.url));
const have = existsSync(join(dir, 'manifest.json'));

let manifest: Manifest;

beforeAll(async () => {
  if (!have) return;
  vi.stubGlobal('fetch', async (url: string) => {
    const path = join(dir, url.replace(/^\/prices\//, ''));
    if (!existsSync(path)) return new Response('', { status: 404 });
    return new Response(readFileSync(path));
  });
  manifest = await loadManifest();
});

function item(svc: string, spec: Item['spec'] = {}, pricing?: Pricing, qty = 1): Item {
  const i = newItem(svc);
  return { ...i, qty, spec: { ...i.spec, ...spec }, pricing: pricing ?? { model: 'od' } };
}

async function price(provider: Provider, region: string, it: Item) {
  return priceItem(ctxFor(manifest, provider, region), it);
}

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

// v2 fixes: Google Cloud disks in the shared US SKUs, Hyperdisk, Filestore tiers,
// Google alerting, SQS in us-east-1. Rates read from the feeds on 2026-10-06.
describe.skipIf(!have)('v2 pricing fixes', () => {
  it('pd-balanced prices in us-central1, where the SKU has no " in Iowa" ending', async () => {
    // 100 GiB × $0.10 = $10.00
    const p = await price('gcp', 'us-central1', item('disk', { gb: 100, type: 'ssd' }));
    expect(p.unavailable).toBeUndefined();
    near(p.monthly, 10);
  });

  it('pd-standard in us-east1 uses the paid rate, not the 30 GB free tier', async () => {
    // 100 GiB × $0.04 = $4.00
    const p = await price('gcp', 'us-east1', item('disk', { gb: 100, type: 'hdd' }));
    near(p.monthly, 4);
  });

  it('Hyperdisk Extreme bills capacity and every provisioned IOPS', async () => {
    // 100 GiB × $0.125 + 5,000 IOPS × $0.032 = $12.50 + $160.00 = $172.50
    const p = await price('gcp', 'us-central1', item('disk', { gb: 100, 'gcp.disk': 'hyperdisk-extreme', iops: 5000 }));
    near(p.monthly, 172.5);
  });

  it('Hyperdisk Throughput bills capacity and every provisioned MB/s', async () => {
    // 100 GiB × $0.005 + 200 MB/s × $0.25 = $0.50 + $50.00 = $50.50
    const p = await price('gcp', 'us-central1', item('disk', { gb: 100, 'gcp.disk': 'hyperdisk-throughput', mbps: 200 }));
    near(p.monthly, 50.5);
  });

  it('Filestore Zonal in Jakarta: per GiB without custom performance', async () => {
    // 1,024 GiB × $0.30 = $307.20
    const p = await price('gcp', 'asia-southeast2', item('file', { gb: 1024, 'gcp.filestore': 'zonal' }));
    near(p.monthly, 307.2);
  });

  it('Filestore Zonal in Jakarta with custom performance: instance + GiB + IOPS', async () => {
    // $24.12 + 1,024 GiB × $0.1447 + 4,000 IOPS × $0.0175 = 24.12 + 148.17 + 70.00 = $242.29
    const p = await price('gcp', 'asia-southeast2', item('file', { gb: 1024, 'gcp.filestore': 'zonal', 'gcp.iops': 4000 }));
    near(p.monthly, 24.12 + 1024 * 0.1447 + 4000 * 0.0175);
  });

  it('Google alerting is $0 until 1 Sep 2027 and says what follows', async () => {
    const p = await price('gcp', 'asia-southeast2', item('monitoring', { metrics: 0, logs: 0, stored: 0, alarms: 20 }));
    near(p.monthly, 0);
    // 20 policies × $0.35 = $7.00 a month from 1 Sep 2027
    expect(p.notes.join(' ')).toContain('$7.00');
  });

  it('SQS prices in us-east-1, whose rows end in -RBP', async () => {
    // 10M requests × $0.40 per million = $4.00
    const p = await price('aws', 'us-east-1', item('queue', { requests: 10_000_000, kb: 4 }));
    expect(p.unavailable).toBeUndefined();
    near(p.monthly, 4);
  });
});

// Backlog B3 to B7. Rates read from the feeds on 2026-10-06.
describe.skipIf(!have)('v2 pricing: B3 to B7', () => {
  const sp1 = { model: 'sp' as const, term: 1 as const, pay: 'no' as const, kind: 'c' as const };

  it('B3 Aurora Standard: writer + 2 readers, storage and I/O requests', async () => {
    // 3 × db.r6g.large $0.312 × 730 h = $683.28; 100 GB × $0.11 = $11.00;
    // 100M I/O × $0.00000022 = $22.00. Total $716.28.
    const p = await price('aws', 'ap-southeast-3', item('db', { engine: 'aurora-mysql', 'aws.class': 'db.r6g.large', readers: 2, gb: 100, ios: 100 }));
    expect(p.unavailable).toBeUndefined();
    near(p.monthly, 716.28);
  });

  it('B3 Aurora I/O-Optimized: dearer instances and storage, no I/O line', async () => {
    // 3 × $0.406 × 730 = $889.14; 100 GB × $0.248 = $24.80. Total $913.94.
    const p = await price('aws', 'ap-southeast-3', item('db', { engine: 'aurora-mysql', 'aws.class': 'db.r6g.large', 'aws.aurora': 'io', readers: 2, gb: 100, ios: 100 }));
    near(p.monthly, 913.94);
    expect(p.lines.some((l) => l.label.includes('I/O requests'))).toBe(false);
  });

  it('B3 Aurora MySQL prices in us-east-1, which lists storage under "Any"', async () => {
    const p = await price('aws', 'us-east-1', item('db', { engine: 'aurora-mysql' }));
    expect(p.unavailable).toBeUndefined();
  });

  it('B3 RDS Custom for SQL Server prices from the Custom rows only', async () => {
    const p = await price('aws', 'ap-southeast-3', item('db', { engine: 'sqlserver-std', 'aws.deploy': 'custom', vcpu: 2, mem: 8 }));
    expect(p.unavailable).toBeUndefined();
    expect(p.lines[0].label).toContain('Custom');
  });

  it('B4 OCI Base Database, Standard Edition: infrastructure + edition per ECPU, plus storage', async () => {
    // 4 ECPU × 730 h × ($0.0251 + $0.0538) = $230.39; 100 GB × $0.12 = $12.00. Total $242.39.
    const p = await price('oci', 'ap-singapore-1', item('db', { engine: 'oracle-se2', vcpu: 4, gb: 100 }));
    near(p.monthly, 4 * 730 * (0.0251 + 0.0538) + 12);
  });

  it('B4 SQL Server on OCI: E5 VM + Windows + SQL Server licence from a marketplace image', async () => {
    // 2 OCPU × 730 × $0.03 = 43.80; 16 GB × 730 × $0.002 = 23.36; Windows 2 × 730 × $0.092 = 134.32;
    // SQL Std 2 × 730 × $0.37 = 540.20; 100 GB × $0.0255 = 2.55. Total $744.23.
    const p = await price('oci', 'ap-singapore-1', item('db', { engine: 'sqlserver-std', vcpu: 4, mem: 16, gb: 100 }));
    near(p.monthly, 744.23);
  });

  it('B5 Fargate Compute Savings Plan, 1 year, no upfront', async () => {
    // vCPU 2 × 1 × 730 h × $0.044063 = $64.33; memory 2 × 2 GB × 730 × $0.004819 = $14.07. Total $78.40
    // (on-demand: 2 × 730 × $0.05056 + 4 × 730 × $0.00553 = $89.97).
    const p = await price('aws', 'ap-southeast-3', item('containers', { tasks: 2, vcpu: 1, gb: 2, hours: 730 }, sp1));
    near(p.monthly, 2 * 730 * 0.044063 + 4 * 730 * 0.004819);
  });

  it('B5 Fargate Savings Plan, all upfront: the year is paid ahead', async () => {
    const p = await price('aws', 'ap-southeast-3', item('containers', { tasks: 2, vcpu: 1, gb: 2, hours: 730 }, { ...sp1, pay: 'all' }));
    near(p.monthly, 0);
    // All upfront has its own, lower rate: less than 12 × the no-upfront month, more than 10 ×.
    expect(p.upfront).toBeLessThan(12 * (2 * 730 * 0.044063 + 4 * 730 * 0.004819));
    expect(p.upfront).toBeGreaterThan(10 * (2 * 730 * 0.044063 + 4 * 730 * 0.004819));
  });

  it('B5 Lambda Compute Savings Plan covers duration, not requests', async () => {
    // 1M × 0.2 s × 0.5 GB = 100,000 GB-s × $0.000015 = $1.50; requests 1M × $0.0000002 = $0.20.
    const p = await price('aws', 'ap-southeast-3', item('functions', { requests: 1_000_000, ms: 200, mb: 512 }, sp1));
    near(p.monthly, 1.7);
  });

  it('B6 Cloud SQL committed use takes the rate from the commitment SKU', async () => {
    // (2 vCPU × 730 × $0.0537 + 8 GiB × 730 × $0.0091) × 0.75 + 100 GiB × $0.221
    // = 131.546 × 0.75 + 22.10 = $120.76
    const p = await price('gcp', 'asia-southeast2', item('db', { engine: 'mysql', vcpu: 2, mem: 8, gb: 100 }, { model: 'cud', term: 1 }));
    near(p.monthly, 131.546 * 0.75 + 22.1);
  });

  it('B7 Direct Connect data out at the chosen location', async () => {
    // NTT Jakarta 2: 1,000 GB × $0.0484 = $48.40
    const p = await price('aws', 'ap-southeast-3', item('interconnect', { gb: 1000, 'aws.dx': 'NTT Jakarta 2 Data Center' }));
    const out = p.lines.find((l) => l.label.startsWith('Data out'));
    near(out!.monthly, 48.4);
  });
});

// Microsoft Azure, Indonesia Central. Rates read from the Azure Retail Prices API on 2026-10-06.
describe.skipIf(!have)('Azure', () => {
  const r = 'indonesiacentral';
  const d2 = { 'azure.size': 'Standard_D2s_v5' };

  it('D2s_v5 Linux pay as you go: 730 h × $0.108 = $78.84', async () => {
    const p = await price('azure', r, item('vm', d2));
    expect(p.unavailable).toBeUndefined();
    near(p.monthly, 78.84);
  });

  it('D2s_v5 Windows adds the licence: 730 × ($0.20 − $0.108) = $67.16, total $146.00', async () => {
    const p = await price('azure', r, item('vm', { ...d2, os: 'windows' }));
    near(p.monthly, 146);
  });

  it('D2s_v5 1-year reservation, paid monthly: $584 ÷ 8,760 h × 730 h = $48.67', async () => {
    const p = await price('azure', r, item('vm', d2, { model: 'ri', term: 1, pay: 'no' }));
    near(p.monthly, (584 / 8760) * 730);
  });

  it('D2s_v5 1-year reservation, paid up front: $584 once, nothing monthly', async () => {
    const p = await price('azure', r, item('vm', d2, { model: 'ri', term: 1, pay: 'all' }));
    near(p.upfront, 584);
    near(p.monthly, 0);
  });

  it('D2s_v5 1-year Savings Plan: 730 h × $0.07452 = $54.40', async () => {
    const p = await price('azure', r, item('vm', d2, { model: 'sp', term: 1, pay: 'no' }));
    near(p.monthly, 730 * 0.07452);
  });

  it('a 100 GB Premium SSD is billed as a P10 (128 GiB): $19.71', async () => {
    const p = await price('azure', r, item('disk', { gb: 100, type: 'ssd' }));
    near(p.monthly, 19.71);
  });

  it('MySQL Flexible Server 2 vCore, HA doubles compute and storage', async () => {
    // (2 vCore × 730 h × $0.10575 + 100 GB × $0.1242) × 2 = (154.40 + 12.42) × 2 = $333.63
    const p = await price('azure', r, item('db', { engine: 'mysql', vcpu: 2, mem: 8, gb: 100, ha: 'multi' }));
    near(p.monthly, (2 * 730 * 0.10575 + 100 * 0.1242) * 2);
  });

  it('internet egress: the first 100 GB are free, then $0.12: 1,000 GB = $108.00', async () => {
    const p = await price('azure', r, item('egress', { gb: 1000, to: 'internet' }));
    near(p.monthly, 108);
  });

  it('Service Bus Standard here lists the base charge per hour: 730 × $0.013441 = $9.81', async () => {
    const p = await price('azure', r, item('queue', { requests: 10_000_000 })); // within the 13M included
    near(p.monthly, 730 * 0.013441);
  });
});

describe.skipIf(!have)('Azure SQL Server on VMs', () => {
  it('D2s_v5 Windows + SQL Standard: 4-core minimum licence at $0.40 an hour', async () => {
    // compute 730 × 0.108 = 78.84; Windows 730 × 0.092 = 67.16; SQL Std 730 × 0.40 = 292.00. Total $438.00
    const p = await price('azure', 'indonesiacentral', item('vm', { 'azure.size': 'Standard_D2s_v5', os: 'windows', sw: 'sql-std' }));
    near(p.monthly, 438);
  });
});
