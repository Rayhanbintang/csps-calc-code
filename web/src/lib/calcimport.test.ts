import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { calcRows, parseCalcCsv, parseCsv, parseSummary, strategy, workload } from './calcimport';
import { parseEbsTemplate, templateKind } from './awsimport';

// A real export from calculator.aws (2026-10-12): VPC services and one EC2 row.
const csv = readFileSync(new URL('./fixtures/calc-estimate.csv', import.meta.url), 'utf8');
const REGIONS = [{ code: 'ap-southeast-3', name: 'Asia Pacific (Jakarta)' }, { code: 'eu-west-3', name: 'EU (Paris)' }];

describe('calculator.aws CSV export', () => {
  it('reads the detailed table and stops at the acknowledgement', () => {
    const rows = calcRows(parseCsv(csv));
    expect(rows).toHaveLength(14);
    expect(rows[13]).toMatchObject({ service: 'Amazon EC2', region: 'Asia Pacific (Jakarta)', monthly: 62.326765 });
  });

  it('splits the configuration summary outside brackets only', () => {
    expect(parseSummary('Tenancy (Shared Instances), Workload (Daily, (Baseline: 1, Peak: 2)), Advance EC2 instance (t4g.nano)')).toEqual({
      Tenancy: 'Shared Instances', Workload: 'Daily, (Baseline: 1, Peak: 2)', 'Advance EC2 instance': 't4g.nano',
    });
  });

  it('turns a daily peak into a steady card and a peak card with its hours', () => {
    // 8 h 30 min on 5 days a week: 8.5 × 5 × 730 / 168 = 184.7 → 185 hours a month.
    expect(workload('Daily, (Workload days: Monday, Tuesday, Wednesday, Thursday, Friday, Baseline: 1, Peak: 2, Duration of peak: 8 Hr 30 Min)'))
      .toEqual({ base: 1, peak: { count: 1, hours: 185 } });
    expect(workload('Consistent, Number of instances: 4')).toEqual({ base: 4 });
    expect(strategy('Compute Savings Plans 3yr  No Upfront')).toEqual({ model: 'sp', term: 3, pay: 'no', kind: 'c' });
  });

  it('prices what it can read and keeps AWS\'s figure for the rest', () => {
    const res = parseCalcCsv(csv, REGIONS);
    expect(res.skipped).toEqual([]);
    expect(res.rows).toBe(14); // every row of the export, counted once
    const items = res.boxes.flatMap((b) => b.items);
    const vms = items.filter((i) => i.svc === 'vm');
    expect(vms.map((v) => [v.spec['aws.type'], v.qty, v.spec.hours])).toEqual([['t4g.nano', 1, 730], ['t4g.nano', 1, 185]]);
    expect(vms[0].pricing).toEqual({ model: 'sp', term: 3, pay: 'no', kind: 'c' });
    expect(vms[0].children?.[0].spec).toMatchObject({ gb: 200, 'aws.volume': 'gp3' });
    const vpc = items.find((i) => i.svc === 'vpc')!;
    expect(vpc.spec).toMatchObject({ endpoints: 2, ips: 15 });
    // 10 TB out to the internet = 10,240 GB.
    expect(items.find((i) => i.svc === 'egress')?.spec.gb).toBe(10240);
    expect(items.find((i) => i.svc === 'vpn')?.qty).toBe(1);
    const custom = items.filter((i) => i.svc === 'custom').map((i) => i.spec.what);
    expect(custom).toEqual(expect.arrayContaining(['Transit Gateway', 'Cloud WAN', 'Reachability Analyzer', 'Network Address Translation (NAT) Gateway']));
    expect(items.find((i) => i.spec.what === 'Transit Gateway')?.spec.monthly).toBe(1030.02);
  });
});

describe('other AWS templates', () => {
  it('knows the Dedicated Hosts and EBS templates by their headers', () => {
    expect(templateKind([[], [], ['', 'Group', 'Description', 'AWS Region ', 'Instance Family', 'Number of Hosts']])).toBe('hosts');
    expect(templateKind([[], [], ['', 'Group', 'Description', 'AWS Region ', 'Storage Type', 'Average duration', 'Number \nof volumes']])).toBe('ebs');
  });

  it('reads EBS rows into disks and snapshot cards', () => {
    const rows = [[], [], ['', 'Group', 'Description', 'AWS Region \n', 'Storage Type', 'Average duration each instance runs\n(hours per month)', 'Number \nof volumes', 'Storage amount \nper volume \n(GB)', 'Provisioning IOPS per volume', 'EBS Throughput per volume', 'Snapshot Frequency', 'EBS Snapshot amount \nper volume\n (GB/snapshot)'],
      ['1', 'Data', 'Logs', 'ap-southeast-3', 'General Purpose SSD (gp3)', '730', '4', '500', '3000', '125', 'Weekly', '10']];
    const res = parseEbsTemplate(rows, ['ap-southeast-3']);
    const [disk, snaps] = res.boxes[0].items;
    expect(disk).toMatchObject({ svc: 'disk', qty: 4, name: 'Logs' });
    expect(disk.spec).toMatchObject({ gb: 500, 'aws.volume': 'gp3', iops: 3000, mbps: 125 });
    // Weekly snapshots of 10 GB kept a month: 500 + 3 × 10 = 530 GB per volume.
    expect(snaps).toMatchObject({ svc: 'backup', qty: 4 });
    expect(snaps.spec.gb).toBe(530);
  });
});
