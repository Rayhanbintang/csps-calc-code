// Items can hold other items: VPC → cluster → VM → disk. A child's count multiplies by
// every container above it, so a node group of 3 VMs with 2 disks each prices 6 disks.
import type { Item } from './types';

/** What each container may hold. A region box (null) holds anything. */
export const HOLDS: Record<string, string[]> = {
  vpc: ['k8s', 'vm', 'containers', 'lb'],
  k8s: ['vm', 'containers'],
  vm: ['disk'],
};

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
