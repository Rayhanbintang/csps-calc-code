// A priced, flattened copy of an estimate. The share link stores it so a link opened
// later shows the numbers the customer saw, and the export functions render it.
import type { Estimate, Line, Priced, Provider } from './types';
import type { Manifest } from './prices';
import { service } from './catalog';
import { accountKinds, pricingLabel, providerNames, sumTotals } from './engine';
import { subtotal, walk } from './tree';

export interface ReportItem {
  /** 0 for items in the region box, 1 inside a container, and so on. */
  depth: number;
  /** For containers: this item plus everything inside it. */
  subtotal?: number;
  subtotalUpfront?: number;
  name: string;
  service: string;
  product: string;
  sku: string;
  /** Count priced: own count times the counts of the containers above. */
  qty: number;
  /** Count entered on the card, before multiplying by containers. */
  ownQty: number;
  pricing: string;
  monthly: number;
  upfront: number;
  lines: Line[];
  notes: string[];
  unavailable?: string;
}

export interface ReportBox {
  region: string;
  regionName: string;
  label: string;
  monthly: number;
  upfront: number;
  items: ReportItem[];
}

export interface ReportAccount {
  provider: Provider;
  providerName: string;
  /** "AWS account", "Google Cloud project", ... */
  kind: string;
  /** Account ID, project ID, compartment; may be empty. */
  ref: string;
  label: string;
  monthly: number;
  upfront: number;
  boxes: ReportBox[];
}

export interface Report {
  v: 1;
  name: string;
  created: string;
  /** Oldest fetch date among the providers used, ISO. */
  pricesAsOf: string;
  monthly: number;
  upfront: number;
  firstYear: number;
  threeYear: number;
  accounts: ReportAccount[];
}

export const DISCLAIMER =
  'Estimate only. Prices are public list prices in USD and exclude taxes, support plans, negotiated discounts and free-tier credits unless a line says otherwise.';

export function buildReport(est: Estimate, prices: Map<string, Priced>, manifest: Manifest | undefined): Report {
  const used = new Set<Provider>();
  const accounts: ReportAccount[] = est.accounts.map((acc) => {
    if (acc.provider !== 'onprem') used.add(acc.provider);
    const regions = manifest?.providers[acc.provider]?.regions ?? [];
    const boxes: ReportBox[] = acc.regions.map((box) => {
      const items: ReportItem[] = [...walk(box.items)].map(({ item: it, mult, depth }) => {
        const p = prices.get(it.id);
        const svc = service(it.svc);
        const sub = it.children?.length ? subtotal(it, (id) => prices.get(id)) : undefined;
        return {
          depth,
          subtotal: sub?.monthly,
          subtotalUpfront: sub?.upfront,
          name: it.name || svc?.label || it.svc,
          service: svc?.label ?? it.svc,
          product: svc?.providers[acc.provider]?.product ?? '',
          sku: p?.sku ?? '',
          qty: it.qty * mult,
          ownQty: it.qty,
          pricing: pricingLabel(acc.provider, it.svc, it.pricing),
          monthly: p?.monthly ?? 0,
          upfront: p?.upfront ?? 0,
          lines: p?.lines ?? [],
          notes: p?.notes ?? [],
          unavailable: p?.unavailable,
        };
      });
      // Each item's price already counts its containers, so the box total is a plain sum.
      const t = sumTotals(items);
      return {
        region: box.region,
        regionName: acc.provider === 'onprem' ? 'On-premises' : regions.find((r) => r.code === box.region)?.name ?? box.region,
        label: box.label ?? '',
        ...t,
        items,
      };
    });
    return {
      provider: acc.provider,
      providerName: providerNames[acc.provider],
      kind: accountKinds[acc.provider].kind,
      ref: acc.ref ?? '',
      label: acc.label,
      ...sumTotals(boxes),
      boxes,
    };
  });
  const t = sumTotals(accounts);
  const dates = [...used].flatMap((p) => manifest?.providers[p]?.regions.map((r) => r.fetched) ?? []).sort();
  return {
    v: 1,
    name: est.name,
    created: new Date().toISOString(),
    pricesAsOf: dates[0] ?? manifest?.generated ?? '',
    monthly: t.monthly,
    upfront: t.upfront,
    firstYear: t.monthly * 12 + t.upfront,
    threeYear: t.monthly * 36 + t.upfront,
    accounts,
  };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdRate = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 8 });
const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function money(n: number): string {
  return usd.format(n || 0);
}

export function rate(n: number): string {
  return usdRate.format(n || 0);
}

export function qty(n: number): string {
  return plain.format(n || 0);
}

export function dateOnly(iso: string): string {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
