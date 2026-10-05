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
import { sudFactor } from './catalog/vm';
import { reminders } from './reminders';

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

describe.skipIf(!have)('AWS', () => {
  it('m5.large Linux in us-east-1 is $0.096 an hour', async () => {
    const p = await price('aws', 'us-east-1', item('vm', { 'aws.type': 'm5.large' }));
    expect(p.unavailable).toBeUndefined();
    near(p.monthly, 0.096 * 730);
  });

  it('Windows m5.large in Jakarta uses the licence-included rate, not the :box row', async () => {
    const p = await price('aws', 'ap-southeast-3', item('vm', { 'aws.type': 'm5.large', os: 'windows' }));
    near(p.monthly, 0.212 * 730);
  });

  it('2 vCPU / 8 GiB picks a general purpose type, never burstable', async () => {
    const p = await price('aws', 'ap-southeast-3', item('vm', { vcpu: 2, mem: 8 }));
    expect(p.sku).toMatch(/^(m|c|r)\d/);
  });

  it('a 1-year all-upfront standard RI has no monthly charge and an upfront fee', async () => {
    const p = await price('aws', 'us-east-1', item('vm', { 'aws.type': 'm5.large' }, { model: 'ri', term: 1, pay: 'all', cls: 's' }));
    expect(p.monthly).toBe(0);
    expect(p.upfront).toBeGreaterThan(400);
    expect(p.upfront).toBeLessThan(0.096 * 8760);
  });

  it('a Compute Savings Plan beats on-demand', async () => {
    const od = await price('aws', 'ap-southeast-3', item('vm', { 'aws.type': 'm5.large' }));
    const sp = await price('aws', 'ap-southeast-3', item('vm', { 'aws.type': 'm5.large' }, { model: 'sp', kind: 'c', term: 3, pay: 'no' }));
    expect(sp.monthly).toBeLessThan(od.monthly * 0.75);
  });

  it('gp3 adds IOPS above 3,000 only', async () => {
    const base = await price('aws', 'ap-southeast-3', item('disk', { gb: 100, iops: 3000, mbps: 125 }));
    near(base.monthly, 100 * 0.096);
    const more = await price('aws', 'ap-southeast-3', item('disk', { gb: 100, iops: 4000, mbps: 125 }));
    near(more.monthly, 100 * 0.096 + 1000 * 0.006);
  });

  it('an ALB in Jakarta costs its hourly rate plus one LCU', async () => {
    const p = await price('aws', 'ap-southeast-3', item('lb', { type: 'app', lcu: 1 }));
    near(p.monthly, 730 * (0.0252 + 0.008));
  });

  it('internet egress in Jakarta is tiered from $0.132/GB', async () => {
    const p = await price('aws', 'ap-southeast-3', item('egress', { gb: 1000, to: 'internet' }));
    near(p.monthly, 132);
  });

  it('inter-region transfer Jakarta to Singapore uses the Singapore prefix', async () => {
    const p = await price('aws', 'ap-southeast-3', item('egress', { gb: 100, to: 'ap-southeast-1' }));
    expect(p.unavailable).toBeUndefined();
    expect(p.monthly).toBeGreaterThan(0);
  });

  it('Shield Advanced is $3,000 a month', async () => {
    const p = await price('aws', 'ap-southeast-3', item('ddos', { gb: 0 }));
    near(p.monthly, 3000);
  });

  it('RDS MySQL db.m5.large Single-AZ in Jakarta is $0.235 an hour plus gp3 storage', async () => {
    const p = await price('aws', 'ap-southeast-3', item('db', { engine: 'mysql', 'aws.class': 'db.m5.large', gb: 100 }));
    near(p.monthly, 0.235 * 730 + 100 * 0.138);
  });

  it('every service prices in Jakarta without a missing price', async () => {
    for (const svc of ['vm', 'k8s', 'containers', 'functions', 'disk', 'object', 'file', 'db', 'cache', 'vpc', 'lb', 'nat', 'ip', 'endpoint', 'egress', 'vpn', 'interconnect', 'dns', 'waf', 'ddos', 'apigw', 'queue', 'notify', 'monitoring', 'custom']) {
      const p = await price('aws', 'ap-southeast-3', item(svc));
      expect(p.unavailable, svc).toBeUndefined();
    }
  });
});

