// Prices items, moves them between boxes, and adds up totals.
import type { Account, Estimate, Item, Priced, Pricing, Provider, RegionBox } from './types';
import { service } from './catalog';
import type { Ctx, ModelOption } from './catalog';
import type { Manifest } from './prices';
import { unavailable } from './catalog/util';
import { syncVmSize } from './catalog/vm';
import { walk } from './tree';

export const providerNames: Record<Provider, string> = {
  aws: 'AWS',
  gcp: 'Google Cloud',
  oci: 'Oracle Cloud',
  azure: 'Microsoft Azure',
  onprem: 'On-premises',
};

/** What a site is called on each provider. */
export const accountKinds: Record<Provider, { kind: string; ref: string }> = {
  aws: { kind: 'AWS account', ref: 'Account ID' },
  gcp: { kind: 'Google Cloud project', ref: 'Project ID' },
  oci: { kind: 'OCI compartment', ref: 'Compartment' },
  azure: { kind: 'Azure subscription', ref: 'Subscription ID' },
  onprem: { kind: 'Data centre', ref: 'Location' },
};

export function ctxFor(manifest: Manifest | undefined, provider: Provider, region: string): Ctx {
  const regions = manifest?.providers[provider]?.regions ?? [];
  return { provider, region, info: regions.find((r) => r.code === region), regions };
}

export async function priceItem(ctx: Ctx, item: Item): Promise<Priced> {
  const svc = service(item.svc);
  const impl = svc?.providers[ctx.provider];
  if (!svc || !impl) return unavailable(`${svc?.label ?? item.svc} is not offered on ${providerNames[ctx.provider]}.`);
  if (ctx.provider !== 'onprem' && !ctx.info) return unavailable('Pick a region for this box.');
  try {
    const p = await impl.price(ctx, item);
    return { ...p, monthly: round(p.monthly), upfront: round(p.upfront) };
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e));
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pricing options of an item on a provider, flattened for the discount panel. */
export function modelChoices(provider: Provider, svcId: string): { label: string; pricing: Pricing }[] {
  const models: ModelOption[] = service(svcId)?.providers[provider]?.models ?? [];
  const out: { label: string; pricing: Pricing }[] = [];
  for (const m of models) {
    if (m.model === 'od') {
      out.push({ label: m.label, pricing: { model: 'od' } });
      continue;
    }
    for (const term of m.terms ?? [1]) {
      const kinds: ('c' | 'e' | undefined)[] = m.kinds ? ['c', 'e'] : [undefined];
      const classes: ('s' | 'c' | undefined)[] = m.classes ? ['s', 'c'] : [undefined];
      const pays: ('no' | 'partial' | 'all' | undefined)[] = m.pays ?? [undefined];
      for (const kind of kinds) for (const cls of classes) for (const pay of pays) {
        const parts = [
          m.model === 'sp' ? (kind === 'e' ? 'EC2 Instance Savings Plan' : 'Compute Savings Plan') : m.label,
          cls === 'c' ? 'convertible' : cls === 's' ? 'standard' : '',
          `${term} yr`,
          pay ? `${pay === 'no' ? 'no' : pay === 'partial' ? 'partial' : 'all'} upfront` : '',
        ].filter(Boolean);
        out.push({ label: parts.join(', '), pricing: { model: m.model, term, pay, cls, kind } });
      }
    }
  }
  return out;
}

export function pricingLabel(provider: Provider, svcId: string, p: Pricing | undefined): string {
  const pr = p ?? { model: 'od' };
  const hit = modelChoices(provider, svcId).find((c) => samePricing(c.pricing, pr));
  return hit?.label ?? (provider === 'oci' ? 'Pay as you go' : 'On-demand');
}

