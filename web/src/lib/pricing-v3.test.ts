// v3: add-ons inside the resources they serve, CDN, backup, commitments that survive a
// cloud switch, and the Azure gap fixes. Rates read from the provider feeds on 2026-10-07.
//
// Needs fetched prices in public/prices (or PRICES_DIR). Checks whose data file is not
// fetched yet skip, as in pricing-v2.test.ts.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { Item, Pricing, Provider } from './types';
import { carryPricing, ctxFor, moveItem, newItem, priceItem } from './engine';
import { loadManifest } from './prices';
import type { Manifest } from './prices';
import { attachSpec } from './tree';
import { continent } from './catalog/util';
import { erZone, osLicence } from './catalog/azure';
import { service } from './catalog';

const dir = process.env.PRICES_DIR ?? fileURLToPath(new URL('../../public/prices', import.meta.url));
const have = existsSync(join(dir, 'manifest.json'));

function gz<T = { s?: string; p?: string; m?: string; k?: string }>(path: string): T[] | null {
  const f = join(dir, `${path}.gz`);
  if (!existsSync(f)) return null;
  const buf = readFileSync(f);
  return JSON.parse((buf[0] === 0x1f ? gunzipSync(buf) : buf).toString('utf8'));
}
const hasCloudFront = have && existsSync(join(dir, 'aws/global/cloudfront.json.gz'));
const hasAwsBackup = have && existsSync(join(dir, 'aws/ap-southeast-3/backup.json.gz'));
const azJakarta = have ? gz('azure/indonesiacentral.json') : null;
const azGlobal = have ? gz('azure/global.json') : null;
const hasAzBackup = !!azJakarta?.some((r) => r.s === 'Backup');
const hasAzSqlLicence = !!azGlobal?.some((r) => r.s === 'SQL Database');
const hasAzOsLicence = !!azGlobal?.some((r) => r.s === 'Virtual Machines Licenses' && r.p === 'Red Hat Enterprise Linux');

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

function item(svc: string, spec: Item['spec'] = {}, qty = 1): Item {
  const i = newItem(svc);
  return { ...i, qty, spec: { ...i.spec, ...spec }, pricing: { model: 'od' } };
}

/** An add-on as it is created inside a parent of kind `on`. */
function addon(svc: string, on: string, spec: Item['spec'] = {}, parentSpec: Item['spec'] = {}): Item {
  const i = newItem(svc);
  return { ...i, spec: { ...i.spec, ...attachSpec(svc, { ...newItem(on), spec: parentSpec }), ...spec }, pricing: { model: 'od' } };
}

async function price(provider: Provider, region: string, it: Item) {
  return priceItem(ctxFor(manifest, provider, region), it);
}

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe.skipIf(!hasCloudFront || !hasAwsBackup)('AWS add-ons, CDN and backup', () => {
  it('CloudFront prices viewers in Asia Pacific from Jakarta', async () => {
    // 1,000 GB × $0.12 + 10M HTTPS × $0.0000012 = $132.00
    const p = await price('aws', 'ap-southeast-3', item('cdn', { gb: 1000, requests: 10_000_000 }));
    near(p.monthly, 132);
  });
  it('backups read the right AWS meter for what they protect', async () => {
    near((await price('aws', 'ap-southeast-3', addon('backup', 'disk', { gb: 200 }))).monthly, 10); // EBS snapshots $0.05
    near((await price('aws', 'ap-southeast-3', addon('backup', 'db', { gb: 100 }))).monthly, 9.5); // RDS backup $0.095
    near((await price('aws', 'ap-southeast-3', addon('backup', 'file', { gb: 100 }))).monthly, 5.45); // AWS Backup EFS $0.0545
  });
  it('Shield inside a load balancer leaves out the organization subscription', async () => {
    // 1,000 GB × $0.05; the $3,000 subscription stays on a card of its own.
    const inLb = await price('aws', 'ap-southeast-3', addon('ddos', 'lb', { gb: 1000 }));
    near(inLb.monthly, 50);
    const alone = await price('aws', 'ap-southeast-3', item('ddos', { gb: 1000 }));
    near(alone.monthly, 3050);
  });
  it('Shield on CloudFront bills the global CloudFront rate', async () => {
    near((await price('aws', 'ap-southeast-3', addon('ddos', 'cdn', { gb: 1000 }))).monthly, 25);
  });
  it('a WAF on an API gateway starts with the gateway request count', async () => {
    const w = addon('waf', 'apigw', {}, { requests: 2_000_000 });
    expect(w.spec.requests).toBe(2_000_000);
    expect(w.spec.on).toBe('apigw');
  });
});