describe.skipIf(!have)('Google Cloud', () => {
  it('n2-standard-2 in Jakarta is core + RAM with the 20% sustained use discount', async () => {
    const p = await price('gcp', 'asia-southeast2', item('vm', { 'gcp.type': 'n2-standard-2' }));
    // Google's N2 schedule bills the four quarters of the month at 100%, 86.78%, 73.3% and 60%.
    near(p.monthly, (2 * 0.04250891 + 8 * 0.00569634) * 730 * 0.8002);
  });

  it('a 1-year commitment uses the commitment SKUs', async () => {
    const p = await price('gcp', 'asia-southeast2', item('vm', { 'gcp.type': 'n2-standard-2' }, { model: 'cud', term: 1 }));
    near(p.monthly, (2 * 0.02677803 + 8 * 0.00358828) * 730);
  });

  it('Windows adds $0.046 per vCPU-hour', async () => {
    const lin = await price('gcp', 'asia-southeast2', item('vm', { 'gcp.type': 'e2-standard-4' }));
    const win = await price('gcp', 'asia-southeast2', item('vm', { 'gcp.type': 'e2-standard-4', os: 'windows' }));
    near(win.monthly - lin.monthly, 4 * 730 * 0.046);
  });

  it('sustained use: N1 full month is 30% off, N2 is 20% off', () => {
    expect(sudFactor('n1', 730)).toBeCloseTo(0.7, 3);
    expect(sudFactor('n2', 730)).toBeCloseTo(0.8002, 3);
    expect(sudFactor('n2', 100)).toBe(1);
  });

  it('us-central1 is priced (shared "Americas" SKUs)', async () => {
    const p = await price('gcp', 'us-central1', item('vm', { 'gcp.type': 'e2-standard-2' }));
    expect(p.unavailable).toBeUndefined();
    expect(p.monthly).toBeGreaterThan(30);
  });

  it('every service prices in Jakarta, except the gateway load balancer', async () => {
    for (const svc of ['vm', 'k8s', 'containers', 'functions', 'disk', 'object', 'file', 'db', 'cache', 'vpc', 'lb', 'nat', 'ip', 'endpoint', 'egress', 'vpn', 'interconnect', 'dns', 'waf', 'ddos', 'apigw', 'queue', 'notify', 'monitoring', 'custom']) {
      const spec: Item['spec'] = svc === 'interconnect' ? { kind: 'dedicated', cap: '10G' } : {};
      const p = await price('gcp', 'asia-southeast2', item(svc, spec));
      expect(p.unavailable, svc).toBeUndefined();
    }
  });
});

describe.skipIf(!have)('Oracle Cloud', () => {
  it('E5 Flex with 2 vCPU / 8 GB is 1 OCPU + 8 GB', async () => {
    const p = await price('oci', 'ap-singapore-1', item('vm', { vcpu: 2, mem: 8 }));
    near(p.monthly, (0.03 + 8 * 0.002) * 730);
  });

  it('block volume balanced is storage plus 10 VPU per GB', async () => {
    const p = await price('oci', 'ap-singapore-1', item('disk', { gb: 100, type: 'ssd' }));
    near(p.monthly, 100 * 0.0255 + 100 * 10 * 0.0017);
  });

  it('every service prices, except gateway LB and SQL Server engines', async () => {
    for (const svc of ['vm', 'k8s', 'containers', 'functions', 'disk', 'object', 'file', 'db', 'cache', 'vpc', 'lb', 'nat', 'ip', 'endpoint', 'egress', 'vpn', 'interconnect', 'dns', 'waf', 'ddos', 'apigw', 'queue', 'notify', 'monitoring', 'custom']) {
      const p = await price('oci', 'ap-singapore-1', item(svc));
      expect(p.unavailable, svc).toBeUndefined();
    }
  });
});

describe.skipIf(!have)('moving between clouds', () => {
  it('a VM moved from AWS to Google Cloud keeps its size and is flagged for a check', async () => {
    const from = item('vm', { 'aws.type': 'm5.xlarge', vcpu: 4, mem: 16 });
    const moved = await moveItem(from, 'aws', 'gcp', ctxFor(manifest, 'gcp', 'asia-southeast2'));
    expect(moved.check).toBeTruthy();
    expect(moved.spec['aws.type']).toBeUndefined();
    const p = await price('gcp', 'asia-southeast2', moved);
    expect(p.sku).toMatch(/4 vCPU · 16 GiB/);
  });

  it('reminders ask for replication transfer and a link between two clouds', () => {
    const est = {
      v: 1 as const, name: 't',
      accounts: [
        { id: 'a', provider: 'aws' as const, label: 'DC', regions: [{ id: 'r1', region: 'ap-southeast-3', items: [item('vm')] }] },
        { id: 'b', provider: 'gcp' as const, label: 'DRC', regions: [{ id: 'r2', region: 'asia-southeast2', items: [item('vm')] }] },
      ],
    };
    const ids = reminders(est, new Map()).map((r) => r.id);
    expect(ids).toContain('replication');
    expect(ids).toContain('connect');
    expect(ids).toContain('disk-r1');
  });
});