export function samePricing(a: Pricing | undefined, b: Pricing | undefined): boolean {
  const x = a ?? { model: 'od' }, y = b ?? { model: 'od' };
  if (x.model !== y.model) return false;
  if (x.model === 'od') return true;
  return (x.term ?? 1) === (y.term ?? 1) && (x.pay ?? undefined) === (y.pay ?? undefined) && (x.cls ?? undefined) === (y.cls ?? undefined) && (x.kind ?? undefined) === (y.kind ?? undefined);
}

/** Monthly cost averaged over the commitment term, so options compare fairly. */
export function effectiveMonthly(p: Priced, pricing: Pricing | undefined): number {
  const months = pricing && pricing.model !== 'od' ? 12 * (pricing.term ?? 1) : 12;
  return p.monthly + p.upfront / months;
}

/** Called when an item lands in another box. Same provider keeps the spec. Everything
 *  inside a container moves with it and converts the same way. */
export async function moveItem(item: Item, from: Provider, to: Provider, ctx: Ctx): Promise<Item> {
  if (from === to) return item;
  const children = item.children ? await Promise.all(item.children.map((c) => moveItem(c, from, to, ctx))) : undefined;
  const impl = service(item.svc)?.providers[to];
  let moved: Item;
  if (!impl) moved = { ...item, check: `${service(item.svc)?.label} is not offered on ${providerNames[to]}.` };
  else if (impl.adopt) moved = await impl.adopt(ctx, item, from);
  // Flag only items where a type or class had to be matched; a VPC or a cluster carries
  // over as is.
  else moved = { ...item, pricing: { model: 'od' }, check: impl.fields ? `Moved from ${providerNames[from]}. Check the settings.` : undefined };
  return children ? { ...moved, children } : moved;
}

/** After the SA picks a type by hand, keep vCPU and memory in step so later moves match. */
export async function afterEdit(provider: Provider, ctx: Ctx, item: Item): Promise<Item> {
  if (item.svc === 'vm') return { ...item, spec: await syncVmSize(provider, ctx, item.spec), check: undefined };
  return { ...item, check: undefined };
}

export interface Totals {
  monthly: number;
  upfront: number;
}

export function sumTotals(list: Totals[]): Totals {
  return list.reduce((a, b) => ({ monthly: a.monthly + b.monthly, upfront: a.upfront + b.upfront }), { monthly: 0, upfront: 0 });
}

/** Each item's price already counts its containers, so a box total is a plain sum. */
export function boxTotals(box: RegionBox, prices: Map<string, Priced>): Totals {
  return sumTotals([...walk(box.items)].map((n) => prices.get(n.item.id) ?? { monthly: 0, upfront: 0 }));
}

export function accountTotals(acc: Account, prices: Map<string, Priced>): Totals {
  return sumTotals(acc.regions.map((r) => boxTotals(r, prices)));
}

export function estimateTotals(est: Estimate, prices: Map<string, Priced>): Totals {
  return sumTotals(est.accounts.map((a) => accountTotals(a, prices)));
}

/** Prices every item of an estimate with the given price list (each item at its count
 *  times its containers'). Used by the share page to show today's prices next to the saved ones. */
export async function priceEstimate(est: Estimate, manifest: Manifest): Promise<Map<string, Priced>> {
  const out = new Map<string, Priced>();
  const jobs: Promise<void>[] = [];
  for (const acc of est.accounts)
    for (const box of acc.regions) {
      const ctx = ctxFor(manifest, acc.provider, box.region);
      for (const n of walk(box.items)) {
        const { children: _c, ...flat } = n.item;
        jobs.push(priceItem(ctx, { ...flat, qty: n.item.qty * n.mult }).then((p) => void out.set(n.item.id, p)));
      }
    }
  await Promise.all(jobs);
  return out;
}

let counter = 0;
export function uid(prefix = 'i'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newItem(svcId: string): Item {
  const svc = service(svcId)!;
  return { id: uid(), svc: svcId, qty: 1, spec: { ...svc.defaults }, pricing: { model: 'od' } };
}
