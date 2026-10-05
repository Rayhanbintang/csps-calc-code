// Switching a whole site to another cloud in place: AWS → GCP, GCP → OCI and so on.
// Each region box goes to the nearest region of the new cloud, and each item converts
// the same way a cross-cloud drag does.
import type { Account, Item, Provider } from './types';
import type { Manifest } from './prices';
import { service } from './catalog';
import { ctxFor, moveItem, priceItem, providerNames } from './engine';
import { walk } from './tree';

/** Approximate location [latitude, longitude] of each region's data centres. */
const AT: Record<string, [number, number]> = {
  // AWS
  'af-south-1': [-33.9, 18.4], 'ap-east-1': [22.3, 114.2], 'ap-east-2': [25.0, 121.5], 'ap-northeast-1': [35.7, 139.7],
  'ap-northeast-2': [37.6, 127.0], 'ap-northeast-3': [34.7, 135.5], 'ap-south-1': [19.1, 72.9], 'ap-south-2': [17.4, 78.5],
  'ap-southeast-1': [1.35, 103.8], 'ap-southeast-2': [-33.9, 151.2], 'ap-southeast-3': [-6.2, 106.8], 'ap-southeast-4': [-37.8, 145.0],
  'ap-southeast-5': [3.1, 101.7], 'ap-southeast-6': [-36.8, 174.8], 'ap-southeast-7': [13.8, 100.5], 'ca-central-1': [45.5, -73.6],
  'ca-west-1': [51.0, -114.1], 'eu-central-1': [50.1, 8.7], 'eu-central-2': [47.4, 8.5], 'eu-north-1': [59.3, 18.1],
  'eu-south-1': [45.5, 9.2], 'eu-south-2': [41.6, -0.9], 'eu-west-1': [53.3, -6.3], 'eu-west-2': [51.5, -0.1],
  'eu-west-3': [48.9, 2.4], 'il-central-1': [32.1, 34.8], 'me-central-1': [25.2, 55.3], 'me-south-1': [26.1, 50.6],
  'mx-central-1': [20.6, -100.4], 'sa-east-1': [-23.5, -46.6], 'us-east-1': [39.0, -77.5], 'us-east-2': [40.0, -83.0],
  'us-west-1': [37.4, -121.9], 'us-west-2': [45.6, -121.2],
  // Google Cloud
  'africa-south1': [-26.2, 28.0], 'asia-east1': [24.1, 120.5], 'asia-east2': [22.3, 114.2], 'asia-northeast1': [35.7, 139.7],
  'asia-northeast2': [34.7, 135.5], 'asia-northeast3': [37.6, 127.0], 'asia-south1': [19.1, 72.9], 'asia-south2': [28.6, 77.2],
  'asia-southeast1': [1.35, 103.8], 'asia-southeast2': [-6.2, 106.8], 'australia-southeast1': [-33.9, 151.2], 'australia-southeast2': [-37.8, 145.0],
  'europe-central2': [52.2, 21.0], 'europe-north1': [60.6, 27.2], 'europe-north2': [59.3, 18.1], 'europe-southwest1': [40.4, -3.7],
  'europe-west1': [50.5, 3.8], 'europe-west10': [52.5, 13.4], 'europe-west12': [45.1, 7.7], 'europe-west2': [51.5, -0.1],
  'europe-west3': [50.1, 8.7], 'europe-west4': [53.4, 6.8], 'europe-west6': [47.4, 8.5], 'europe-west8': [45.5, 9.2],
  'europe-west9': [48.9, 2.4], 'me-central1': [25.3, 51.5], 'me-central2': [26.4, 50.1], 'me-west1': [32.1, 34.8],
  'northamerica-northeast1': [45.5, -73.6], 'northamerica-northeast2': [43.7, -79.4], 'northamerica-south1': [20.6, -100.4],
  'southamerica-east1': [-23.5, -46.6], 'southamerica-west1': [-33.4, -70.6], 'us-central1': [41.3, -95.9], 'us-east1': [33.2, -80.0],
  'us-east4': [39.0, -77.5], 'us-east5': [40.0, -83.0], 'us-south1': [32.8, -96.8], 'us-west1': [45.6, -121.2],
  'us-west2': [34.1, -118.2], 'us-west3': [40.8, -111.9], 'us-west4': [36.2, -115.1], 'us-west8': [33.4, -112.1],
  // Oracle Cloud
  'af-johannesburg-1': [-26.2, 28.0], 'ap-batam-1': [1.1, 104.0], 'ap-chuncheon-1': [37.9, 127.7], 'ap-hyderabad-1': [17.4, 78.5],
  'ap-melbourne-1': [-37.8, 145.0], 'ap-mumbai-1': [19.1, 72.9], 'ap-osaka-1': [34.7, 135.5], 'ap-seoul-1': [37.6, 127.0],
  'ap-singapore-1': [1.35, 103.8], 'ap-singapore-2': [1.35, 103.7], 'ap-sydney-1': [-33.9, 151.2], 'ap-tokyo-1': [35.7, 139.7],
  'ca-montreal-1': [45.5, -73.6], 'ca-toronto-1': [43.7, -79.4], 'eu-amsterdam-1': [52.4, 4.9], 'eu-frankfurt-1': [50.1, 8.7],
  'eu-madrid-1': [40.4, -3.7], 'eu-marseille-1': [43.3, 5.4], 'eu-milan-1': [45.5, 9.2], 'eu-paris-1': [48.9, 2.4],
  'eu-stockholm-1': [59.3, 18.1], 'eu-zurich-1': [47.4, 8.5], 'il-jerusalem-1': [31.8, 35.2], 'me-abudhabi-1': [24.5, 54.4],
  'me-dubai-1': [25.2, 55.3], 'me-jeddah-1': [21.5, 39.2], 'me-riyadh-1': [24.7, 46.7], 'mx-monterrey-1': [25.7, -100.3],
  'mx-queretaro-1': [20.6, -100.4], 'sa-bogota-1': [4.7, -74.1], 'sa-santiago-1': [-33.4, -70.6], 'sa-saopaulo-1': [-23.5, -46.6],
  'sa-valparaiso-1': [-33.0, -71.6], 'sa-vinhedo-1': [-23.0, -46.98], 'uk-cardiff-1': [51.5, -3.2], 'uk-london-1': [51.5, -0.1],
  'us-ashburn-1': [39.0, -77.5], 'us-chicago-1': [41.9, -87.6], 'us-phoenix-1': [33.4, -112.1], 'us-sanjose-1': [37.3, -121.9],
};

