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