describe.skipIf(!have)('Google Cloud and OCI add-ons, CDN and backup', () => {
  it('Cloud CDN prices cache egress to Asia and lookups', async () => {
    // 1,000 GiB × $0.09 + 10M × $0.00000075 = $97.50
    near((await price('gcp', 'asia-southeast2', item('cdn', { gb: 1000, requests: 10_000_000 }))).monthly, 97.5);
  });
  it('Google backups: PD snapshots, Cloud SQL backups, Filestore backups', async () => {
    near((await price('gcp', 'asia-southeast2', addon('backup', 'disk', { gb: 100 }))).monthly, 6.7);
    near((await price('gcp', 'asia-southeast2', addon('backup', 'db', { gb: 100 }))).monthly, 10.4);
    near((await price('gcp', 'asia-southeast2', addon('backup', 'file', { gb: 100 }))).monthly, 10);
  });
  it('Cloud Armor Enterprise on one load balancer: one protected resource, no enrolment', async () => {
    near((await price('gcp', 'asia-southeast2', addon('ddos', 'lb', { gb: 0 }))).monthly, 200);
  });
  it('OCI keeps backups in Object Storage, first 10 GB free', async () => {
    near((await price('oci', 'ap-singapore-1', addon('backup', 'vm', { gb: 1000 }))).monthly, 990 * 0.0255);
  });
  it('OCI has no CDN', async () => {
    expect((await price('oci', 'ap-singapore-1', item('cdn'))).unavailable).toMatch(/no CDN/);
  });
  it('a 1 Gbps Dedicated Interconnect prices as one 10 Gbps circuit, so a switch to Google is not blocked', async () => {
    const p = await price('gcp', 'asia-southeast2', item('interconnect', { kind: 'dedicated', cap: '1G', gb: 0 }));
    expect(p.unavailable).toBeUndefined();
    expect(p.notes.join(' ')).toMatch(/starts at 10 Gbps/);
  });
});

describe('commitments survive a cloud switch', () => {
  const models = (provider: Provider, svc = 'vm') => service(svc)!.providers[provider]!.models ?? [];
  it('an AWS Reserved Instance becomes a Google committed use discount of the same term', () => {
    expect(carryPricing({ model: 'ri', term: 3, pay: 'partial', cls: 's' }, models('gcp'))).toEqual({ model: 'cud', term: 3 });
  });
  it('a Savings Plan stays a Savings Plan on Azure, paid monthly', () => {
    expect(carryPricing({ model: 'sp', term: 1, pay: 'all', kind: 'c' }, models('azure'))).toEqual({ model: 'sp', term: 1, pay: 'no' });
  });
  it('an Azure reservation paid up front becomes an AWS standard RI paid up front', () => {
    expect(carryPricing({ model: 'ri', term: 3, pay: 'all' }, models('aws'))).toEqual({ model: 'ri', term: 3, pay: 'all', cls: 's' });
  });
  it('OCI has no commitment price, so it falls back to on demand', () => {
    expect(carryPricing({ model: 'ri', term: 1, pay: 'no' }, models('oci'))).toEqual({ model: 'od' });
  });
  it.skipIf(!have)('a moved VM carries its commitment and says so', async () => {
    const vm: Item = { ...item('vm'), pricing: { model: 'ri', term: 3, pay: 'no', cls: 's' } as Pricing };
    const moved = await moveItem(vm, 'aws', 'gcp', ctxFor(manifest, 'gcp', 'asia-southeast2'));
    expect(moved.pricing).toEqual({ model: 'cud', term: 3 });
    expect(moved.check).toMatch(/Was Reserved Instance/);
  });
});

