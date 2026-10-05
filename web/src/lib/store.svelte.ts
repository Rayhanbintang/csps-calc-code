// App state: the estimate being edited, the selection and the prices of each item.
import { SvelteMap } from 'svelte/reactivity';
import type { Account, Estimate, Item, Priced, Provider, RegionBox } from './types';
import { loadManifest } from './prices';
import type { Manifest } from './prices';
import { ctxFor, moveItem, newItem, priceItem, uid } from './engine';

const DRAFT_KEY = 'csps-calc:draft';

export function blankEstimate(): Estimate {
  return {
    v: 1,
    name: 'Untitled estimate',
    accounts: [
      {
        id: uid('a'),
        provider: 'aws',
        label: 'DC',
        regions: [{ id: uid('r'), region: 'ap-southeast-3', items: [] }],
      },
    ],
  };
}

function loadDraft(): Estimate | undefined {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return undefined;
    const e = JSON.parse(raw) as Estimate;
    return e && e.v === 1 && Array.isArray(e.accounts) ? e : undefined;
  } catch {
    return undefined;
  }
}

export function saveDraft(e: Estimate): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(e));
  } catch {
    /* private mode or storage full: the draft lives only in this tab */
  }
}

export const app = $state({
  est: loadDraft() ?? blankEstimate(),
  manifest: undefined as Manifest | undefined,
  manifestError: '',
  selected: null as string | null,
  /** Items ticked for bulk moves. */
  ticked: [] as string[],
  view: 'canvas' as 'canvas' | 'review',
  busy: 0,
});

export const prices = new SvelteMap<string, Priced>();

loadManifest()
  .then((m) => (app.manifest = m))
  .catch((e) => (app.manifestError = String(e)));

// ---------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------

export function find(itemId: string): { acc: Account; box: RegionBox; item: Item } | undefined {
  for (const acc of app.est.accounts)
    for (const box of acc.regions) {
      const item = box.items.find((i) => i.id === itemId);
      if (item) return { acc, box, item };
    }
  return undefined;
}

export function findBox(boxId: string): { acc: Account; box: RegionBox } | undefined {
  for (const acc of app.est.accounts) {
    const box = acc.regions.find((r) => r.id === boxId);
    if (box) return { acc, box };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------
// Pricing: each item is priced again only when its own inputs change.
// ---------------------------------------------------------------------------------

const memo = new Map<string, Priced>();
const inflight = new Map<string, Promise<Priced>>();

function keyOf(provider: Provider, region: string, item: Item): string {
  return JSON.stringify([provider, region, item.svc, item.qty, item.spec, item.pricing ?? null]);
}

export async function repriceAll(): Promise<void> {
  const m = app.manifest;
  const live = new Set<string>();
  const jobs: Promise<void>[] = [];
  for (const acc of app.est.accounts)
    for (const box of acc.regions)
      for (const item of box.items) {
        live.add(item.id);
        const key = keyOf(acc.provider, box.region, item);
        const hit = memo.get(key);
        if (hit) {
          if (prices.get(item.id) !== hit) prices.set(item.id, hit);
          continue;
        }
        const snapshot = $state.snapshot(item) as Item;
        const ctx = ctxFor(m, acc.provider, box.region);
        let p = inflight.get(key);
        if (!p) {
          p = priceItem(ctx, snapshot);
          inflight.set(key, p);
        }
        app.busy++;
        jobs.push(
          p.then((res) => {
            // Failed lookups are not kept, so a network hiccup does not stick.
            if (!res.unavailable) memo.set(key, res);
            inflight.delete(key);
            if (find(item.id)) prices.set(item.id, res);
          }).finally(() => app.busy--),
        );
      }
  for (const id of [...prices.keys()]) if (!live.has(id)) prices.delete(id);
  await Promise.all(jobs);
}

/** Prices one item under another pricing model, for the comparison table. */
export async function priceVariant(itemId: string, pricing: Item['pricing']): Promise<Priced | undefined> {
  const f = find(itemId);
  if (!f) return undefined;
  const item = { ...($state.snapshot(f.item) as Item), pricing };
  const key = keyOf(f.acc.provider, f.box.region, item);
  const hit = memo.get(key);
  if (hit) return hit;
  const res = await priceItem(ctxFor(app.manifest, f.acc.provider, f.box.region), item);
  if (!res.unavailable) memo.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------------

export function addAccount(provider: Provider): void {
  const regions = app.manifest?.providers[provider]?.regions ?? [];
  const preferred: Record<Provider, string> = { aws: 'ap-southeast-3', gcp: 'asia-southeast2', oci: 'ap-singapore-1', onprem: 'onprem' };
  const region = provider === 'onprem' ? 'onprem' : regions.find((r) => r.code === preferred[provider])?.code ?? regions[0]?.code ?? preferred[provider];
  const n = app.est.accounts.length;
  app.est.accounts.push({
    id: uid('a'),
    provider,
    label: n === 0 ? 'DC' : n === 1 ? 'DRC' : `Site ${n + 1}`,
    regions: [{ id: uid('r'), region, items: [] }],
  });
}

export function addRegion(accId: string): void {
  const acc = app.est.accounts.find((a) => a.id === accId);
  if (!acc) return;
  acc.regions.push({ id: uid('r'), region: acc.regions[acc.regions.length - 1]?.region ?? '', items: [] });
}

export function removeAccount(accId: string): void {
  app.est.accounts = app.est.accounts.filter((a) => a.id !== accId);
}

export function removeRegion(boxId: string): void {
  for (const acc of app.est.accounts) acc.regions = acc.regions.filter((r) => r.id !== boxId);
}

export function addItem(boxId: string, svcId: string, spec?: Item['spec']): void {
  const f = findBox(boxId);
  if (!f) return;
  const item = newItem(svcId);
  if (spec) item.spec = { ...item.spec, ...spec };
  f.box.items.push(item);
  app.selected = item.id;
}

export function duplicateItem(itemId: string): void {
  const f = find(itemId);
  if (!f) return;
  const copy = { ...($state.snapshot(f.item) as Item), id: uid() };
  f.box.items.splice(f.box.items.indexOf(f.item) + 1, 0, copy);
  app.selected = copy.id;
}

export function removeItem(itemId: string): void {
  const f = find(itemId);
  if (!f) return;
  f.box.items = f.box.items.filter((i) => i.id !== itemId);
  if (app.selected === itemId) app.selected = null;
  app.ticked = app.ticked.filter((t) => t !== itemId);
}

/** Moves items into another box. Crossing to another cloud matches them by size. */
export async function moveItems(itemIds: string[], toBoxId: string): Promise<void> {
  const dest = findBox(toBoxId);
  if (!dest) return;
  for (const id of itemIds) {
    const f = find(id);
    if (!f || f.box.id === toBoxId) continue;
    const snapshot = $state.snapshot(f.item) as Item;
    const moved = await moveItem(snapshot, f.acc.provider, dest.acc.provider, ctxFor(app.manifest, dest.acc.provider, dest.box.region));
    const from = find(id);
    if (!from) continue;
    from.box.items = from.box.items.filter((i) => i.id !== id);
    dest.box.items.push(moved);
  }
}

/** Changes the region of several boxes at once (bulk region change). */
export function setRegion(boxIds: string[], region: string): void {
  for (const id of boxIds) {
    const f = findBox(id);
    if (f && (app.manifest?.providers[f.acc.provider]?.regions ?? []).some((r) => r.code === region)) f.box.region = region;
  }
}

export function replaceEstimate(e: Estimate): void {
  app.est = e;
  app.selected = null;
  app.ticked = [];
}
