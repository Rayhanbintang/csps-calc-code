// App state: the estimate being edited, the selection and the prices of each item.
import { SvelteMap } from 'svelte/reactivity';
import type { Account, Estimate, Item, Priced, Provider, RegionBox } from './types';
import { loadManifest } from './prices';
import type { Manifest } from './prices';
import { ctxFor, moveItem, newItem, priceItem, uid } from './engine';
import { canHold, contains, findNode, walk } from './tree';
import type { Node } from './tree';

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

export interface Found extends Node {
  acc: Account;
  box: RegionBox;
}

/** Finds an item anywhere in the estimate, however deep it sits. */
export function find(itemId: string): Found | undefined {
  for (const acc of app.est.accounts)
    for (const box of acc.regions) {
      const n = findNode(box.items, itemId);
      if (n) return { ...n, acc, box };
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

/** A copy of the item as it is priced: its count times every container above it. */
function asPriced(n: Node): Item {
  const { children: _c, ...rest } = $state.snapshot(n.item) as Item;
  return { ...rest, qty: n.item.qty * n.mult };
}

export async function repriceAll(): Promise<void> {
  const m = app.manifest;
  const live = new Set<string>();
  const jobs: Promise<void>[] = [];
  for (const acc of app.est.accounts)
    for (const box of acc.regions)
      for (const node of walk(box.items)) {
        const item = node.item;
        live.add(item.id);
        const snapshot = asPriced(node);
        const key = keyOf(acc.provider, box.region, snapshot);
        const hit = memo.get(key);
        if (hit) {
          if (prices.get(item.id) !== hit) prices.set(item.id, hit);
          continue;
        }
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
  const item = { ...asPriced(f), pricing };
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

/** Where a new or moved item lands: a region box, or inside a container item. */
export interface Target {
  boxId: string;
  parentId?: string;
}

function targetList(t: Target): { acc: Account; box: RegionBox; list: Item[]; parentSvc: string | null } | undefined {
  const b = findBox(t.boxId);
  if (!b) return undefined;
  if (!t.parentId) return { ...b, list: b.box.items, parentSvc: null };
  const p = find(t.parentId);
  if (!p || p.box.id !== t.boxId) return undefined;
  p.item.children ??= [];
  return { ...b, list: p.item.children, parentSvc: p.item.svc };
}

/** Why `svc` cannot go into the target, or undefined when it can. */
export function refuse(t: Target, svc: string): string | undefined {
  const parent = t.parentId ? find(t.parentId)?.item : undefined;
  if (canHold(parent?.svc ?? null, svc)) return undefined;
  return 'This card cannot hold that service.';
}

/** Adds a new item to a box or inside a container, at `index` (default: the end). */
export function addItem(boxId: string, svcId: string, spec?: Item['spec'], parentId?: string, index?: number, name?: string): void {
  if (refuse({ boxId, parentId }, svcId)) return;
  const t = targetList({ boxId, parentId });
  if (!t) return;
  const item = newItem(svcId);
  if (spec) item.spec = { ...item.spec, ...spec };
  if (name) item.name = name;
  t.list.splice(index ?? t.list.length, 0, item);
  app.selected = item.id;
}

function cloneTree(item: Item): Item {
  return { ...item, id: uid(), children: item.children?.map(cloneTree) };
}

export function duplicateItem(itemId: string): void {
  const f = find(itemId);
  if (!f) return;
  const copy = cloneTree($state.snapshot(f.item) as Item);
  f.list.splice(f.list.indexOf(f.item) + 1, 0, copy);
  app.selected = copy.id;
}

export function removeItem(itemId: string): void {
  const f = find(itemId);
  if (!f) return;
  const gone = new Set([...walk([f.item])].map((n) => n.item.id));
  f.list.splice(f.list.indexOf(f.item), 1);
  if (app.selected && gone.has(app.selected)) app.selected = null;
  app.ticked = app.ticked.filter((t) => !gone.has(t));
}

/** Moves items, with everything inside them, into a box or a container, at `index`
 *  (default: the end). Within the same container this reorders. Crossing to another
 *  cloud matches each item by size. Moves the nesting rules forbid are skipped. */
export async function moveItems(itemIds: string[], to: Target | string, index?: number): Promise<number> {
  const target: Target = typeof to === 'string' ? { boxId: to } : to;
  let moved = 0;
  let at = index;
  for (const id of itemIds) {
    const f = find(id);
    if (!f) continue;
    if (target.parentId && contains(f.item, target.parentId)) continue; // into itself
    if (refuse(target, f.item.svc)) continue;
    const dest = targetList(target);
    if (!dest) continue;
    const snapshot = $state.snapshot(f.item) as Item;
    const next = dest.list === f.list
      ? snapshot
      : await moveItem(snapshot, f.acc.provider, dest.acc.provider, ctxFor(app.manifest, dest.acc.provider, dest.box.region));
    const from = find(id);
    const again = targetList(target);
    if (!from || !again) continue;
    const old = from.list.indexOf(from.item);
    from.list.splice(old, 1);
    let pos = at ?? again.list.length;
    // Removing the item shifts everything after it up by one.
    if (from.list === again.list && old < pos) pos -= 1;
    pos = Math.max(0, Math.min(pos, again.list.length));
    again.list.splice(pos, 0, next);
    if (at !== undefined) at = pos + 1; // keep a multi-item drop in order
    moved++;
  }
  return moved;
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
