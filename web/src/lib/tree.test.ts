import { describe, expect, it } from 'vitest';
import type { Item } from './types';
import { attachSpec, canHold, contains, effectiveQty, findNode, subtotal, walk } from './tree';

const item = (id: string, svc: string, qty = 1, children?: Item[]): Item => ({ id, svc, qty, spec: {}, children });

// 1 VPC → 1 EKS → node group "stateful" (3 VMs, 2 EBS each) and a second group
// (5 VMs, 1 EBS each). The estimate must count 3 × 2 + 5 × 1 = 11 EBS volumes.
const tree = [
  item('vpc', 'vpc', 1, [
    item('eks', 'k8s', 1, [
      item('stateful', 'vm', 3, [item('ebs-a', 'disk', 1), item('ebs-b', 'disk', 1)]),
      item('web', 'vm', 5, [item('ebs-c', 'disk', 1)]),
    ]),
  ]),
];

describe('counts multiply down the tree', () => {
  it('the example has 11 EBS volumes and 8 VMs', () => {
    const nodes = [...walk(tree)];
    const disks = nodes.filter((n) => n.item.svc === 'disk').reduce((s, n) => s + effectiveQty(n), 0);
    const vms = nodes.filter((n) => n.item.svc === 'vm').reduce((s, n) => s + effectiveQty(n), 0);
    expect(disks).toBe(11);
    expect(vms).toBe(8);
  });

  it('a count on the VPC multiplies everything inside it', () => {
    const two = [{ ...tree[0], qty: 2 }];
    const disks = [...walk(two)].filter((n) => n.item.svc === 'disk').reduce((s, n) => s + effectiveQty(n), 0);
    expect(disks).toBe(22);
  });

  it('finds a deep item with its multiplier and depth', () => {
    const n = findNode(tree, 'ebs-c')!;
    expect(n.mult).toBe(5);
    expect(n.depth).toBe(3);
    expect(n.parent?.id).toBe('web');
  });

  it('a container subtotal adds itself and everything inside', () => {
    const price = (id: string) => ({ monthly: id === 'eks' ? 73 : id.startsWith('ebs') ? 10 : 50, upfront: 0 });
    // eks 73 + stateful 50 + 2 disks 20 + web 50 + 1 disk 10 = 203
    expect(subtotal(tree[0].children![0], price).monthly).toBe(203);
  });

  it('knows when a target sits inside the item being moved', () => {
    expect(contains(tree[0], 'ebs-a')).toBe(true);
    expect(contains(tree[0].children![0].children![1], 'ebs-a')).toBe(false);
  });
});

describe('nesting rules', () => {
  it('VMs hold disks and their add-ons', () => {
    expect(canHold('vm', 'disk')).toBe(true);
    expect(canHold('vm', 'backup')).toBe(true);
    expect(canHold('vm', 'vm')).toBe(false);
    expect(canHold('vm', 'db')).toBe(false);
  });
  it('disks never sit directly in a VPC or a cluster', () => {
    expect(canHold('vpc', 'disk')).toBe(false);
    expect(canHold('k8s', 'disk')).toBe(false);
  });
  it('managed services stay at region-box level', () => {
    for (const svc of ['db', 'cache', 'object', 'functions', 'queue', 'apigw']) {
      expect(canHold('vpc', svc)).toBe(false);
      expect(canHold('k8s', svc)).toBe(false);
      expect(canHold(null, svc)).toBe(true);
    }
  });
  it('a VPC holds clusters, VMs, containers and load balancers', () => {
    for (const svc of ['k8s', 'vm', 'containers', 'lb']) expect(canHold('vpc', svc)).toBe(true);
    expect(canHold('k8s', 'vm')).toBe(true);
    expect(canHold('k8s', 'lb')).toBe(false);
  });
});

describe('quick-add buttons', () => {
  it('every quick-add child is allowed in its container', async () => {
    const { QUICK } = await import('./tree');
    for (const [parent, list] of Object.entries(QUICK)) {
      for (const [svc] of list) expect(canHold(parent === 'box' ? null : parent, svc), `${parent} > ${svc}`).toBe(true);
    }
    expect(QUICK.vm.map(([s]) => s)).toEqual(['disk', 'backup', 'monitoring']);
  });
});

describe('add-ons sit inside what they serve', () => {
  it('WAF attaches to load balancers, API gateways and CDNs only', () => {
    for (const p of ['lb', 'apigw', 'cdn']) expect(canHold(p, 'waf'), p).toBe(true);
    for (const p of ['vpc', 'vm', 'db']) expect(canHold(p, 'waf'), p).toBe(false);
  });
  it('a VPC holds an ALB that holds a WAF', () => {
    expect(canHold('vpc', 'lb') && canHold('lb', 'waf')).toBe(true);
  });
  it('a WAF on each of 2 ALBs prices 2 web ACLs', () => {
    const waf = it_('waf', 1);
    const alb: Item = { ...it_('lb', 2), children: [waf] };
    const n = [...walk([alb])].find((x) => x.item.svc === 'waf')!;
    expect(effectiveQty(n)).toBe(2);
  });
  it('starting values come from the parent', () => {
    const api: Item = { ...it_('apigw', 1), spec: { requests: 5_000_000 } };
    expect(attachSpec('waf', api)).toMatchObject({ on: 'apigw', acls: 1, requests: 5_000_000 });
    expect(attachSpec('ddos', it_('lb', 1))).toMatchObject({ on: 'lb', resources: 1, sub: 'no' });
    const disk: Item = { ...it_('disk', 1), spec: { gb: 250 } };
    expect(attachSpec('backup', disk)).toMatchObject({ on: 'disk', what: 'vm', gb: 250 });
    expect(attachSpec('backup', { ...it_('db', 1), spec: { gb: 80 } })).toMatchObject({ what: 'db', gb: 80 });
    expect(attachSpec('waf', null)).toEqual({ on: '' });
  });
});

function it_(svc: string, qty: number): Item {
  return { id: `${svc}-${Math.random()}`, svc, qty, spec: {} };
}
