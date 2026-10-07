// App state: the estimate being edited, the selection and the prices of each item.
import { SvelteMap } from 'svelte/reactivity';
import type { Account, Estimate, Item, Priced, Provider, RegionBox } from './types';
import { loadManifest } from './prices';
import type { Manifest } from './prices';
import { ctxFor, estimateTotals, moveItem, newItem, priceItem, uid } from './engine';
import type { Totals } from './engine';
import { supportFee } from './support';
import { ADDONS, attachSpec, canHold, contains, findNode, walk } from './tree';
import type { Node } from './tree';
import { readSheet } from './xlsxread';
import { SHEET, parseTemplate } from './awsimport';
import type { ImportResult } from './awsimport';
import { syncVmSize } from './catalog/vm';
import { boxWidth, freeBoxSpot, freeSpot } from './board.svelte';
import { cloneAccount, cloneBox, cloneItem, copyLabel } from './copy';

const DRAFT_KEY = 'csps-calc:draft'; // before tabs: one estimate
const TABS_KEY = 'csps-calc:tabs';

export function blankEstimate(name = 'Untitled estimate'): Estimate {
  return {
    v: 1,
    name,
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

/** One open estimate. The tab on screen keeps its estimate in `app.est`; the others wait here. */
export interface Tab {
  id: string;
  est: Estimate;
  /** Monthly total when the tab was last on screen, so the tab bar can compare options. */
  monthly?: number;
}

interface Saved {
  tabs: Tab[];
  current: string;
}

function valid(e: unknown): e is Estimate {
  const x = e as Estimate;
  return !!x && x.v === 1 && Array.isArray(x.accounts);
}

function loadTabs(): Saved {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      const tabs = (s.tabs ?? []).filter((t) => t && typeof t.id === 'string' && valid(t.est));
      if (tabs.length) return { tabs, current: tabs.some((t) => t.id === s.current) ? s.current : tabs[0].id };
    }
    const old = localStorage.getItem(DRAFT_KEY);
    const e = old ? JSON.parse(old) : undefined;
    if (valid(e)) {
      const id = uid('t');
      return { tabs: [{ id, est: e }], current: id };
    }
  } catch {
    /* storage blocked or damaged: start fresh */
  }
  const id = uid('t');
  return { tabs: [{ id, est: blankEstimate() }], current: id };
}

function store(s: Saved): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(s));
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode or storage full: the tabs live only in this page */
  }
}

/** Keeps every tab in this browser, with the one on screen up to date. */
export function saveTabs(): void {
  const cur = $state.snapshot(app.est) as Estimate;
  store({
    tabs: app.tabs.map((t) => (t.id === app.tab ? { id: t.id, est: cur } : ($state.snapshot(t) as Tab))),
    current: app.tab,
  });
}

/** Opens an estimate as a new tab the next time the editor loads (the shared page uses it). */
export function saveDraft(e: Estimate): void {
  const s = loadTabs();
  const id = uid('t');
  store({ tabs: [...s.tabs, { id, est: e }], current: id });
}

const start = loadTabs();