function km(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** The region of the new cloud closest to `code`. Falls back to the first listed region. */
export function nearestRegion(code: string, candidates: string[]): string | undefined {
  const from = AT[code];
  if (!from) return candidates[0];
  let best: string | undefined, dist = Infinity;
  for (const c of candidates) {
    const at = AT[c];
    if (!at) continue;
    const d = km(from, at);
    if (d < dist) [best, dist] = [c, d];
  }
  return best ?? candidates[0];
}

/** Services in the site that the new cloud does not offer at all. */
export function swapBlockers(acc: Account, to: Provider): string[] {
  const missing = new Set<string>();
  for (const box of acc.regions)
    for (const n of walk(box.items)) {
      const svc = service(n.item.svc);
      if (!svc?.providers[to]) missing.add(svc?.label ?? n.item.svc);
    }
  return [...missing];
}

/** One item the new cloud cannot price, and the reason it gives. */
export interface Blocker {
  name: string;
  reason: string;
}

export function blockerMessage(to: Provider, missing: string[]): string {
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `${providerNames[to]} has no ${list}, so this site cannot switch to ${providerNames[to]}.`;
}

export interface SwapResult {
  acc: Account;
  /** Region of each box before and after. */
  moves: [string, string][];
  /** Items that price on the current cloud but not on the new one. Empty means the swap can go ahead. */
  blockers: Blocker[];
}

/** The converted site: same names and layout, the new cloud, the nearest regions. Each
 *  converted item is priced once, so a type the new cloud lacks (a gateway load balancer
 *  on Google Cloud, SQL Server on OCI) blocks the swap instead of turning up as $0.
 *  `pricedBefore` holds the ids that have a price today; items already unpriced do not block. */
export async function swapAccount(acc: Account, to: Provider, manifest: Manifest | undefined, pricedBefore: Set<string>): Promise<SwapResult> {
  const from = acc.provider;
  const codes = (manifest?.providers[to]?.regions ?? []).map((r) => r.code);
  const moves: [string, string][] = [];
  const blockers: Blocker[] = [];
  const regions = await Promise.all(
    acc.regions.map(async (box) => {
      const from_ = box.swap?.picked === box.region ? box.swap.from : box.region;
      const region = codes.includes(from_) ? from_ : nearestRegion(from_, codes) ?? box.region;
      moves.push([box.region, region]);
      const ctx = ctxFor(manifest, to, region);
      const items: Item[] = await Promise.all(box.items.map((i) => moveItem(i, from, to, ctx)));
      await Promise.all(
        [...walk(items)].map(async (n) => {
          if (!pricedBefore.has(n.item.id)) return;
          const { children: _c, ...flat } = n.item;
          const p = await priceItem(ctx, { ...flat, qty: n.item.qty * n.mult });
          if (p.unavailable) blockers.push({ name: n.item.name || service(n.item.svc)?.label || n.item.svc, reason: p.unavailable });
        }),
      );
      return { ...box, region, items, swap: { from: from_, picked: region } };
    }),
  );
  return { acc: { ...acc, provider: to, ref: undefined, regions }, moves, blockers };
}
