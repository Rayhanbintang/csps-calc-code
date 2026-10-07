// Items can hold other items: VPC → cluster → VM → disk. A child's count multiplies by
// every container above it, so a node group of 3 VMs with 2 disks each prices 6 disks.
// Add-ons (WAF, DDoS protection, monitoring, backup) sit inside the resource they serve,
// so each resource carries its own add-on: one ALB with a 3-rule WAF, another with 1 rule.
import type { Item, Spec } from './types';

/** What each container may hold. A region box (null) holds anything. */
export const HOLDS: Record<string, string[]> = {
  vpc: ['k8s', 'vm', 'containers', 'lb'],
  k8s: ['vm', 'containers', 'monitoring'],
  vm: ['disk', 'monitoring', 'backup'],
  lb: ['waf', 'ddos', 'monitoring'],
  apigw: ['waf'],
  cdn: ['waf', 'ddos'],
  ip: ['ddos'],
  db: ['monitoring', 'backup'],
  disk: ['backup'],
  file: ['backup'],
};

/** Services that only make sense attached to something, shown that way on the card. */
export const ADDONS = new Set(['waf', 'ddos', 'monitoring', 'backup']);

const n = (spec: Spec, key: string, fallback: number) => {
  const v = Number(spec[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** Starting values for an add-on put inside `parent`, read from the parent where it says
 *  something useful (requests, storage size). The SA can change every one. `on` records
 *  the parent's kind; pricers read it (Shield inside a load balancer leaves out the
 *  once-per-organization subscription, for example). */
export function attachSpec(child: string, parent: Item | null): Spec {
  if (!parent) return { on: '' };
  const p = parent.spec;
  const on = parent.svc;
  switch (child) {
    case 'waf':
      return { on, acls: 1, rules: 5, requests: on === 'apigw' || on === 'cdn' ? n(p, 'requests', 10_000_000) : 10_000_000 };
    case 'ddos':
      return { on, resources: 1, sub: 'no' };
    case 'monitoring':
      return { on, metrics: 10, alarms: 5, logs: on === 'lb' ? 10 : 5, stored: 20 };
    case 'backup':
      return { on, what: on === 'db' ? 'db' : on === 'file' ? 'file' : 'vm', gb: n(p, 'gb', on === 'vm' ? 50 : 100) };
  }
  return { on };
}

export function isContainer(svc: string): boolean {
  return svc in HOLDS;
}

/** Whether `child` may sit directly inside `parent` (null = the region box itself). */
export function canHold(parent: string | null, child: string): boolean {
  if (parent === null) return true;
  return HOLDS[parent]?.includes(child) ?? false;
}

export interface Node {
  item: Item;
  /** Product of the counts of every container above this item. */
  mult: number;
  depth: number;
  parent: Item | null;
  /** The array that holds this item (box items or parent's children). */
  list: Item[];
}

/** Every item in the list and below it, parents before children. */
export function* walk(items: Item[], mult = 1, depth = 0, parent: Item | null = null): Generator<Node> {
  for (const item of items) {
    yield { item, mult, depth, parent, list: items };
    if (item.children?.length) yield* walk(item.children, mult * item.qty, depth + 1, item);
  }
}

export function findNode(items: Item[], id: string): Node | undefined {
  for (const n of walk(items)) if (n.item.id === id) return n;
  return undefined;
}

/** The count actually priced: the item's own count times every container above it. */
export function effectiveQty(n: Node): number {
  return n.item.qty * n.mult;
}

/** True when `id` is `root` or sits anywhere inside it. */
export function contains(root: Item, id: string): boolean {
  if (root.id === id) return true;
  return (root.children ?? []).some((c) => contains(c, id));
}

/** Monthly and upfront cost of an item plus everything inside it. */
export function subtotal(item: Item, price: (id: string) => { monthly: number; upfront: number } | undefined): { monthly: number; upfront: number } {
  const own = price(item.id) ?? { monthly: 0, upfront: 0 };
  return (item.children ?? []).reduce(
    (acc, c) => {
      const s = subtotal(c, price);
      return { monthly: acc.monthly + s.monthly, upfront: acc.upfront + s.upfront };
    },
    { monthly: own.monthly, upfront: own.upfront },
  );
}

/** Number of items in a subtree, the root included. */
export function size(item: Item): number {
  return 1 + (item.children ?? []).reduce((n, c) => n + size(c), 0);
}

/** Quick-add buttons per container, in the words an SA would use. The region box (key
 *  "box") offers the usual starting points. Every child listed must pass canHold. */
export const QUICK: Record<string, [string, string][]> = {
  box: [['vpc', 'VPC'], ['db', 'Database'], ['object', 'Object storage'], ['cdn', 'CDN'], ['egress', 'Data transfer']],
  vpc: [['k8s', 'Kubernetes cluster'], ['vm', 'VM'], ['lb', 'Load balancer'], ['containers', 'Serverless containers']],
  k8s: [['vm', 'Node group'], ['containers', 'Serverless pods'], ['monitoring', 'Monitoring']],
  vm: [['disk', 'Block storage'], ['backup', 'Backup'], ['monitoring', 'Monitoring']],
  lb: [['waf', 'WAF'], ['ddos', 'DDoS protection']],
  apigw: [['waf', 'WAF']],
  cdn: [['waf', 'WAF'], ['ddos', 'DDoS protection']],
  ip: [['ddos', 'DDoS protection']],
  db: [['backup', 'Backup'], ['monitoring', 'Monitoring']],
  disk: [['backup', 'Snapshots']],
  file: [['backup', 'Backup']],
};
