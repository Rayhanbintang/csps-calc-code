// Copies of cards, region boxes and sites, at 1:1 or scaled (a DRC at 50% of the DC).
// A copy is on its own: it keeps no link to what it came from, so a new size means
// deleting the copy and copying again.
//
// Scaling changes how many and how much (counts, GB, requests, data transfer). It keeps
// the shape of each thing (vCPU, memory, machine type, engine, tier): a DRC at 50% runs
// half the VMs of the same type, not the same number of VMs at half the size.
import type { Account, Item, RegionBox, Spec } from './types';
import { uid } from './engine';

/** Item counts that scale, per service. Containers that are a boundary (VPC, cluster)
 *  keep their count: half a VPC is still one VPC. */
const QTY: Record<string, boolean> = { vm: true, db: true, cache: true, lb: true, disk: true, custom: true, ip: true };

/** Spec fields that scale, per service: `count` rounds up and stays at least 1,
 *  `amount` rounds to a whole number. */
const FIELDS: Record<string, { count?: string[]; amount?: string[] }> = {
  vpc: { amount: ['natGb', 'endpointGb'], count: ['natVms', 'ips'] },
  functions: { amount: ['requests'] },
  containers: { count: ['tasks'] },
  db: { amount: ['gb'] },
  cache: { count: ['nodes'] },
  waf: { amount: ['requests'] },
  ddos: { amount: ['gb'], count: ['resources'] },
  apigw: { amount: ['requests'] },
  queue: { amount: ['requests'] },
  notify: { amount: ['publishes', 'http', 'email'] },
  monitoring: { amount: ['metrics', 'alarms', 'logs', 'stored'] },
  lb: { amount: ['gb', 'lcu'] },
  nat: { amount: ['gb'], count: ['vms'] },
  endpoint: { amount: ['gb'] },
  egress: { amount: ['gb'] },
  interconnect: { amount: ['gb'] },
  dns: { amount: ['queries'] },
  disk: { amount: ['gb'] },
  object: { amount: ['gb', 'puts', 'gets'] },
  file: { amount: ['gb'] },
};

/** A count at `f` times: rounded up, at least 1. */
export function scaleCount(n: number, f: number): number {
  return Math.max(1, Math.ceil(n * f - 1e-9));
}

/** An amount at `f` times: a whole number; a non-zero amount stays at least 1. */
export function scaleAmount(n: number, f: number): number {
  if (!n) return n;
  return Math.max(1, Math.round(n * f));
}

function scaleSpec(svc: string, spec: Spec, f: number): Spec {
  const rule = FIELDS[svc];
  if (!rule || f === 1) return { ...spec };
  const out: Spec = { ...spec };
  for (const k of rule.count ?? []) if (typeof out[k] === 'number') out[k] = scaleCount(out[k] as number, f);
  for (const k of rule.amount ?? []) if (typeof out[k] === 'number') out[k] = scaleAmount(out[k] as number, f);
  return out;
}

/** A copy of an item with new ids. `f` = 1 for the same size, 0.5 for half.
 *  `parentSvc` is the container the item sits in. Disks inside a VM copy unchanged: the VM
 *  count above them already scales, so their total follows it (2 of 4 VMs × 2 disks = 4). */
export function cloneItem(item: Item, withInside: boolean, f = 1, parentSvc: string | null = null): Item {
  const g = parentSvc === 'vm' ? 1 : f;
  const copy: Item = {
    ...structuredClone(item),
    id: uid(),
    qty: g !== 1 && QTY[item.svc] ? scaleCount(item.qty, g) : item.qty,
    spec: scaleSpec(item.svc, item.spec, g),
    children: withInside ? item.children?.map((c) => cloneItem(c, true, f, item.svc)) : undefined,
  };
  if (!copy.children?.length) delete copy.children;
  delete copy.folded;
  return copy;
}

export function cloneBox(box: RegionBox, f = 1): RegionBox {
  return { ...structuredClone(box), id: uid('r'), items: box.items.map((i) => cloneItem(i, true, f)) };
}

export function cloneAccount(acc: Account, f = 1): Account {
  return { ...structuredClone(acc), id: uid('a'), regions: acc.regions.map((r) => cloneBox(r, f)) };
}

/** Label for a copied site: "DC copy" at 1:1, "DC 50%" scaled. */
export function copyLabel(label: string, f: number): string {
  const base = label || 'Site';
  return f === 1 ? `${base} copy` : `${base} ${Math.round(f * 1000) / 10}%`;
}
