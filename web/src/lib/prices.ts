// Loads the price files written by the daily fetch. Files are gzipped JSON; the browser
// unpacks them with DecompressionStream. Each file is fetched once per page load.

export interface RegionInfo {
  code: string;
  name: string;
  prefix?: string;
  fetched: string;
  stale?: boolean;
}

export interface Manifest {
  generated: string;
  providers: Record<string, { regions: RegionInfo[] }>;
}

// ---- AWS shapes (see etl/internal/aws) ----
export type Tier = [number, number | null, number]; // from, to (null = no limit), usd
export interface AwsReserved { y: number; k: 's' | 'c'; p: 'no' | 'partial' | 'all'; h: number; u: number }
export interface AwsSP { k: 'c' | 'e'; y: number; p: 'no' | 'partial' | 'all'; h: number }
export interface AwsInstance {
  t: string; c: number; m: number; ar?: string; os: string; sw?: string; byol?: boolean;
  od: number; ri?: AwsReserved[]; sp?: AwsSP[];
}
export interface AwsUsageSP { k: string; sp: AwsSP[] }
export interface AwsRow {
  k: string; o?: string; f?: string; u: string; t: Tier[];
  a?: Record<string, string>; ri?: AwsReserved[];
}

// ---- GCP shapes (see etl/internal/gcp) ----
export interface GcpRow { s: string; d: string; g?: string; u: string; n: string; t: [number, number][] }

// ---- OCI shapes (see etl/internal/oci) ----
export interface OciRow { p: string; n: string; m: string; c: string; t: [number, number, number][] }

const base = '/prices';
const cache = new Map<string, Promise<unknown>>();

async function getGz<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = (async () => {
      const res = await fetch(`${base}/${path}.gz`);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      // Some servers mark .gz files with Content-Encoding: gzip and the browser unpacks
      // them already; only unpack bytes that still start with the gzip magic number.
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
        return JSON.parse(await new Response(stream).text()) as T;
      }
      return JSON.parse(new TextDecoder().decode(buf)) as T;
    })();
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

let manifestP: Promise<Manifest> | undefined;
export function loadManifest(): Promise<Manifest> {
  manifestP ??= fetch(`${base}/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
    return r.json();
  });
  return manifestP;
}

export const aws = {
  instances: (region: string) => getGz<AwsInstance[]>(`aws/${region}/ec2.json`),
  rows: (region: string, file: string) =>
    getGz<AwsRow[]>(`aws/${region}/${file}.json`).catch((e) => {
      // A service with no offer in a region has no file: treat it as "no prices here".
      if (String(e).includes('HTTP 404')) return [] as AwsRow[];
      throw e;
    }),
  global: (file: string) => getGz<AwsRow[]>(`aws/global/${file}.json`),
  /** Compute Savings Plan rates for Fargate and Lambda usage types. Missing until the
   *  first full price fetch after this file was added; then [] means "no rates". */
  sp: (region: string) =>
    getGz<AwsUsageSP[]>(`aws/${region}/sp.json`).catch((e) => {
      if (String(e).includes('HTTP 404')) return [] as AwsUsageSP[];
      throw e;
    }),
};

export const gcp = {
  region: (region: string) => getGz<GcpRow[]>(`gcp/${region}.json`),
  global: () => getGz<GcpRow[]>(`gcp/global.json`),
};

/** One Azure retail meter (see etl/internal/azure). Reservation prices cover the whole
 *  term; tiered meters repeat with a higher `f` (the unit count the price starts at). */
export interface AzRow {
  s: string; p: string; k: string; a?: string; m: string; u: string;
  t: 'c' | 'r'; y?: number; r: number; f?: number; z?: string; sp?: [number, number][];
}

export const azure = {
  region: (region: string) => getGz<AzRow[]>(`azure/${region}.json`),
  global: () => getGz<AzRow[]>(`azure/global.json`),
};

export const oci = {
  all: () => getGz<OciRow[]>(`oci/prices.json`),
};

/** The calculator never takes a free allowance off a total (freetier.ts shows them).
 *  With `chargeFree` on, a $0 first tier followed by a paid tier bills at the first paid
 *  rate. Tests switch it off to see which items a price list's free tier would change. */
export const tierPolicy = { chargeFree: true };

/** The tiers with a free first tier billed at the first paid rate, unless the $0 amount
 *  comes with the product itself (`included`, e.g. a disk's baseline IOPS). */
export function payFree<T>(tiers: T[], usd: (t: T) => number, withUsd: (t: T, usd: number) => T, included: boolean): T[] {
  if (included || !tierPolicy.chargeFree || tiers.length < 2 || usd(tiers[0]) !== 0) return tiers;
  const paid = tiers.find((t) => usd(t) > 0);
  if (!paid) return tiers;
  const rate = usd(paid);
  let free = true;
  return tiers.map((t) => {
    if (free && usd(t) === 0) return withUsd(t, rate);
    free = false;
    return t;
  });
}

/** Price of `qty` units through tiers, where each tier covers [from, to). */
export function tiered(tiers: Tier[], qty: number, included = false): number {
  let total = 0;
  for (const [from, to, usd] of payFree(tiers, (t) => t[2], (t, u) => [t[0], t[1], u] as Tier, included)) {
    if (qty <= from) break;
    const top = to === null ? qty : Math.min(qty, to);
    total += (top - from) * usd;
  }
  return total;
}

/** GCP tiers are [start, usd] pairs; a tier runs until the next one starts. */
export function gcpTiered(tiers: [number, number][], qty: number, included = false): number {
  const t: Tier[] = tiers.map(([from, usd], i) => [from, i + 1 < tiers.length ? tiers[i + 1][0] : null, usd]);
  return tiered(t, qty, included);
}

/** OCI tiers are [from, to, usd] with to = -1 for no limit. */
export function ociTiered(tiers: [number, number, number][], qty: number, included = false): number {
  return tiered(tiers.map(([f, t, u]) => [f, t < 0 ? null : t, u] as Tier), qty, included);
}
