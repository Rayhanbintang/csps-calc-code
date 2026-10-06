import { describe, expect, it } from 'vitest';
import { cloneAccount, cloneItem, copyLabel, scaleAmount, scaleCount } from './copy';
import { walk } from './tree';
import type { Account, Item } from './types';

// VPC (NAT data 500 GB) → cluster → node group of 4 VMs, each with 2 disks of 100 GB;
// plus 3 standalone VMs in the VPC.
function vpc(): Item {
  return {
    id: 'v', svc: 'vpc', qty: 1, spec: { nat: 2, natGb: 500, natVms: 10 },
    children: [
      { id: 'k', svc: 'k8s', qty: 1, spec: {}, children: [
        { id: 'n', svc: 'vm', qty: 4, spec: { vcpu: 4, mem: 16 }, children: [{ id: 'd', svc: 'disk', qty: 2, spec: { gb: 100 } }] },
      ] },
      { id: 'w', svc: 'vm', qty: 3, spec: { vcpu: 2, mem: 8 } },
    ],
  };
}

describe('copy', () => {
  it('rounds counts up and keeps amounts whole', () => {
    expect(scaleCount(3, 0.5)).toBe(2); // 1.5 → 2
    expect(scaleCount(4, 0.5)).toBe(2);
    expect(scaleCount(1, 0.1)).toBe(1); // never 0
    expect(scaleCount(10, 1.3)).toBe(13);
    expect(scaleAmount(500, 0.5)).toBe(250);
    expect(scaleAmount(0, 0.5)).toBe(0);
    expect(scaleAmount(1, 0.1)).toBe(1); // a used amount stays at least 1
  });

  it('copies at 1:1 with new ids everywhere', () => {
    const src = vpc();
    const c = cloneItem(src, true);
    const ids = [...walk([c])].map((n) => n.item.id);
    expect(ids).toHaveLength(5);
    expect(ids.some((id) => ['v', 'k', 'n', 'd', 'w'].includes(id))).toBe(false);
    expect(new Set(ids).size).toBe(5);
    expect(c.children![0].children![0].qty).toBe(4);
    expect(src.children![1].qty).toBe(3); // the original is untouched
  });

  it('scales to 50%: VM counts and usage halve, shapes and per-VM disks stay', () => {
    const c = cloneItem(vpc(), true, 0.5);
    expect(c.qty).toBe(1); // a VPC stays one VPC
    expect(c.spec).toEqual({ nat: 2, natGb: 250, natVms: 5 }); // NAT gateways keep their count
    const nodes = c.children![0].children![0];
    expect(nodes.qty).toBe(2); // 4 × 50%
    expect(nodes.spec).toEqual({ vcpu: 4, mem: 16 }); // same machine size
    expect(nodes.children![0].qty).toBe(2); // still 2 disks per VM: 2 VMs × 2 = 4 disks in total
    expect(nodes.children![0].spec.gb).toBe(100); // per-VM disk unchanged; total storage halves with the VMs
    expect(c.children![1].qty).toBe(2); // 3 × 50% = 1.5 → 2
  });

  it('scales to 130%', () => {
    const c = cloneItem(vpc(), true, 1.3);
    expect(c.children![0].children![0].qty).toBe(6); // 4 × 1.3 = 5.2 → 6
    expect(c.children![1].qty).toBe(4); // 3 × 1.3 = 3.9 → 4
    expect(c.spec.natGb).toBe(650);
  });

  it('copies a container alone', () => {
    const c = cloneItem(vpc(), false);
    expect(c.children).toBeUndefined();
  });

  it('copies a site with new ids and a label', () => {
    const acc: Account = { id: 'a', provider: 'aws', label: 'DC', at: { x: 0, y: 0 }, regions: [{ id: 'r', region: 'ap-southeast-3', items: [vpc()] }] };
    const c = cloneAccount(acc, 0.5);
    expect(c.id).not.toBe('a');
    expect(c.regions[0].id).not.toBe('r');
    expect(c.regions[0].items[0].children![1].qty).toBe(2);
    expect(copyLabel('DC', 0.5)).toBe('DC 50%');
    expect(copyLabel('DC', 1)).toBe('DC copy');
  });
});
