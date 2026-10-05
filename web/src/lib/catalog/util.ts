import type { Item, Line, Priced, Provider, Spec } from '../types';
import type { AwsRow, GcpRow, OciRow, RegionInfo, Tier } from '../prices';
import { gcpTiered, ociTiered, tiered } from '../prices';

/** Everything a pricer knows about where an item sits. */
export interface Ctx {
  provider: Provider;
  region: string;
  info?: RegionInfo;
  /** All regions of the same provider, for inter-region choices. */
  regions: RegionInfo[];
}

export interface Option {
  value: string;
  label: string;
}

export interface Field {
  key: string;
  label: string;
  type: 'number' | 'select' | 'toggle' | 'text';
  unit?: string;
  min?: number;
  step?: number;
  options?: Option[];
  help?: string;
  /** Hide the field unless this returns true. */
  show?: (spec: Spec) => boolean;
}

/** Pricing models offered for an item on one provider. */
export interface ModelOption {
  model: 'od' | 'ri' | 'sp' | 'cud';
  label: string;
  terms?: (1 | 3)[];
  pays?: ('no' | 'partial' | 'all')[];
  classes?: boolean; // RI standard / convertible
  kinds?: boolean; // SP compute / EC2 instance
}

export interface ProviderImpl {
  /** Product name shown on the card, e.g. "Amazon EC2". */
  product: string;
  /** Extra provider-specific fields (machine type pickers). May load price data. */
  fields?: (ctx: Ctx, spec: Spec) => Promise<Field[]>;
  models?: ModelOption[];
  price: (ctx: Ctx, item: Item) => Promise<Priced>;
  /** Called after an item moves onto this provider from another one. */
  adopt?: (ctx: Ctx, item: Item, from: Provider) => Promise<Item>;
}

export interface Service {
  id: string;
  label: string;
  group: 'Compute' | 'Storage' | 'Database' | 'Networking' | 'Security' | 'Integration' | 'Operations' | 'Other';
  /** Short text for the palette. */
  blurb: string;
  fields: Field[];
  defaults: Spec;
  providers: Partial<Record<Provider, ProviderImpl>>;
}

export const H = 730; // hours in a billing month, as the providers' calculators use

export function line(label: string, qty: number, unit: string, rate: number): Line {
  return { label, qty, unit, rate, monthly: qty * rate };
}

/** A line priced through tiers; the rate shown is the effective average. */
export function tierLine(label: string, qty: number, unit: string, cost: number): Line {
  return { label, qty, unit, rate: qty > 0 ? cost / qty : 0, monthly: cost };
}

/** Sums the lines into a Priced result. */
export function priced(lines: Line[], extra: Partial<Priced> = {}): Priced {
  return {
    lines,
    monthly: lines.reduce((s, l) => s + l.monthly, 0),
    upfront: extra.upfront ?? 0,
    notes: extra.notes ?? [],
    sku: extra.sku,
  };
}

export function unavailable(reason: string, notes: string[] = []): Priced {
  return { lines: [], monthly: 0, upfront: 0, notes, unavailable: reason };
}

export function num(spec: Spec, key: string, fallback = 0): number {
  const v = Number(spec[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function str(spec: Spec, key: string, fallback = ''): string {
  const v = spec[key];
  return v === undefined || v === null ? fallback : String(v);
}

// ---- AWS row lookup ----
export function awsFind(rows: AwsRow[], key: string, op?: string, attrs?: Record<string, string>): AwsRow | undefined {
  return rows.find(
    (r) =>
      r.k === key &&
      (op === undefined || (r.o ?? '') === op) &&
      (!attrs || Object.entries(attrs).every(([k, v]) => r.a?.[k] === v)),
  );
}

export function awsRate(row: AwsRow | undefined): number {
  return row ? row.t[0][2] : NaN;
}

export function awsCost(row: AwsRow | undefined, qty: number): number {
  return row ? tiered(row.t, qty) : NaN;
}

// ---- GCP row lookup ----
export function gcpFind(rows: GcpRow[], pattern: RegExp, usage = 'OnDemand', svc?: string): GcpRow | undefined {
  return rows.find((r) => r.u === usage && (svc === undefined || r.s === svc) && pattern.test(r.d));
}

export function gcpRate(row: GcpRow | undefined): number {
  if (!row) return NaN;
  return row.t[row.t.length - 1][1];
}

export function gcpCost(row: GcpRow | undefined, qty: number): number {
  return row ? gcpTiered(row.t, qty) : NaN;
}

// ---- OCI row lookup ----
export function ociPart(rows: OciRow[], part: string): OciRow | undefined {
  return rows.find((r) => r.p === part);
}

export function ociCost(row: OciRow | undefined, qty: number): number {
  return row ? ociTiered(row.t, qty) : NaN;
}

/** Last (paid) rate of an OCI part, ignoring the free tier. */
export function ociRate(row: OciRow | undefined): number {
  return row ? row.t[row.t.length - 1][2] : NaN;
}

/** Throws when a price is missing, so the item shows as "not priced" instead of $0. */
export function must(n: number, what: string): number {
  if (!Number.isFinite(n)) throw new MissingPrice(what);
  return n;
}

export class MissingPrice extends Error {
  constructor(what: string) {
    super(`No price found for ${what} in this region.`);
  }
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const yesNo: Option[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export function opts(...pairs: [string, string][]): Option[] {
  return pairs.map(([value, label]) => ({ value, label }));
}

/** Continent of a region code, used to pick egress price groups. */
export function continent(provider: Provider, code: string): 'apac' | 'na' | 'eu' | 'sa' | 'me' | 'af' {
  const c = code.toLowerCase();
  if (provider === 'aws') {
    if (c.startsWith('ap-')) return 'apac';
    if (c.startsWith('us-') || c.startsWith('ca-') || c.startsWith('mx-')) return 'na';
    if (c.startsWith('eu-')) return 'eu';
    if (c.startsWith('sa-')) return 'sa';
    if (c.startsWith('me-') || c.startsWith('il-')) return 'me';
    return 'af';
  }
  if (provider === 'gcp') {
    if (c.startsWith('asia') || c.startsWith('australia')) return 'apac';
    if (c.startsWith('us-') || c.startsWith('northamerica')) return 'na';
    if (c.startsWith('europe')) return 'eu';
    if (c.startsWith('southamerica')) return 'sa';
    if (c.startsWith('me-')) return 'me';
    return 'af';
  }
  if (c.startsWith('ap-')) return 'apac';
  if (c.startsWith('us-') || c.startsWith('ca-') || c.startsWith('mx-')) return 'na';
  if (c.startsWith('eu-') || c.startsWith('uk-')) return 'eu';
  if (c.startsWith('sa-')) return 'sa';
  if (c.startsWith('me-') || c.startsWith('il-')) return 'me';
  return 'af';
}

export type { Tier };