export const app = $state({
  est: structuredClone(start.tabs.find((t) => t.id === start.current)!.est),
  tabs: start.tabs,
  tab: start.current,
  manifest: undefined as Manifest | undefined,
  manifestError: '',
  selected: null as string | null,
  /** Items ticked for bulk moves. */
  ticked: [] as string[],
  view: 'canvas' as 'canvas' | 'review',
  busy: 0,
  /** The copy dialog: what is being copied. */
  copy: null as { kind: 'item' | 'box' | 'site'; id: string } | null,
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

/** Prices the tabs that are not on screen, so the tab bar shows today's totals. Runs
 *  after the price list loads; it writes only `Tab.monthly`, never the estimate on screen. */
export async function repriceTabs(): Promise<void> {
  const m = app.manifest;
  if (!m) return;
  for (const t of app.tabs) {
    if (t.id === app.tab) continue;
    const est = $state.snapshot(t.est) as Estimate;
    let total = 0;
    const jobs: Promise<void>[] = [];
    const per = new Map<string, Totals>();
    const add = (accId: string, p: Priced) => {
      const t = per.get(accId) ?? { monthly: 0, upfront: 0 };
      per.set(accId, { monthly: t.monthly + p.monthly, upfront: t.upfront + p.upfront });
    };
    for (const acc of est.accounts)
      for (const box of acc.regions)
        for (const node of walk(box.items)) {
          const { children: _c, ...flat } = node.item;
          const item = { ...flat, qty: node.item.qty * node.mult };
          const key = keyOf(acc.provider, box.region, item);
          const hit = memo.get(key);
          if (hit) {
            add(acc.id, hit);
            continue;
          }
          jobs.push(
            priceItem(ctxFor(m, acc.provider, box.region), item).then((res) => {
              if (!res.unavailable) memo.set(key, res);
              add(acc.id, res);
            }),
          );
        }
    await Promise.all(jobs);
    for (const acc of est.accounts) {
      const t = per.get(acc.id) ?? { monthly: 0, upfront: 0 };
      total += t.monthly + (supportFee(acc.provider, acc.support, t.monthly, t.upfront)?.monthly ?? 0);
    }
    const still = app.tabs.find((x) => x.id === t.id);
    if (still && still.id !== app.tab) still.monthly = Math.round(total * 100) / 100;
  }
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
  const preferred: Record<Provider, string> = { aws: 'ap-southeast-3', gcp: 'asia-southeast2', oci: 'ap-singapore-1', azure: 'indonesiacentral', onprem: 'onprem' };
  const region = provider === 'onprem' ? 'onprem' : regions.find((r) => r.code === preferred[provider])?.code ?? regions[0]?.code ?? preferred[provider];
  const n = app.est.accounts.length;
  app.est.accounts.push({
    id: uid('a'),
    provider,
    label: n === 0 ? 'DC' : n === 1 ? 'DRC' : `Site ${n + 1}`,
    regions: [{ id: uid('r'), region, items: [], at: { x: 0, y: 0 } }],
    at: freeSpot(app.est),
  });
}

export function addRegion(accId: string): void {
  const acc = app.est.accounts.find((a) => a.id === accId);
  if (!acc) return;
  acc.regions.push({ id: uid('r'), region: acc.regions[acc.regions.length - 1]?.region ?? '', items: [], at: freeBoxSpot(acc) });
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

function targetList(t: Target): { acc: Account; box: RegionBox; list: Item[]; parent: Item | null } | undefined {
  const b = findBox(t.boxId);
  if (!b) return undefined;
  if (!t.parentId) return { ...b, list: b.box.items, parent: null };
  const p = find(t.parentId);
  if (!p || p.box.id !== t.boxId) return undefined;
  p.item.children ??= [];
  return { ...b, list: p.item.children, parent: p.item };
}

/** Why `svc` cannot go into the target, or undefined when it can. */
export function refuse(t: Target, svc: string): string | undefined {
  const parent = t.parentId ? find(t.parentId)?.item : undefined;
  if (canHold(parent?.svc ?? null, svc)) return undefined;
  return 'This card cannot hold that service.';
}

/** Adds a new item to a box or inside a container, at `index` (default: the end). */
export function addItem(boxId: string, svcId: string, spec?: Item['spec'], parentId?: string, index?: number, name?: string): string | undefined {
  if (refuse({ boxId, parentId }, svcId)) return;
  const t = targetList({ boxId, parentId });
  if (!t) return;
  const item = newItem(svcId);
  if (ADDONS.has(svcId)) item.spec = { ...item.spec, ...attachSpec(svcId, t.parent) };
  if (spec) item.spec = { ...item.spec, ...spec };
  if (name) item.name = name;
  t.list.splice(index ?? t.list.length, 0, item);
  app.selected = item.id;
  return item.id;
}

/** Opens the site and every container around an item, so its card is on screen. */
export function reveal(itemId: string): void {
  const f = find(itemId);
  if (!f) return;
  f.acc.folded = false;
  for (let n = f.parent; n; n = findNode(f.box.items, n.id)?.parent ?? null) n.folded = false;
}

/** Copies a card next to itself, alone or with what is inside it, at `f` times the size. */
export function copyItem(itemId: string, withInside: boolean, f = 1): void {
  const found = find(itemId);
  if (!found) return;
  const copy = cloneItem($state.snapshot(found.item) as Item, withInside, f, found.parent?.svc ?? null);
  found.list.splice(found.list.indexOf(found.item) + 1, 0, copy);
  app.selected = copy.id;
}

/** Copies a region box into the same site, to the right of its boxes. */
export function copyBox(boxId: string, f = 1): void {
  const found = findBox(boxId);
  if (!found) return;
  const copy = cloneBox($state.snapshot(found.box) as RegionBox, f);
  copy.at = { ...freeBoxSpot(found.acc), w: boxWidth(found.box) };
  delete copy.swap;
  found.acc.regions.push(copy);
}

/** Copies a whole site to a free spot on the right of the board. */
export function copySite(accId: string, f = 1): void {
  const acc = app.est.accounts.find((a) => a.id === accId);
  if (!acc) return;
  const copy = cloneAccount($state.snapshot(acc) as Account, f);
  copy.label = copyLabel(acc.label, f);
  copy.ref = undefined;
  copy.at = freeSpot(app.est);
  app.est.accounts.push(copy);
}

export function removeItem(itemId: string): void {
  const f = find(itemId);
  if (!f) return;
  const gone = new Set([...walk([f.item])].map((n) => n.item.id));
  f.list.splice(f.list.indexOf(f.item), 1);
  if (app.selected && gone.has(app.selected)) app.selected = null;
  app.ticked = app.ticked.filter((t) => !gone.has(t));
}

/** Deletes a card; a card with others inside asks first. */
export function askRemove(item: Item): void {
  const n = [...walk(item.children ?? [])].length;
  if (n && !confirm(`Delete ${item.name || item.svc} and the ${n} ${n === 1 ? 'card' : 'cards'} inside it?`)) return;
  removeItem(item.id);
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
    // An add-on moved to another resource now serves that one.
    if (ADDONS.has(next.svc)) next.spec = { ...next.spec, on: again.parent?.svc ?? '' };
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

// ---------------------------------------------------------------------------------
// Tabs: several estimates open at once, for example options A and B for one customer.
// ---------------------------------------------------------------------------------

function show(id: string): void {
  const cur = app.tabs.find((t) => t.id === app.tab);
  if (cur) {
    cur.est = $state.snapshot(app.est) as Estimate;
    cur.monthly = estimateTotals(app.est, prices).monthly;
  }
  const next = app.tabs.find((t) => t.id === id);
  if (!next) return;
  app.tab = id;
  app.est = $state.snapshot(next.est) as Estimate;
  app.selected = null;
  app.ticked = [];
}

export function openTab(id: string): void {
  if (id !== app.tab) show(id);
}

export function newTab(): void {
  const id = uid('t');
  app.tabs.push({ id, est: blankEstimate(`Option ${app.tabs.length + 1}`) });
  show(id);
}

/** Every id is new, so prices and selections of the two copies never mix. */
function fresh(e: Estimate): Estimate {
  const item = (i: Item): Item => ({ ...i, id: uid(), children: i.children?.map(item) });
  return {
    ...e,
    accounts: e.accounts.map((a) => ({ ...a, id: uid('a'), regions: a.regions.map((r) => ({ ...r, id: uid('r'), items: r.items.map(item) })) })),
  };
}

export function duplicateTab(id: string): void {
  const src = id === app.tab ? app.est : app.tabs.find((t) => t.id === id)?.est;
  if (!src) return;
  const copy = fresh($state.snapshot(src) as Estimate);
  copy.name = `${copy.name} (copy)`;
  const nid = uid('t');
  app.tabs.splice(app.tabs.findIndex((t) => t.id === id) + 1, 0, { id: nid, est: copy });
  show(nid);
}

export function closeTab(id: string): void {
  const i = app.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  if (app.tabs.length === 1) {
    app.est = blankEstimate();
    app.tabs[0].est = $state.snapshot(app.est) as Estimate;
    app.selected = null;
    app.ticked = [];
    return;
  }
  if (id === app.tab) show(app.tabs[i === 0 ? 1 : i - 1].id);
  app.tabs.splice(i, 1);
}

/** Name of a tab: the one on screen reads the live estimate. */
export function tabName(t: Tab): string {
  return (t.id === app.tab ? app.est.name : t.est.name) || 'Untitled estimate';
}

// ---------------------------------------------------------------------------------
// Import: the AWS Pricing Calculator "EC2 Instances" bulk upload template.
// ---------------------------------------------------------------------------------

/** Adds the rows of the template to the first AWS site of the tab on screen (a new
 *  AWS site when there is none). Returns what was imported and what was skipped. */
export async function importAwsTemplate(file: ArrayBuffer): Promise<ImportResult> {
  const rows = await readSheet(file, SHEET);
  const regions = (app.manifest?.providers.aws?.regions ?? []).map((r) => r.code);
  const res = parseTemplate(rows, regions);
  if (!res.rows) return res;
  // Fill vCPU and memory from the instance type, so a later move to another cloud matches by size.
  await Promise.all(
    res.boxes.flatMap((b) =>
      b.items.map(async (vm) => {
        vm.spec = await syncVmSize('aws', ctxFor(app.manifest, 'aws', b.region), vm.spec);
      }),
    ),
  );
  let acc = app.est.accounts.find((a) => a.provider === 'aws');
  if (!acc) {
    app.est.accounts.push({ id: uid('a'), provider: 'aws', label: 'Imported', regions: [] });
    acc = app.est.accounts[app.est.accounts.length - 1];
  }
  const emptyBefore = new Set(acc.regions.filter((r) => !r.items.length && !r.label).map((r) => r.id));
  for (const b of res.boxes) {
    let box = acc.regions.find((r) => r.region === b.region && (r.label ?? '') === b.group);
    if (!box) {
      acc.regions.push({ id: uid('r'), region: b.region, label: b.group || undefined, items: [] });
      box = acc.regions[acc.regions.length - 1];
    }
    box.items.push(...b.items);
  }
  // A blank starter box would only clutter the site after an import.
  acc.regions = acc.regions.filter((r) => !(emptyBefore.has(r.id) && !r.items.length));
  app.selected = null;
  return res;
}