describe('Azure regions by continent and ExpressRoute zone', () => {
  const ctx = (region: string) => ({ provider: 'azure' as const, region, regions: [] });
  it('"australiaeast" is Asia Pacific, not the US', () => {
    expect(continent('azure', 'australiaeast')).toBe('apac');
    expect(erZone(ctx('australiaeast'), {})).toBe('Zone 2');
  });
  it('zones follow Microsoft\'s peering-location table', () => {
    expect(erZone(ctx('eastus'), {})).toBe('Zone 1');
    expect(erZone(ctx('westeurope'), {})).toBe('Zone 1');
    expect(erZone(ctx('indonesiacentral'), {})).toBe('Zone 2');
    expect(erZone(ctx('brazilsouth'), {})).toBe('Zone 3');
    expect(erZone(ctx('uaenorth'), {})).toBe('Zone 3');
    expect(erZone(ctx('southafricanorth'), {})).toBe('Zone 3');
    expect(erZone(ctx('mexicocentral'), {})).toBe('Zone 4');
    expect(erZone(ctx('israelcentral'), {})).toBe('Zone 2');
    expect(erZone(ctx('eastus'), { 'azure.zone': 'Zone 3' })).toBe('Zone 3');
  });
});

describe('Azure OS licence lookup', () => {
  const row = (k: string, m: string, r: number, u = '1 Hour') => ({ s: 'Virtual Machines Licenses', p: 'x', k, m, u, t: 'c' as const, r });
  it('an exact size wins over a band', () => {
    const rows = [row('1-4 vCPU VM', '2 vCPU VM License', 0.0288), row('5+ vCPU VM', '8 vCPU VM License', 0.1152), row('5+ vCPU VM', '8 vCPU VM BYOS License', 0)];
    expect(osLicence(rows, 2)).toBe(0.0288);
    expect(osLicence(rows, 8)).toBe(0.1152);
  });
  it('a band covers sizes without their own meter', () => {
    const rows = [row('1-2 vCPU VM', '1-2 vCPU VM Support', 0.065), row('3-4 vCPU VM', '3-4 vCPU VM Support', 0.125), row('5+ vCPU VM', '5+ vCPU VM Support', 0.15)];
    expect(osLicence(rows, 2)).toBe(0.065);
    expect(osLicence(rows, 4)).toBe(0.125);
    expect(osLicence(rows, 16)).toBe(0.15);
  });
});

describe.skipIf(!hasAzBackup)('Azure Backup and Front Door', () => {
  it('a VM backup of 200 GB: one protected instance plus LRS storage', async () => {
    const p = await price('azure', 'indonesiacentral', addon('backup', 'vm', { gb: 200 }));
    expect(p.lines[0].qty).toBe(1);
    expect(p.lines.at(-1)!.qty).toBe(200);
  });
});

describe.skipIf(!hasAzSqlLicence)('Azure SQL Database includes the SQL licence', () => {
  it('General Purpose adds the licence; Hybrid Benefit drops it', async () => {
    const with_ = await price('azure', 'indonesiacentral', item('db', { engine: 'sqlserver-std', vcpu: 2, gb: 0 }));
    const own = await price('azure', 'indonesiacentral', item('db', { engine: 'sqlserver-std', vcpu: 2, gb: 0, 'azure.ahb': 'yes' }));
    // Licence: 2 vCore × 730 h × $0.099966
    near(with_.monthly - own.monthly, 2 * 730 * 0.099966);
  });
  it('Enterprise prices Business Critical', async () => {
    const p = await price('azure', 'indonesiacentral', item('db', { engine: 'sqlserver-ent', vcpu: 2, gb: 0 }));
    expect(p.sku).toMatch(/BC/);
    expect(p.lines.some((l) => l.label === 'SQL Server licence')).toBe(true);
  });
});

describe.skipIf(!hasAzOsLicence)('Azure VMs price RHEL, SUSE and Ubuntu Pro licences', () => {
  it('a 2 vCPU RHEL VM carries a licence line', async () => {
    const p = await price('azure', 'indonesiacentral', item('vm', { vcpu: 2, mem: 8, os: 'rhel' }));
    expect(p.unavailable).toBeUndefined();
    expect(p.lines.some((l) => /Red Hat/.test(l.label))).toBe(true);
  });
});
