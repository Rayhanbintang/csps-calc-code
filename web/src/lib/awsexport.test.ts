import { describe, expect, it } from 'vitest';
import type { Estimate, Item, Priced } from './types';
import { newItem } from './engine';
import { ec2Rows, templateOS, templatePurchase } from './awsexport';

function vm(spec: Item['spec'], extra: Partial<Item> = {}): Item {
  const i = newItem('vm');
  return { ...i, spec: { ...i.spec, ...spec }, ...extra };
}

describe('EC2 template export', () => {
  it('writes AWS wording for OS, purchase, tenancy, usage and disks', () => {
    const disk = { ...newItem('disk'), qty: 2, spec: { gb: 100, type: 'ssd', 'aws.volume': 'gp3', iops: 3000, mbps: 125 } };
    const app = vm({ 'aws.type': 'm6i.large', os: 'windows', sw: 'sql-std', hours: 365 }, {
      name: 'App', qty: 2, children: [disk], pricing: { model: 'ri', term: 1, pay: 'partial', cls: 'c' },
    });
    const est: Estimate = { v: 1, name: 'x', accounts: [{ id: 'a', provider: 'aws', label: 'DC', regions: [{ id: 'r', region: 'ap-southeast-3', label: 'Prod', items: [app] }] }] };
    const { rows, skipped } = ec2Rows(est, new Map<string, Priced>());
    expect(skipped).toEqual([]);
    expect(rows[0]).toMatchObject({
      group: 'Prod', description: 'App', region: 'ap-southeast-3', type: 'm6i.large', count: 2,
      os: 'Windows Server with SQL Server Standard', tenancy: 'Shared Instances',
      purchase: '1 Yr Partial Upfront Convertible Reserved Instances Plan',
      // 365 h a month = 84 h a week
      usageType: 'Hours/Week', usage: 84,
      // two 100 GB gp3 disks per instance
      storage: 'General Purpose SSD (gp3)', gb: 200, iops: 6000, mbps: 250,
    });
  });

  it('counts VMs through their containers and takes the type from the price when not picked', () => {
    const node = vm({}, { qty: 3, name: 'Nodes' });
    const cluster = { ...newItem('k8s'), qty: 2, children: [node] };
    const est: Estimate = { v: 1, name: 'x', accounts: [{ id: 'a', provider: 'aws', label: 'DC', regions: [{ id: 'r', region: 'us-east-1', items: [cluster] }] }] };
    const prices = new Map<string, Priced>([[node.id, { lines: [], monthly: 1, upfront: 0, notes: [], sku: 'm5.large · 2 vCPU · 8 GiB' }]]);
    const { rows } = ec2Rows(est, prices);
    expect(rows[0]).toMatchObject({ type: 'm5.large', count: 6, usageType: 'Always On', usage: 0 });
  });

  it('leaves out what the template cannot say, with the reason', () => {
    expect(templateOS('ubuntu-pro', 'none')).toEqual({ no: "AWS's template has no Ubuntu Pro" });
    expect(templateOS('suse', 'sql-std')).toHaveProperty('no');
    expect(templateOS('rhel-ha', 'sql-ent')).toBe('Red Hat Enterprise Linux with HA and SQL Server Enterprise');
    expect(templatePurchase({ model: 'sp', term: 3, pay: 'all', kind: 'c' })).toBe('3 Yr All Upfront Compute Savings Plan');
  });
});
